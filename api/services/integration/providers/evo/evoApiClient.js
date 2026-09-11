'use strict';

/**
 * EvoApiClient — cliente HTTP read-only do provider EVO.
 *
 * Responsabilidades (e nada além):
 * - montar autenticação a partir do contrato (Basic token/secretKey);
 * - aplicar timeout, retry com backoff e classificação de erro;
 * - paginar deterministicamente com proteção contra página repetida;
 * - SANITIZAR todo erro/log (nunca vazar Authorization/Secret Key);
 * - recusar host não certificado quando o contrato está UNVERIFIED.
 *
 * O cliente NÃO conhece o domínio RAP. Ele devolve JSON bruto do provedor para
 * o adapter normalizar.
 */

const { IntegrationError, INTEGRATION_ERROR_CODES, redactDeep, redactString, sanitizeError } = require('../../integrationRedaction');

/** Status/erros que PODEM ser reprocessados com segurança (integração read-only). */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 405, 410, 422]);

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function isLoopbackHost(hostname) {
  if (!hostname) return false;
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  return /^127\./.test(hostname) || /^\[?::1\]?$/.test(hostname);
}

// ── SSRF ──────────────────────────────────────────────────────────────────
//
// `IntegrationConnection.config.baseUrl` é configurável por tenant. Sem
// política, um tenant (ou um operador enganado) aponta o `baseUrl` para
// `169.254.169.254` (metadata de nuvem) ou para a rede interna e o servidor faz
// requisições AUTENTICADAS em nome do RAP. A checagem acontece ANTES de
// qualquer chamada e é independente do estado de certificação do contrato:
// mesmo um contrato CERTIFIED não autoriza falar com a rede privada.

/** Intervalos privados/reservados que a integração nunca deve alcançar. */
const BLOCKED_IPV4_RANGES = Object.freeze([
  { cidr: '0.0.0.0/8', reason: 'this_network' },
  { cidr: '10.0.0.0/8', reason: 'private' },
  { cidr: '100.64.0.0/10', reason: 'carrier_grade_nat' },
  { cidr: '127.0.0.0/8', reason: 'loopback' },
  { cidr: '169.254.0.0/16', reason: 'link_local_metadata' },
  { cidr: '172.16.0.0/12', reason: 'private' },
  { cidr: '192.0.0.0/24', reason: 'ietf_protocol_assignments' },
  { cidr: '192.168.0.0/16', reason: 'private' },
  { cidr: '198.18.0.0/15', reason: 'benchmarking' },
  { cidr: '224.0.0.0/4', reason: 'multicast' },
  { cidr: '240.0.0.0/4', reason: 'reserved' },
]);

const BLOCKED_HOSTNAMES = Object.freeze(['metadata.google.internal', 'metadata.goog']);

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value;
}

/** Verifica se um IPv4 literal pertence a um CIDR bloqueado. */
function isBlockedIpv4(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return null;
  for (const { cidr, reason } of BLOCKED_IPV4_RANGES) {
    const [network, bits] = cidr.split('/');
    const networkValue = ipv4ToInt(network);
    const mask = bits === '0' ? 0 : ((0xffffffff << (32 - Number(bits))) >>> 0);
    if (((value & mask) >>> 0) === ((networkValue & mask) >>> 0)) {
      return { blocked: true, cidr, reason };
    }
  }
  return { blocked: false };
}

/** Verifica se um IPv6 literal é loopback/ULA/link-local. */
function isBlockedIpv6(hostname) {
  const host = String(hostname).replace(/^\[|\]$/g, '').toLowerCase();
  if (host === '::1' || host === '::') return { blocked: true, cidr: '::1/128', reason: 'loopback' };
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return { blocked: true, cidr: 'fc00::/7', reason: 'unique_local' };
  if (/^fe[89ab][0-9a-f]:/.test(host)) return { blocked: true, cidr: 'fe80::/10', reason: 'link_local' };
  return null;
}

/**
 * Valida o endpoint ANTES de qualquer requisição.
 *
 * @param {URL} parsed
 * @param {object} policy `contract._ssrfPolicy`
 * @param {object} options `{ allowLoopback }`
 * @returns {{ ok: boolean, reason?: string, detail?: object }}
 */
