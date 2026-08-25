'use strict';

const path = require('path');

const SAFE_JSON_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_PATTERN = /(?:^|_)(?:password|passwd|pwd|secret|token|authorization|cookie|session|credential|api_?key|private_?key)(?:$|_)/i;
const SENSITIVE_SELECTOR_PATTERN = /password|passwd|current-password|new-password|secret|token|api[-_]?key/i;
const SECRET_TEMPLATE_PATTERN = /^\{\{secrets\.[A-Za-z0-9_]+\}\}$/;
const INTERNAL_PATH_KEY_PATTERN = /^(?:historyPath|chainPath|filePath|storagePath|evidenceDir|runtimeDir|reportPath|artifactPath)$/i;
const INTERNAL_PATH_TEXT_PATTERN = /(?:[A-Za-z]:\\(?:Users|Windows|Temp)\\[^\s"'`,;)\]}]+|\/(?:opt|home|tmp|workspace|var\/(?:lib|log|tmp))\/[^\s"'`,;)\]}]+)/g;
const REDACTED_INTERNAL_PATH = '[INTERNAL_PATH]';

function safeString(value, fallback = '') {
  try {
    return value == null ? fallback : String(value);
  } catch (_) {
    return fallback;
  }
}

function normalizeTenantKey(value, { defaultValue = null, required = true } = {}) {
  const candidate = safeString(value, '').trim() || safeString(defaultValue, '').trim();
  if (!candidate) {
    if (!required) return null;
    const error = new Error('tenant_id_required');
    error.code = 'TENANT_REQUIRED';
    throw error;
  }
  if (candidate.length > 255 || candidate.includes('\0')) {
    const error = new Error('tenant_id_invalid');
    error.code = 'TENANT_INVALID';
    throw error;
  }
  return candidate;
}

function tenantFromRequest(req, auth = null) {
  const requestOwnsTenant = Boolean(req && Object.prototype.hasOwnProperty.call(req, 'tenantId'));
  const selected = requestOwnsTenant
    ? req.tenantId
    : (auth?.agent?.tenantId || auth?.agent?.tenant_id || req?.agent?.tenantId || req?.agent?.tenant_id);
  return normalizeTenantKey(selected);
}

function tenantFromArtifact(payload, fallback = 'system') {
  return normalizeTenantKey(
    payload?.tenantId
      || payload?.tenant_id
      || payload?.tenantKey
      || payload?.tenant_key
      || payload?.metadata?.tenantId
      || payload?.metadata?.tenant_id
      || payload?.metadata?.tenantKey
      || payload?.metadata?.tenant_key
      || payload?.tags?.tenantId,
    { defaultValue: fallback },
  );
}

function belongsToTenant(payload, tenantId, { allowShared = false } = {}) {
  const expected = normalizeTenantKey(tenantId);
  if (allowShared && (payload?.shared === true || payload?.metadata?.shared === true)) return true;
  return tenantFromArtifact(payload) === expected;
}

function normalizeJsonName(value) {
  let candidate = safeString(value, '').trim();
  candidate = candidate.replace(/\.json$/i, '');
  if (!SAFE_JSON_NAME_PATTERN.test(candidate) || candidate.includes('..')) {
    const error = new Error('rpa_json_name_invalid');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return candidate;
}

function resolveContainedJsonPath(rootDir, value) {
  const root = path.resolve(rootDir);
  const name = normalizeJsonName(value);
  const target = path.resolve(root, `${name}.json`);
  if (path.dirname(target) !== root) {
    const error = new Error('rpa_json_path_outside_root');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return target;
}

function isSensitiveSelector(selector, inputType = '') {
  return SENSITIVE_SELECTOR_PATTERN.test(`${safeString(selector)} ${safeString(inputType)}`);
}

function redactUrl(value) {
  const text = safeString(value);
  if (!text) return text;
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
    const parsed = new URL(text, absolute ? undefined : 'http://rpa.local');
    for (const key of parsed.searchParams.keys()) {
      if (SENSITIVE_KEY_PATTERN.test(key)) parsed.searchParams.set(key, REDACTED);
    }
    parsed.hash = '';
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  } catch (_) {
    return text.replace(/([?&](?:password|token|secret|key|authorization)=)[^&#\s]*/gi, `$1${REDACTED}`);
  }
}

function redactText(value) {
  return safeString(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/((?:password|passwd|pwd|secret|token|authorization|cookie|api[-_]?key)\s*[:=]\s*)[^\s,;"'}]+/gi, `$1${REDACTED}`)
    .slice(0, 4000);
}

function redactDeep(value, context = {}, seen = new WeakSet()) {
  if (value == null) return value;
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'string') {
    if (context.forceRedact || isSensitiveSelector(context.selector, context.inputType)) {
      return SECRET_TEMPLATE_PATTERN.test(value) ? value : REDACTED;
    }
    if (context.key && /url/i.test(context.key)) return redactUrl(value);
    // Imagens em base64 (screenshots) NÃO podem passar pelo redactText:
    // o slice(0, 4000) truncava o PNG no meio e a imagem aparecia em branco.
    if (/screenshot/i.test(String(context.key || '')) || /^data:image\//i.test(value)) {
      return value;
    }
    return redactText(value);
  }
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((entry) => redactDeep(entry, context, seen));
    seen.delete(value);
    return output;
  }

  const selector = value.selector || value.target || context.selector || '';
  const inputType = value.inputType || value.typeAttribute || value.autocomplete || context.inputType || '';
  const sensitiveField = value.sensitive === true || isSensitiveSelector(selector, inputType);
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = REDACTED;
      continue;
    }
    if (/^(?:domSnapshot|pageContent|html)$/i.test(key) && entry != null) {
      output[key] = REDACTED;
      continue;
    }
    const forceRedact = sensitiveField && /^(?:value|input|actual|expected|text|bodyPreview)$/i.test(key);
    output[key] = redactDeep(entry, { key, selector, inputType, forceRedact }, seen);
  }
  seen.delete(value);
  return output;
}

function secretTemplateFor(selector) {
  const normalized = safeString(selector, 'password')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'password';
  return `{{secrets.${normalized}}}`;
}

function protectRecordingSecrets(value) {
  if (!value || typeof value !== 'object') return redactDeep(value);
  const cloned = JSON.parse(JSON.stringify(value));

  function visit(entry) {
    if (!entry || typeof entry !== 'object') return;
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    const actionType = safeString(entry.type || entry.actionType).toLowerCase();
    const selector = entry.selector || entry.target || '';
    const inputType = entry.inputType || entry.typeAttribute || entry.autocomplete || '';
    if ((actionType === 'fill' || actionType === 'type' || actionType === 'input')
        && (entry.sensitive === true || isSensitiveSelector(selector, inputType))) {
      entry.value = secretTemplateFor(entry.fieldName || selector || 'password');
      entry.sensitive = true;
    }
    Object.values(entry).forEach(visit);
  }

  visit(cloned);
  return redactDeep(cloned);
}

function stripInternalFilesystemPaths(value, seen = new WeakSet()) {
  if (typeof value === 'string') {
    return value.replace(INTERNAL_PATH_TEXT_PATTERN, REDACTED_INTERNAL_PATH);
  }
  if (value == null || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const output = value.map((entry) => stripInternalFilesystemPaths(entry, seen));
    seen.delete(value);
    return output;
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (INTERNAL_PATH_KEY_PATTERN.test(key)) continue;
    if (/^(?:path|tracePath|screenshotPath)$/i.test(key)
        && typeof entry === 'string'
        && path.isAbsolute(entry)) {
      continue;
    }
    output[key] = stripInternalFilesystemPaths(entry, seen);
  }
  seen.delete(value);
  return output;
}

module.exports = {
  REDACTED,
  SAFE_JSON_NAME_PATTERN,
  belongsToTenant,
  isSensitiveSelector,
  normalizeJsonName,
  normalizeTenantKey,
  protectRecordingSecrets,
  redactDeep,
  redactText,
  redactUrl,
  resolveContainedJsonPath,
  safeString,
  secretTemplateFor,
  stripInternalFilesystemPaths,
  tenantFromArtifact,
  tenantFromRequest,
};
