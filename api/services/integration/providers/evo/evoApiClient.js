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
function createEvoClient({ contract, connection = {}, credentials, fetchImpl = null, logger = null } = {}) {
  const request = (contract && contract.request) || {};
  const timeoutMs = Number(request.timeoutMs) || 15000;
  const maxRetries = Number.isFinite(request.maxRetries) ? Number(request.maxRetries) : 3;
  const baseBackoffMs = Number(request.baseBackoffMs) || 500;
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'nenhuma implementação de fetch disponível');
  }

  const baseUrl = String(connection.baseUrl || (contract && contract.defaultBaseUrl) || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_INVALID, 'baseUrl do provider não configurada');
  }

  let parsedBase;
  try {
    parsedBase = new URL(baseUrl);
  } catch (_) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_INVALID, 'baseUrl do provider inválida');
  }

  const certificationStatus = String((contract && contract._certification && contract._certification.status) || 'UNVERIFIED');
  const allowUnverified = connection.allowUnverifiedEndpoints === true;

  /**
   * Guarda de honestidade: com contrato não certificado, não fazemos chamada
   * real para host de produção. Loopback (testes/laboratório) é permitido.
   */
  function assertEndpointAllowed() {
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
   * Paginação determinística. Nunca assume que uma chamada devolve a base toda.
   * Protege contra página repetida (loop infinito do provedor) via `seenPageKeys`.
   */
  async function fetchAllPages(pathname, { query = {}, onPage = null, maxPages = null } = {}) {
    const pagination = (contract && contract.pagination) || {};
    const pageParam = pagination.pageParam || 'page';
    const sizeParam = pagination.sizeParam || 'size';
    const startsAt = Number.isFinite(pagination.startsAt) ? pagination.startsAt : 1;
    const pageSize = Number(request.pageSize) || 100;
    const limit = Number.isFinite(maxPages) ? maxPages : (Number(request.maxPages) || 500);

    const items = [];
    const seenPageSignatures = new Set();
    let page = startsAt;
    let pagesProcessed = 0;
    let nextCursor = null;

    for (; pagesProcessed < limit; page += 1) {
      // eslint-disable-next-line no-await-in-loop
      const response = await rawRequest(pathname, { query: { ...query, [pageParam]: page, [sizeParam]: pageSize } });
      const pageItems = extractItems(response.body, pagination);
      pagesProcessed += 1;

      const signature = pageItems.map((item) => (item && typeof item === 'object' ? JSON.stringify(item).slice(0, 200) : String(item))).join('|');
      if (pageItems.length > 0 && seenPageSignatures.has(signature)) {
        throw new IntegrationError(
          INTEGRATION_ERROR_CODES.PROVIDER_BAD_RESPONSE,
          'página repetida detectada na paginação do provider',
          { path: pathname, page },
        );
      }
      seenPageSignatures.add(signature);

      if (onPage) await onPage({ page, items: pageItems, response });

      items.push(...pageItems);
      nextCursor = String(page + 1);

      const hasMore = resolveHasMore(response.body, pagination, pageItems, pageSize);
      if (!hasMore) return { items, pagesProcessed, nextCursor: null, lastPage: page };
      if (pageItems.length === 0) {
        // Provedor sinalizou mais páginas mas devolveu página vazia: para e reporta.
        return { items, pagesProcessed, nextCursor, lastPage: page, stoppedOnEmptyPage: true };
      }
    }

    return { items, pagesProcessed, nextCursor, lastPage: page - 1, truncated: true };
  }

  return { rawRequest, fetchAllPages, baseUrl, certificationStatus, assertEndpointAllowed };
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

/** Decide se há próxima página: indicador explícito > total de páginas > tamanho da página. */
function resolveHasMore(body, pagination = {}, pageItems = [], pageSize = 100) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const field of pagination.hasMoreFieldAlternatives || []) {
      if (typeof body[field] === 'boolean') return body[field];
    }
    const totalCandidates = [pagination.totalPagesField, ...(pagination.totalPagesFieldAlternatives || [])].filter(Boolean);
    for (const field of totalCandidates) {
      if (Number.isFinite(Number(body[field]))) {
        const totalPages = Number(body[field]);
        const currentPage = Number(body[pagination.pageParam || 'page']);
        if (Number.isFinite(currentPage)) return currentPage < totalPages;
      }
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
  RETRYABLE_STATUS,
};