function assertEndpointIsSafe(parsed, policy = {}, { allowLoopback = false } = {}) {
  if (policy.enabled === false) return { ok: true };
  const allowedProtocols = policy.allowedProtocols || ['https:', 'http:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    return { ok: false, reason: 'protocol_not_allowed', detail: { protocol: parsed.protocol } };
  }
  const httpRequiresOptIn = policy.httpRequiresExplicitOptIn !== false;
  const hostname = String(parsed.hostname || '').toLowerCase();
  const loopback = isLoopbackHost(hostname);

  if (loopback && !allowLoopback) {
    return { ok: false, reason: 'loopback_requires_explicit_lab_opt_in', detail: { hostname } };
  }
  if (loopback && allowLoopback) {
    // Loopback explícito para laboratório/teste: `http` é aceito.
    return { ok: true, loopback: true };
  }
  if (parsed.protocol === 'http:' && httpRequiresOptIn) {
    return { ok: false, reason: 'plain_http_requires_explicit_opt_in', detail: { hostname } };
  }
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    return { ok: false, reason: 'blocked_metadata_hostname', detail: { hostname } };
  }
  const ipv6 = isBlockedIpv6(hostname);
  if (ipv6) return { ok: false, reason: `blocked_ip_range:${ipv6.cidr}`, detail: { hostname, ...ipv6 } };
  const ipv4 = isBlockedIpv4(hostname);
  if (ipv4 && ipv4.blocked) {
    return { ok: false, reason: `blocked_ip_range:${ipv4.cidr}`, detail: { hostname, ...ipv4 } };
  }
  return { ok: true };
}

/** Classifica um status HTTP no código de erro canônico da integração. */
function classifyHttpStatus(status) {
  if (status === 401) return INTEGRATION_ERROR_CODES.PROVIDER_AUTH_ERROR;
  if (status === 403) return INTEGRATION_ERROR_CODES.PROVIDER_AUTH_ERROR;
  if (status === 429) return INTEGRATION_ERROR_CODES.PROVIDER_RATE_LIMITED;
  if (status >= 500) return INTEGRATION_ERROR_CODES.PROVIDER_UNAVAILABLE;
  if (status >= 400) return INTEGRATION_ERROR_CODES.PROVIDER_HTTP_ERROR;
  return INTEGRATION_ERROR_CODES.PROVIDER_HTTP_ERROR;
}

