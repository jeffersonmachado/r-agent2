'use strict';

/**
 * EvoProviderAdapter — implementa o contrato provider-neutral para o EVO.
 *
 * Fronteira da integração: tudo que é específico do EVO (path, dialeto de
 * paginação, nome de campo, status string) vive aqui + no contrato versionado
 * `config/integrations/evo-contract.json`. O domínio RAP consome apenas DTOs
 * normalizados.
 *
 * Fase atual: READ-ONLY. Nenhuma operação de escrita é implementada ou exposta.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { IntegrationError, INTEGRATION_ERROR_CODES, redactDeep, redactString } = require('../../integrationRedaction');
const { assertNormalizedPage, RESOURCE_TYPES } = require('../../providerContract');
const { createEvoClient } = require('./evoApiClient');
const { normalizeResourceRecord, MAPPERS } = require('./evoMappers');

const PROVIDER_ID = 'evo';
const CONTRACT_PATH = path.join(__dirname, '..', '..', '..', '..', '..', 'config', 'integrations', 'evo-contract.json');

/** Recursos que este provider declara suportar (subset de RESOURCE_TYPES). */
const SUPPORTED_RESOURCES = Object.freeze(Object.keys(MAPPERS));

let cachedContract = null;

/** Carrega (e cacheia) o contrato versionado. */
function loadContract({ reload = false } = {}) {
  if (cachedContract && !reload) return cachedContract;
  const raw = fs.readFileSync(CONTRACT_PATH, 'utf8');
  cachedContract = JSON.parse(raw);
  return cachedContract;
}

function resolveResourceConfig(contract, resource) {
  const config = contract.resources && contract.resources[resource];
  if (!config) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.RESOURCE_UNSUPPORTED, `recurso não suportado pelo EVO: ${resource}`, {
      resource,
      supported: SUPPORTED_RESOURCES,
    });
  }
  return config;
}

/** Preenche `{id}` no detailPath. */
function buildDetailPath(template, externalId) {
  return String(template).replace('{id}', encodeURIComponent(String(externalId)));
}

function normalizeConnectionConfig(connection = {}) {
  const config = connection.config || {};
  return {
    baseUrl: config.baseUrl || connection.baseUrl || null,
    allowUnverifiedEndpoints: config.allowUnverifiedEndpoints === true,
  };
}

function buildClient({ connection, credentials, fetchImpl = null, logger = null, contract = null }) {
  const effectiveContract = contract || loadContract();
  return createEvoClient({
    contract: effectiveContract,
    connection: normalizeConnectionConfig(connection),
    credentials,
    fetchImpl,
    logger,
  });
}

/** Capacidades declaradas (usadas pela camada de sync/orquestração). */
function capabilities() {
  const contract = loadContract();
  return {
    provider: PROVIDER_ID,
    readOnly: contract.readOnly !== false,
    supportsWebhooks: true,
    supportsIncremental: true,
    certificationStatus: (contract._certification && contract._certification.status) || 'UNVERIFIED',
    resources: SUPPORTED_RESOURCES.map((resource) => ({
      resource,
      supportsIncremental: contract.resources[resource].supportsIncremental === true,
      incrementalParam: contract.resources[resource].incrementalParam || null,
    })),
  };
}

/**
 * Valida credenciais/conexão fazendo a chamada mais barata disponível
 * (primeira página do recurso `members` com size=1). Não persiste nada.
 */
async function validateConnection({ connection = {}, credentials, fetchImpl = null, contract = null } = {}) {
  const effectiveContract = contract || loadContract();
  const pagination = effectiveContract.pagination || {};
  const sizeParam = pagination.sizeParam || 'size';
  const pageParam = pagination.pageParam || 'page';
  try {
    const client = buildClient({ connection, credentials, fetchImpl, contract: effectiveContract });
    await client.rawRequest(effectiveContract.resources.members.path, {
      query: { [pageParam]: pagination.startsAt || 1, [sizeParam]: 1 },
    });
    return { ok: true, status: 'connected', certificationStatus: client.certificationStatus };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      code: error.code || 'integration_provider_http_error',
      detail: redactString(error.message || 'falha ao validar conexão'),
    };
  }
}

/**
 * Busca uma página de um recurso, já normalizada.
 *
 * @returns {Promise<{items: object[], nextCursor: string|null, hasMore: boolean, watermark: string|null, pagesProcessed: number}>}
 */
