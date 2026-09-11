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
const { createEvoClient, resolvePagination, buildPaginationQuery } = require('./evoApiClient');
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
    // O opt-in de laboratório pode estar no envelope (`config`) ou na raiz —
    // aceitar as duas formas evita que o guard de SSRF/contrato dependa do
    // formato do objeto que o chamador montou.
    allowUnverifiedEndpoints: config.allowUnverifiedEndpoints === true
      || connection.allowUnverifiedEndpoints === true,
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
  const states = (contract._contractStates && contract._contractStates.current) || {};
  return {
    provider: PROVIDER_ID,
    readOnly: contract.readOnly !== false,
    supportsWebhooks: true,
    supportsIncremental: true,
    certificationStatus: (contract._certification && contract._certification.status) || 'UNVERIFIED',
    // Estados de contrato SEPARADOS: `localContractTested` nunca é promovido a
    // `liveCertified` por conveniência de relatório.
    contractStates: {
      OFFICIAL_DOCS_VERIFIED: states.OFFICIAL_DOCS_VERIFIED === true,
      LOCAL_CONTRACT_TESTED: states.LOCAL_CONTRACT_TESTED === true,
      AWAITING_LIVE_CERTIFICATION: states.AWAITING_LIVE_CERTIFICATION === true,
      LIVE_CERTIFIED: states.LIVE_CERTIFIED === true,
    },
    resources: SUPPORTED_RESOURCES.map((resource) => ({
      resource,
      evoEntity: contract.resources[resource].evoEntity || null,
      rapTarget: contract.resources[resource].rapTarget || null,
      supportsIncremental: contract.resources[resource].supportsIncremental === true,
      incrementalStrategy: (contract.resources[resource].incremental || {}).strategy || null,
      incrementalParam: contract.resources[resource].incrementalParam || null,
      paginationModel: (contract.resources[resource].pagination || {}).model || null,
      maxTake: (contract.resources[resource].pagination || {}).maxTake || null,
    })),
  };
}

/**
 * Resolve os parâmetros de FILTRO INCREMENTAL reais de um recurso.
 * Não existe `updatedSince` global: cada recurso declara a estratégia e o
 * provedor usa o filtro que ele realmente documenta.
 */
function buildIncrementalQuery({ contract, resource, since }) {
  if (!since) return {};
  const resourceConfig = resolveResourceConfig(contract, resource);
  const incremental = resourceConfig.incremental || {};
  const strategy = incremental.strategy || null;
  if (resourceConfig.supportsIncremental !== true || !strategy) return {};
  const definition = (contract._incrementalStrategies || {})[strategy];
  if (!definition || !Array.isArray(definition.params) || definition.params.length === 0) {
    // FULL_SCAN declarado: ausência de filtro é intencional e explícita.
    return {};
  }
  const value = since instanceof Date ? since.toISOString() : String(since);
  return strategy.endsWith('_RANGE')
    ? { [definition.params[0]]: value }
    : { [definition.params[0]]: value };
}

/**
 * Valida credenciais/conexão fazendo a chamada mais barata disponível
 * (primeira página do recurso `members` com take=1). Não persiste nada.
 */