function isRetryable(error) {
  if (!error) return false;
  if (error.code === INTEGRATION_ERROR_CODES.PROVIDER_TIMEOUT) return true;
  if (error.code === INTEGRATION_ERROR_CODES.PROVIDER_RATE_LIMITED) return true;
  if (error.code === INTEGRATION_ERROR_CODES.PROVIDER_UNAVAILABLE) return true;
  if (error.code === INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE) return false;
  if (error.retryable === true) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/** Backoff exponencial com jitter determinístico (sem Math.random em teste). */
function backoffDelay(attempt, baseMs) {
  const exponential = baseMs * (2 ** Math.max(0, attempt - 1));
  return Math.min(exponential, 30000);
}

function buildAuthHeader(contract, credentials) {
  const auth = (contract && contract.auth) || {};
  if (auth.type !== 'basic') {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, `esquema de auth não suportado: ${auth.type}`);
  }
  const user = credentials && credentials[auth.usernameField];
  const pass = credentials && credentials[auth.passwordField];
  if (!user || !pass) {
    throw new IntegrationError(
      INTEGRATION_ERROR_CODES.CREDENTIALS_MISSING,
      'credenciais incompletas para o provider',
      { missing: [!user ? auth.usernameField : null, !pass ? auth.passwordField : null].filter(Boolean) },
    );
  }
  return `${auth.scheme || 'Basic'} ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;
}

function buildQuery(query = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * @param {object} params
 * @param {object} params.contract contrato versionado do provider
 * @param {object} params.connection `{ baseUrl, allowUnverifiedEndpoints }`
 * @param {object} params.credentials credenciais em claro (uso interno)
 * @param {Function} [params.fetchImpl] injetável para teste
 * @param {Function} [params.logger]
 */
/**
 * Resolve o dialeto de paginação EFETIVO de um recurso.
 *
 * Não existe modelo global: cada recurso declara o seu (`resources.<r>.pagination`)
 * e o modelo nomeado vive em `_paginationModels`. Aplicar `page`/`size` a uma API
 * que documenta `take`/`skip` produz requisição com parâmetro inexistente — o
 * provedor ignora o parâmetro e devolve sempre a primeira página, que o RAP
 * então percorre até o limite de páginas lendo o mesmo lote repetidas vezes.
 *
 * @param {object} contract
 * @param {string|null} resource
 */
function resolvePagination(contract, resource = null) {
  const resourceConfig = resource && contract && contract.resources ? contract.resources[resource] : null;
  const declared = (resourceConfig && resourceConfig.pagination) || null;
  const models = (contract && contract._paginationModels) || {};
  const modelName = declared && declared.model ? declared.model : (contract && contract.pagination && contract.pagination.type) || 'takeSkip';
  const model = models[modelName] || (contract && contract.pagination) || {};
  return {
    modelName,
    ...model,
    maxTake: declared && Number.isFinite(Number(declared.maxTake)) ? Number(declared.maxTake) : null,
    defaultTake: declared && Number.isFinite(Number(declared.defaultTake)) ? Number(declared.defaultTake) : null,
    progressBy: model.progressBy || (model.skipParam ? 'skip' : 'page'),
  };
}

/**
 * Monta os parâmetros de paginação de UMA página.
 * Respeita `maxTake` do recurso (limite é resource-specific, não global).
 */
function buildPaginationQuery(pagination, { cursor = null, take = null } = {}) {
  const startsAt = Number.isFinite(Number(pagination.startsAt)) ? Number(pagination.startsAt) : 0;
  const effectiveTake = resolveTake(pagination, take);
  if (pagination.progressBy === 'skip' || pagination.skipParam) {
    const skipParam = pagination.skipParam || 'skip';
    const takeParam = pagination.takeParam || 'take';
    const offset = cursor === null || cursor === undefined || cursor === ''
      ? startsAt
      : Number(cursor);
    return { query: { [takeParam]: effectiveTake, [skipParam]: Number.isFinite(offset) ? offset : startsAt }, take: effectiveTake };
  }
  const pageParam = pagination.pageParam || 'page';
  const sizeParam = pagination.sizeParam || 'size';
  const page = cursor === null || cursor === undefined || cursor === ''
    ? (Number.isFinite(startsAt) ? startsAt : 1)
    : Number(cursor);
  return { query: { [pageParam]: Number.isFinite(page) ? page : 1, [sizeParam]: effectiveTake }, take: effectiveTake };
}

/** `take` efetivo pedido ao provedor, nunca acima do `maxTake` do recurso. */
function resolveTake(pagination, requested = null) {
  const wanted = Number(requested) || Number(pagination.defaultTake) || Number(pagination.maxTake) || 50;
  if (Number.isFinite(pagination.maxTake) && pagination.maxTake > 0) {
    return Math.min(wanted, pagination.maxTake);
  }
  return wanted;
}

function createEvoClient({ contract, connection = {}, credentials, fetchImpl = null, logger = null } = {}) {
  const request = (contract && contract.request) || {};
  const timeoutMs = Number(request.timeoutMs) || 15000;
  const maxRetries = Number.isFinite(request.maxRetries) ? Number(request.maxRetries) : 3;
  const baseBackoffMs = Number(request.baseBackoffMs) || 500;
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'nenhuma implementação de fetch disponível');
  }

  const connectionConfig = (connection && connection.config) || {};
  const baseUrl = String(
    connectionConfig.baseUrl || connection.baseUrl || (contract && contract.defaultBaseUrl) || '',
  ).replace(/\/+$/, '');
  if (!baseUrl) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_INVALID, 'baseUrl do provider não configurada');
  }

  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch (_) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_INVALID, 'baseUrl do provider inválida');
  }

  const ssrfPolicy = (contract && contract._ssrfPolicy) || {};
  // O opt-in de laboratório pode vir no envelope (`connection.config`) ou no
  // nível raiz: o cliente NÃO depende do formato do wrapper que o chamou.
  const allowUnverified = connectionConfig.allowUnverifiedEndpoints === true
    || connection.allowUnverifiedEndpoints === true;
  const loopback = isLoopbackHost(parsedBase.hostname);

  /**
   * Guarda SSRF. Roda ANTES de qualquer requisição e não é afetada pelo estado
   * de certificação: um contrato certificado não autoriza falar com a rede
   * privada nem com serviços de metadata.
   */
  function assertEndpointSafe() {
    const verdict = assertEndpointIsSafe(parsedBase, ssrfPolicy, { allowLoopback: loopback && allowUnverified });
    if (!verdict.ok) {
      throw new IntegrationError('integration_endpoint_blocked_ssrf', 'endpoint do provider bloqueado pela política de SSRF', {
        host: parsedBase.hostname,
        reason: verdict.reason,
        ...(verdict.detail || {}),
      });
    }
  }

  const certificationStatus = String((contract && contract._certification && contract._certification.status) || 'UNVERIFIED');

  /**
   * Guarda de honestidade: com contrato não certificado, não fazemos chamada
   * real para host de produção. Loopback (testes/laboratório) é permitido.
   */
  function assertEndpointAllowed() {
    assertEndpointSafe();
    if (certificationStatus === 'CERTIFIED') return;
    if (isLoopbackHost(parsedBase.hostname)) return;
    if (allowUnverified) return;
    throw new IntegrationError(
      'integration_evo_contract_not_certified',
      'contrato do provider não certificado: chamada para host externo bloqueada',
      { host: parsedBase.hostname, certificationStatus },
    );
  }

  async function rawRequest(pathname, { query = {}, method = 'GET', body = null } = {}) {
    assertEndpointAllowed();
    const url = `${baseUrl}${pathname}${buildQuery(query)}`;
    const headers = {
      Accept: 'application/json',
      [((contract.auth && contract.auth.header) || 'Authorization')]: buildAuthHeader(contract, credentials),
    };
    const init = { method, headers };
    if (body !== null) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      if (timer && typeof timer.unref === 'function') timer.unref();
      try {
        const response = await doFetch(url, controller ? { ...init, signal: controller.signal } : init);
        if (timer) clearTimeout(timer);

        const status = Number(response.status);
        const text = typeof response.text === 'function' ? await response.text() : '';

        if (status >= 200 && status < 300) {
          if (!text) return { body: null, status, requestId: response.headers && response.headers.get ? response.headers.get('x-request-id') : null };
          try {
            return { body: JSON.parse(text), status, requestId: response.headers && response.headers.get ? response.headers.get('x-request-id') : null };
          } catch (_) {
            throw new IntegrationError(
              INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE,
              'resposta do provider não é JSON válido',
              { path: pathname, status, bodyPreview: redactString(text.slice(0, 200)) },
            );
          }
        }

        const code = classifyHttpStatus(status);
        const error = new IntegrationError(code, `provider respondeu ${status}`, {
          path: pathname,
          status,
          bodyPreview: redactString(text.slice(0, 200)),
          retryable: RETRYABLE_STATUS.has(status) && !NON_RETRYABLE_STATUS.has(status),
        });
        if (!isRetryable(error)) throw error;
        lastError = error;
      } catch (error) {
        if (timer) clearTimeout(timer);
        if (error instanceof IntegrationError && isRetryable(error) === false) throw error;

        const isAbort = error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
        const normalized = isAbort
          ? new IntegrationError(INTEGRATION_ERROR_CODES.PROVIDER_TIMEOUT, 'timeout ao chamar o provider', { path: pathname, timeoutMs, retryable: true })
          : (error instanceof IntegrationError
            ? error
            : new IntegrationError(INTEGRATION_ERROR_CODES.PROVIDER_UNAVAILABLE, 'falha de rede ao chamar o provider', {
              path: pathname,
              cause: sanitizeError(error).code,
              retryable: true,
            }));

        if (!isRetryable(normalized)) throw normalized;
        lastError = normalized;
      }

      if (attempt <= maxRetries) {
        const delay = backoffDelay(attempt, baseBackoffMs);
        if (logger) {
          logger.warn('[EvoApiClient] retry de chamada ao provider', redactDeep({ path: pathname, attempt, delay, code: lastError && lastError.code }));
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
      }
    }

    throw lastError || new IntegrationError(INTEGRATION_ERROR_CODES.PROVIDER_UNAVAILABLE, 'falha ao chamar o provider');
  }

  /**
   * Paginação determinística e RESOURCE-AWARE. Nunca assume que uma chamada
   * devolve a base toda, nunca usa um modelo global, e protege contra página
   * repetida (o provedor devolver o mesmo lote indefinidamente).
   */
  async function fetchAllPages(pathname, { query = {}, onPage = null, maxPages = null, resource = null, take = null } = {}) {
    const pagination = resolvePagination(contract, resource);
    const limit = Number.isFinite(maxPages) ? maxPages : (Number(request.maxPages) || 500);

    const items = [];
    const seenSignatures = new Set();
    let cursor = null;
    let pagesProcessed = 0;
    let nextCursor = null;

    for (; pagesProcessed < limit;) {
      const { query: pageQuery, take: effectiveTake } = buildPaginationQuery(pagination, { cursor, take });
      // eslint-disable-next-line no-await-in-loop
      const response = await rawRequest(pathname, { query: { ...query, ...pageQuery } });
      const pageItems = extractItems(response.body, pagination);
      pagesProcessed += 1;

      const signature = pageItems.map((item) => (item && typeof item === 'object' ? JSON.stringify(item).slice(0, 200) : String(item))).join('|');
      if (pageItems.length > 0 && seenSignatures.has(signature)) {
        throw new IntegrationError(
          INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE,
          'página repetida detectada na paginação do provider',
          { path: pathname, resource, cursor, take: effectiveTake },
        );
      }
      seenSignatures.add(signature);

      if (onPage) await onPage({ page: pagesProcessed, cursor, items: pageItems, response });

      items.push(...pageItems);

      // Avança pelo eixo declarado pelo modelo (skip ou page), nunca por um
      // `page += 1` cego.
      const advanced = advanceCursor(pagination, cursor, pageItems.length, effectiveTake);
      cursor = advanced.cursor;
      nextCursor = advanced.nextCursor;

      const hasMore = advanced.hasMore && resolveHasMore(response.body, pagination, pageItems, effectiveTake);
      if (!hasMore) return { items, pagesProcessed, nextCursor: null, lastCursor: cursor, paginationModel: pagination.modelName };
      if (pageItems.length === 0) {
        // Provedor sinalizou mais páginas mas devolveu página vazia: para e reporta.
        return { items, pagesProcessed, nextCursor, lastCursor: cursor, stoppedOnEmptyPage: true, paginationModel: pagination.modelName };
      }
    }

    return { items, pagesProcessed, nextCursor, truncated: true, paginationModel: pagination.modelName };
  }

  return {
    rawRequest, fetchAllPages, baseUrl, certificationStatus, assertEndpointAllowed, assertEndpointSafe,
  };
}

/**
 * Avança o cursor conforme o eixo do modelo de paginação e decide se há mais.
 * Um item a menos que o `take` pedido significa fim da coleção — para QUALQUER
 * modelo —, o que evita uma última requisição vazia.
 */
function advanceCursor(pagination, cursor, received, take) {
  const startsAt = Number.isFinite(Number(pagination.startsAt)) ? Number(pagination.startsAt) : 0;
  const current = cursor === null || cursor === undefined || cursor === ''
    ? startsAt
    : Number(cursor);
  const shortBatch = received < take;
  if (pagination.progressBy === 'skip' || pagination.skipParam) {
    const next = current + received;
    return { cursor: next, nextCursor: shortBatch ? null : String(next), hasMore: !shortBatch && received > 0 };
  }
  const next = current + 1;
  return { cursor: next, nextCursor: shortBatch ? null : String(next), hasMore: !shortBatch && received > 0 };
}

/** Extrai o array de itens aceitando o corpo direto ou campos alternativos. */
function extractItems(body, pagination = {}) {
  if (Array.isArray(body)) return body;
  if (body === null || body === undefined) return [];
  if (typeof body !== 'object') {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE, 'corpo da resposta não é array nem objeto');
  }
  const candidates = [pagination.itemsField, ...(pagination.itemsFieldAlternatives || [])].filter(Boolean);
  for (const field of candidates) {
    if (Array.isArray(body[field])) return body[field];
  }
  // Objeto único (ex.: resposta de detalhe) não é página.
  return [];
}

/**
 * Decide se há próxima página.
 *
 * Para modelos com eixo explícito (`skip`/`page`) a decisão é do tamanho do
 * lote: um lote MENOR que o `take` pedido significa fim da coleção. Indicadores
 * booleanos explícitos do provedor (`hasMore`) têm precedência quando presentes.
 */
function resolveHasMore(body, pagination = {}, pageItems = [], pageSize = 100) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const field of pagination.hasMoreFieldAlternatives || []) {
      if (typeof body[field] === 'boolean') return body[field];
    }
  }
  return pageItems.length >= pageSize;
}

module.exports = {
  createEvoClient,
  buildAuthHeader,
  classifyHttpStatus,
  isRetryable,
  extractItems,
  resolveHasMore,
  isLoopbackHost,
  backoffDelay,
  resolvePagination,
  buildPaginationQuery,
  resolveTake,
  assertEndpointIsSafe,
  isBlockedIpv4,
  BLOCKED_IPV4_RANGES,
  RETRYABLE_STATUS,
};
