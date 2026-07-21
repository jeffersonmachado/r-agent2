'use strict';

/**
 * Sanitização de payloads do Cognitive Core.
 *
 * Toda entrada/saída registrada em log, ledger ou learning passa por aqui.
 * Usuários operacionais e registros de auditoria nunca recebem segredos
 * nem detalhes técnicos internos.
 */

const SENSITIVE_KEY_PATTERN = /(token|password|senha|secret|authorization|api[-_]?key|credential|cookie|bearer)/i;
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return '[truncated:depth]';

  const type = typeof value;
  if (type === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }
  if (type === 'number' || type === 'boolean') return value;
  if (type === 'function') return '[function]';
  if (value instanceof Date) return value.toISOString();

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }

  if (type === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        out[key] = '[redacted]';
        continue;
      }
      out[key] = sanitizeValue(val, depth + 1);
    }
    return out;
  }

  return String(value);
}

function sanitize(value) {
  try {
    return sanitizeValue(value, 0);
  } catch (_) {
    return '[unsanitizable]';
  }
}

module.exports = { sanitize, SENSITIVE_KEY_PATTERN };