async function validateConnection({ connection = {}, credentials, fetchImpl = null, contract = null } = {}) {
  const effectiveContract = contract || loadContract();
  const pagination = resolvePagination(effectiveContract, 'members');
  try {
    const client = buildClient({ connection, credentials, fetchImpl, contract: effectiveContract });
    await client.rawRequest(effectiveContract.resources.members.path, {
      query: buildPaginationQuery(pagination, { take: 1 }).query,
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
  const pagination = resolvePagination(effectiveContract, resource);

  // Validação EXPLÍCITA do cursor: um cursor não numérico não pode degradar
  // silenciosamente para "primeira página" — isso mascararia erro de chamador
  // como se fosse leitura bem-sucedida.
  if (cursor !== null && cursor !== undefined && cursor !== '') {
    const numericCursor = Number(cursor);
    if (!Number.isFinite(numericCursor) || numericCursor < 0) {
      throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'cursor de paginação inválido', { cursor, resource });
    }
  }

  const { query: paginationQuery, take: take_ } = buildPaginationQuery(pagination, { cursor: cursor === '' ? null : cursor, take: limit });

  const query = { ...paginationQuery };
  const incrementalQuery = buildIncrementalQuery({ contract: effectiveContract, resource, since });
  Object.assign(query, incrementalQuery);

  const client = buildClient({ connection, credentials, fetchImpl, contract: effectiveContract });
  const response = await client.rawRequest(resourceConfig.path, { query });

  // Reaproveita o extrator do cliente (mesmo dialeto declarado no contrato).
  const { extractItems, resolveHasMore, resolveTake } = require('./evoApiClient');
  const rawItems = extractItems(response.body, pagination);
  const hasMore = resolveHasMore(response.body, pagination, rawItems, take_) && rawItems.length >= take_;

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

  const nextCursorValue = hasMore
    ? (pagination.progressBy === 'skip' || pagination.skipParam
      ? String(Number(cursor === null || cursor === undefined ? pagination.startsAt || 0 : cursor) + rawItems.length)
      : String(Number(cursor === null || cursor === undefined ? pagination.startsAt || 1 : cursor) + 1))
    : null;

  const page_ = {
    items,
    rejected,
    nextCursor: nextCursorValue,
    hasMore,
    watermark: new Date().toISOString(),
    pagesProcessed: 1,
    page: cursor === null || cursor === undefined ? pagination.startsAt : cursor,
    paginationModel: pagination.modelName,
    take: resolveTake(pagination, limit),
    incrementalStrategy: (resourceConfig.incremental || {}).strategy || null,
    incrementalQuery,
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
  const asArray = extractItems(response.body, resolvePagination(effectiveContract, resource));
  const raw = asArray.length > 0 ? asArray[0] : response.body;
  if (Array.isArray(raw)) return null;
  return normalizeResourceRecord(resource, raw, effectiveContract);
}

/**
 * Verificação de autenticidade do webhook.
 *
 * CORREÇÃO DE CONTRATO (§29/§51): o par `x-evo-signature` + HMAC-SHA256 NÃO é
 * um fato verificado do provedor — nenhuma documentação oficial que o descreva
 * foi localizada. O que existe é a possibilidade de configurar cabeçalhos
 * customizados na criação do webhook. O modelo correto é, portanto:
 *
 *   RAP gera segredo aleatório forte → guarda cifrado →
 *   envia como cabeçalho customizado na criação do webhook →
 *   recebe o callback → compara em TEMPO CONSTANTE.
 *
 * A verificação é FAIL-CLOSED: sem segredo configurado, o webhook é rejeitado
 * (nunca aceito "porque não havia o que comparar"). Aceitar HMAC do provedor
 * continua suportado como MODO alternativo declarado, jamais como padrão
 * presumido.
 */
const WEBHOOK_DEFAULT_HEADER = 'x-evo-signature';

function resolveWebhookHeader(connection = {}) {
  const config = connection.config || {};
  const declared = config.webhookHeader || (connection.webhookHeader) || null;
  return String(declared || WEBHOOK_DEFAULT_HEADER).toLowerCase();
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyWebhookSignature({ connection = {}, credentials = {}, headers = {}, rawBody = '' } = {}) {
  const config = connection.config || {};
  const headerName = resolveWebhookHeader(connection);
  const provided = headers[headerName] || headers[headerName.toLowerCase()] || null;
  const secret = config.webhookSecret || credentials.webhookSecret || null;

  // FAIL-CLOSED: sem segredo não existe verificação — logo não existe aceite.
  if (!secret) {
    return { ok: false, reason: 'webhook_secret_not_configured', headerName };
  }
  if (!provided) {
    return { ok: false, reason: 'signature_header_missing', headerName };
  }

  const mode = String(config.webhookAuthMode || 'SHARED_SECRET_HEADER').toUpperCase();
  if (mode === 'HMAC_SHA256') {
    // Modo alternativo, explicitamente declarado pelo operador — não presumido.
    const body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {});
    const expected = crypto.createHmac('sha256', String(secret)).update(body).digest('hex');
    const normalized = String(provided).replace(/^sha256=/i, '').trim();
    return constantTimeEquals(normalized, expected)
      ? { ok: true, mode }
      : { ok: false, reason: 'signature_mismatch', mode };
  }

  return constantTimeEquals(String(provided).trim(), String(secret))
    ? { ok: true, mode: 'SHARED_SECRET_HEADER' }
    : { ok: false, reason: 'signature_mismatch', mode: 'SHARED_SECRET_HEADER' };
}

/** Gera o segredo do webhook (o RAP é quem manda o segredo para o provedor). */
function generateWebhookSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Chave de deduplicação de replay (§31).
 *
 * O provedor não fornece event id forte confirmado. A chave usa APENAS dados
 * seguros: escopo da conexão (nunca escolhido pelo payload), tipo de evento,
 * identificadores do provedor e digest estável do payload normalizado, dentro
 * de uma janela temporal. Nenhum campo inventado participa.
 */
function computeWebhookReplayKey({ connectionId, normalized, policy = null, now = new Date() } = {}) {
  const replay = policy || { windowSeconds: 900, digestAlgorithm: 'sha256', payloadFieldsExcludedFromDigest: [] };
  const payload = (normalized && normalized.payload) || {};
  const excluded = new Set(replay.payloadFieldsExcludedFromDigest || []);
  const stablePayload = Object.fromEntries(
    Object.entries(payload)
      .filter(([key]) => !excluded.has(key))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const windowSeconds = Number(replay.windowSeconds) || 900;
  const bucket = Math.floor((now instanceof Date ? now.getTime() : Date.parse(now)) / (windowSeconds * 1000));
  const material = JSON.stringify({
    connectionId: connectionId || null,
    eventType: (normalized && normalized.eventType) || null,
    externalEventId: (normalized && normalized.externalEventId) || null,
    resourceType: (normalized && normalized.resourceType) || null,
    externalResourceId: (normalized && normalized.externalResourceId) || null,
    payload: stablePayload,
  });
  const digest = crypto.createHash(replay.digestAlgorithm || 'sha256').update(material).digest('hex');
  return {
    key: `evo:${connectionId || 'unknown'}:${bucket}:${digest}`,
    digest,
    windowBucket: bucket,
    windowSeconds,
    strategy: 'connection_scoped_digest_with_window',
    // Sem event id forte não há dedup exata: dois eventos materialmente
    // idênticos na mesma janela colapsam. É aceitável porque o webhook é SINAL
    // e o estado canônico vem sempre de refetch na API.
    strongEventIdAvailable: Boolean(normalized && normalized.externalEventId),
  };
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
  generateWebhookSecret,
  computeWebhookReplayKey,
  resolveWebhookHeader,
  normalizeWebhook,
  buildIncrementalQuery,
  // expostos para teste/certificação
  loadContract,
  SUPPORTED_RESOURCES,
  CONTRACT_PATH,
  buildDetailPath,
  normalizeConnectionConfig,
  RESOURCE_TYPES,
};