async function fetchPage({
  connection, credentials, resource, cursor = null, since = null, limit = null, fetchImpl = null, contract = null,
} = {}) {
  const effectiveContract = contract || loadContract();
  const resourceConfig = resolveResourceConfig(effectiveContract, resource);
  const pagination = effectiveContract.pagination || {};
  const pageParam = pagination.pageParam || 'page';
  const sizeParam = pagination.sizeParam || 'size';
  const pageSize = Number(limit) || Number(effectiveContract.request && effectiveContract.request.pageSize) || 100;

  const page = cursor ? Number(cursor) : (pagination.startsAt || 1);
  if (!Number.isFinite(page) || page < 1) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'cursor de paginação inválido', { cursor });
  }

  const query = { [pageParam]: page, [sizeParam]: pageSize };
  if (since && resourceConfig.incrementalParam && resourceConfig.supportsIncremental) {
    query[resourceConfig.incrementalParam] = since instanceof Date ? since.toISOString() : String(since);
  }

  const client = buildClient({ connection, credentials, fetchImpl, contract: effectiveContract });
  const response = await client.rawRequest(resourceConfig.path, { query });

  // Reaproveita o extrator do cliente (mesmo dialeto declarado no contrato).
  const { extractItems, resolveHasMore } = require('./evoApiClient');
  const rawItems = extractItems(response.body, pagination);
  const hasMore = resolveHasMore(response.body, pagination, rawItems, pageSize);

  const items = [];
  const rejected = [];
  for (const raw of rawItems) {
    try {
      items.push(normalizeResourceRecord(resource, raw, effectiveContract));
    } catch (error) {
      // Schema drift em um registro não derruba o lote inteiro: é registrado e
      // contabilizado (o serviço de sync reporta como `rejected`).
      rejected.push({
        code: error.code || INTEGRATION_ERROR_CODES.PROVIDER_SCHEMA_DRIFT,
        detail: redactString(error.message || 'registro rejeitado'),
        externalIdHint: raw && typeof raw === 'object'
          ? String(raw.idMember || raw.id || raw.idMembership || raw.idEntry || raw.idSale || raw.idReceivable || '').slice(0, 64) || null
          : null,
      });
    }
  }

  const page_ = {
    items,
    rejected,
    nextCursor: hasMore ? String(page + 1) : null,
    hasMore,
    watermark: new Date().toISOString(),
    pagesProcessed: 1,
    page,
  };
  assertNormalizedPage(page_, { providerId: PROVIDER_ID, resource });
  return page_;
}

/** Busca um registro específico (usado pelo processamento de webhook). */
async function fetchOne({ connection, credentials, resource, externalId, fetchImpl = null, contract = null } = {}) {
  const effectiveContract = contract || loadContract();
  const resourceConfig = resolveResourceConfig(effectiveContract, resource);
  if (!externalId) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'fetchOne exige externalId', { resource });
  }
  if (!resourceConfig.detailPath) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.RESOURCE_UNSUPPORTED, `recurso ${resource} não tem detailPath no contrato`);
  }
  const client = buildClient({ connection, credentials, fetchImpl, contract: effectiveContract });
  const detailPath = buildDetailPath(resourceConfig.detailPath, externalId);
  const response = await client.rawRequest(detailPath);
  if (response.body === null || response.body === undefined) return null;

  const { extractItems } = require('./evoApiClient');
  const asArray = extractItems(response.body, effectiveContract.pagination);
  const raw = asArray.length > 0 ? asArray[0] : response.body;
  if (Array.isArray(raw)) return null;
  return normalizeResourceRecord(resource, raw, effectiveContract);
}

/**
 * Verificação de assinatura do webhook EVO.
 *
 * HONESTIDADE: o esquema de assinatura do EVO não foi confirmado na
 * documentação oficial (host inacessível). O contrato declara o esquema como
 * `hmac-sha256` sobre o corpo bruto. Enquanto a certificação não ocorrer, o
 * webhook só é aceito quando:
 *  - a conexão declara `config.webhookSecret` e a assinatura HMAC confere; ou
 *  - a rota está em modo de coleta (laboratório) explícito.
 * Sem segredo configurado a verificação é FAIL-CLOSED.
 */
function verifyWebhookSignature({ connection = {}, credentials = {}, headers = {}, rawBody = '' } = {}) {
  const headerName = 'x-evo-signature';
  const provided = headers[headerName] || headers['X-Evo-Signature'] || null;
  const secret = (connection.config && connection.config.webhookSecret) || credentials.webhookSecret || null;

  if (!secret) {
    return { ok: false, reason: 'webhook_secret_not_configured' };
  }
  if (!provided) {
    return { ok: false, reason: 'signature_header_missing' };
  }
  const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {});
  const expected = crypto.createHmac('sha256', String(secret)).update(body).digest('hex');
  const normalized = String(provided).replace(/^sha256=/i, '').trim();
  const equal = normalized.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(normalized, 'utf8'), Buffer.from(expected, 'utf8'));
  return equal ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}

/**
 * Normaliza o webhook para o envelope canônico. O payload é sanitizado.
 * O EVO é tratado como SINAL: `resourceType` + `externalResourceId` permitem
 * buscar o estado canônico atual no provedor.
 */
function normalizeWebhook({ headers = {}, rawBody = '', parsedBody = null, connection = {} } = {}) {
  let body = parsedBody;
  if (!body && rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch (_) {
      throw new IntegrationError(INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE, 'webhook com JSON inválido');
    }
  }
  if (!body || typeof body !== 'object') {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE, 'webhook sem corpo');
  }

  const eventType = String(body.event || body.eventType || body.type || 'unknown').trim().slice(0, 96);
  const explicitId = body.idEvent || body.eventId || body.id || null;
  const resourceType = String(body.resourceType || body.resource || body.entity || '').trim() || null;
  const externalResourceId = body.idResource || body.resourceId || body.idMember || body.idEntry || body.idSale || body.idReceivable || body.idMembership || null;

  return {
    eventType,
    externalEventId: explicitId !== null && explicitId !== undefined ? String(explicitId).slice(0, 255) : null,
    resourceType: resourceType ? resourceType.slice(0, 64) : null,
    externalResourceId: externalResourceId !== null && externalResourceId !== undefined ? String(externalResourceId).slice(0, 255) : null,
    payload: redactDeep(body),
    unitIdHint: body.idBranch || body.idUnit || connection.external_unit_id || null,
  };
}

module.exports = {
  providerId: () => PROVIDER_ID,
  capabilities,
  validateConnection,
  fetchPage,
  fetchOne,
  verifyWebhookSignature,
  normalizeWebhook,
  // expostos para teste/certificação
  loadContract,
  SUPPORTED_RESOURCES,
  CONTRACT_PATH,
  buildDetailPath,
  normalizeConnectionConfig,
  RESOURCE_TYPES,
};
