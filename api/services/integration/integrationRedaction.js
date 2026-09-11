'use strict';

/**
 * Redaction/sanitização da camada de integração.
 *
 * Regra absoluta: segredo do provedor (Secret Key, Authorization, token,
 * senha), PAN de cartão e dado biométrico NUNCA podem aparecer em log, erro,
 * resposta de API, diagnóstico, evidência ou pacote de release.
 *
 * Este módulo é a única implementação — usado por adapter, serviços de sync,
 * webhook e rotas, para que a garantia seja uniforme e testável.
 */

const REDACTED = '[REDACTED]';
const REDACTED_PAN = '[REDACTED_PAN]';

/** Chaves cujo VALOR jamais pode ser materializado. */
const SENSITIVE_KEY_PATTERN = /(secret|token|password|passwd|senha|authorization|auth_header|api[-_]?key|apikey|credential|private[-_]?key|client[-_]?secret|access[-_]?key|refresh[-_]?token)/i;

/** Campos biométricos / de cartão que não devem nem ser coletados. */
const FORBIDDEN_DATA_KEY_PATTERN = /(biometr|facial|face[-_]?image|face[-_]?template|fingerprint|card[-_]?number|pan\b|cvv|cvc|security[-_]?code|card[-_]?token)/i;

/** PAN: 13–19 dígitos com separadores opcionais (espaço/hífen). */
const PAN_PATTERN = /\b(?:\d[ -]?){12,18}\d\b/g;
/** `Authorization: Basic/Bearer <valor>` e afins dentro de texto livre. */
const AUTH_HEADER_PATTERN = /\b(basic|bearer)\s+[A-Za-z0-9+/=._~-]{6,}/gi;
/** `secretKey=abc`, `token: abc`, `password=abc` em texto livre/querystring. */
const KEY_VALUE_SECRET_PATTERN = /\b(secret[-_]?key|client[-_]?secret|access[-_]?key|api[-_]?key|apikey|token|password|passwd|senha)\s*[:=]\s*([^\s&,;'"]+)/gi;
const URL_CREDENTIAL_PATTERN = /\/\/[^/\s:@]+:[^/\s@]+@/g;

function redactString(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(AUTH_HEADER_PATTERN, `$1 ${REDACTED}`)
    .replace(KEY_VALUE_SECRET_PATTERN, `$1=${REDACTED}`)
    .replace(URL_CREDENTIAL_PATTERN, `//${REDACTED}@`)
    .replace(PAN_PATTERN, REDACTED_PAN);
}

/**
 * Sanitiza profundamente um valor arbitrário.
 *
 * @param {*} value
 * @param {object} [options]
 * @param {number} [options.maxDepth] profundidade máxima (default 8)
 * @param {number} [options.maxArrayLength] itens por array (default 200)
 * @param {boolean} [options.dropForbidden] remove chaves de cartão/biometria (default true)
 */
function redactDeep(value, options = {}) {
  const maxDepth = Number.isFinite(options.maxDepth) ? options.maxDepth : 8;
  const maxArrayLength = Number.isFinite(options.maxArrayLength) ? options.maxArrayLength : 200;
  const dropForbidden = options.dropForbidden !== false;

  const seen = new WeakSet();

  function walk(node, depth) {
    if (node === null || node === undefined) return node;
    if (typeof node === 'string') return redactString(node);
    if (typeof node === 'number' || typeof node === 'boolean') return node;
    if (typeof node === 'bigint') return node.toString();
    if (typeof node === 'function') return undefined;
    if (node instanceof Date) return node.toISOString();
    if (node instanceof Error) {
      return { name: node.name, message: redactString(node.message), code: node.code || null };
    }
    if (Buffer.isBuffer(node)) return `[BUFFER ${node.length}]`;
    if (depth >= maxDepth) return '[TRUNCATED_DEPTH]';
    if (Array.isArray(node)) {
      if (seen.has(node)) return '[CIRCULAR]';
      seen.add(node);
      return node.slice(0, maxArrayLength).map((item) => walk(item, depth + 1));
    }
    if (typeof node === 'object') {
      if (seen.has(node)) return '[CIRCULAR]';
      seen.add(node);
      const out = {};
      for (const [key, val] of Object.entries(node)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          out[key] = REDACTED;
          continue;
        }
        if (dropForbidden && FORBIDDEN_DATA_KEY_PATTERN.test(key)) continue;
        const walked = walk(val, depth + 1);
        if (walked !== undefined) out[key] = walked;
      }
      return out;
    }
    return String(node);
  }

  return walk(value, 0);
}

/** Erro de integração com mensagem sanitizada e código estável. */
const INTEGRATION_ERROR_CODES = Object.freeze({
  PROVIDER_UNKNOWN: 'integration_provider_unknown',
  CONNECTION_NOT_FOUND: 'integration_connection_not_found',
  CONNECTION_INACTIVE: 'integration_connection_inactive',
  CONNECTION_INVALID: 'integration_connection_invalid',
  CREDENTIALS_MISSING: 'integration_credentials_missing',
  CREDENTIALS_INVALID: 'integration_credentials_invalid',
  OPAQUE_KEY_REQUIRED: 'integration_opaque_key_required',
  TENANT_REQUIRED: 'integration_tenant_required',
  RESOURCE_UNSUPPORTED: 'integration_resource_unsupported',
  DB_UNAVAILABLE: 'integration_db_unavailable',
  PROVIDER_HTTP_ERROR: 'integration_provider_http_error',
  PROVIDER_AUTH_ERROR: 'integration_provider_auth_error',
  PROVIDER_RATE_LIMITED: 'integration_provider_rate_limited',
  PROVIDER_TIMEOUT: 'integration_provider_timeout',
  PROVIDER_SCHEMA_DRIFT: 'integration_provider_schema_drift',
  PROVIDER_UNAVAILABLE: 'integration_provider_unavailable',
  PROVIDER_BAD_RESPONSE: 'integration_provider_bad_response',
  SYNC_CONFLICT: 'integration_sync_conflict',
  WEBHOOK_SIGNATURE_INVALID: 'integration_webhook_signature_invalid',
  WEBHOOK_NOT_SUPPORTED: 'integration_webhook_not_supported',
  CONTRACT_VIOLATION: 'integration_provider_contract_violation',
});

class IntegrationError extends Error {
  constructor(code, message, details = {}) {
    super(message || code);
    this.name = 'IntegrationError';
    this.code = code;
    this.details = redactDeep(details);
    this.retryable = Boolean(details && details.retryable);
  }

  toJSON() {
    return { code: this.code, message: redactString(this.message), details: this.details, retryable: this.retryable };
  }
}

/** Erro sanitizado para log/erro/persistência (nunca inclui segredo). */
function sanitizeError(error) {
  if (!error) return { code: 'unknown_error', message: 'unknown_error' };
  if (error instanceof IntegrationError) return error.toJSON();
  return {
    code: error.code || (error.name ? String(error.name) : 'unknown_error'),
    message: redactString(error.message ? String(error.message) : String(error)),
    retryable: Boolean(error.retryable),
  };
}

module.exports = {
  REDACTED,
  REDACTED_PAN,
  SENSITIVE_KEY_PATTERN,
  FORBIDDEN_DATA_KEY_PATTERN,
  redactString,
  redactDeep,
  sanitizeError,
  IntegrationError,
  INTEGRATION_ERROR_CODES,
};
