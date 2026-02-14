/**
 * Envelope padrão obrigatório para outputs de IA (contract-first + safe-mode).
 *
 * Regras:
 * - Outputs de IA são SEMPRE não confiáveis.
 * - Toda resposta deve:
 *   - ser encapsulada em envelope
 *   - ser validada por contrato (AJV) (envelope + domínio)
 *   - registrar auditoria/telemetria (feito nos chamadores)
 *
 * Exporta (conforme especificação do projeto):
 * - buildAiEnvelope(domain, data, validationResult, meta)
 * - validateAiEnvelopeOrThrow(envelope)
 * - sanitizeAiEnvelope(envelope)
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ENVELOPE_VERSION = '1.0';
const ALLOWED_DOMAINS = new Set(['chatbot_flow', 'rpa_test', 'tenant']);
const ENVELOPE_SCHEMA_PATH = path.resolve(process.cwd(), 'contracts/ia/ai-output-envelope.schema.json');

let _ajv = null;
let _validateEnvelope = null;
const _schemaValidators = new Map(); // absPath -> validateFn

function getAjv() {
  if (_ajv) return _ajv;
  _ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
  });
  addFormats(_ajv);
  return _ajv;
}

function readJson(absPath) {
  const raw = fs.readFileSync(absPath, 'utf8');
  return JSON.parse(raw);
}

function normalizeString(value, maxLen) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '') return '';
  if (typeof maxLen === 'number' && maxLen > 0 && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function normalizeNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeStringArray(value, { maxItems = 50, maxLen = 200 } = {}) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const v of arr) {
    const s = normalizeString(v, maxLen);
    if (s && typeof s === 'string' && s.trim()) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * Valida dados por um contrato JSON Schema (AJV).
 *
 * @param {string} schemaPath - Caminho relativo (repo root) ou absoluto
 * @param {any} data
 * @returns {{ valid: boolean, errors: any[] }}
 */
function validateByContract(schemaPath, data) {
  const ajv = getAjv();
  const abs = path.isAbsolute(schemaPath) ? schemaPath : path.resolve(process.cwd(), schemaPath);
  let validateFn = _schemaValidators.get(abs);
  if (!validateFn) {
    const schema = readJson(abs);
    validateFn = ajv.compile(schema);
    _schemaValidators.set(abs, validateFn);
  }
  const ok = validateFn(data);
  return { valid: ok === true, errors: validateFn.errors ? [...validateFn.errors] : [] };
}

/**
 * Sanitiza envelope removendo valores inesperados e normalizando tipos/limites.
 *
 * @param {any} envelope
 * @returns {any}
 */
function sanitizeAiEnvelope(envelope) {
  const env = (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) ? envelope : {};

  const domain = normalizeString(env.domain, 50);
  const safeDomain = (domain && ALLOWED_DOMAINS.has(domain)) ? domain : (domain || null);

  const providerRaw = (env.provider && typeof env.provider === 'object' && !Array.isArray(env.provider)) ? env.provider : {};
  const inputRaw = (env.input && typeof env.input === 'object' && !Array.isArray(env.input)) ? env.input : {};
  const validationRaw = (env.validation && typeof env.validation === 'object' && !Array.isArray(env.validation)) ? env.validation : {};
  const auditRaw = (env.audit && typeof env.audit === 'object' && !Array.isArray(env.audit)) ? env.audit : {};

  const out = {
    envelope_version: ENVELOPE_VERSION,
    domain: safeDomain,
    created_at: normalizeString(env.created_at, 40) || new Date().toISOString(),
    provider: {
      name: Object.prototype.hasOwnProperty.call(providerRaw, 'name') ? normalizeString(providerRaw.name, 100) : null,
      model: Object.prototype.hasOwnProperty.call(providerRaw, 'model') ? normalizeString(providerRaw.model, 200) : null,
      temperature: Object.prototype.hasOwnProperty.call(providerRaw, 'temperature') ? normalizeNumberOrNull(providerRaw.temperature) : null,
    },
    input: {
      prompt_summary: Object.prototype.hasOwnProperty.call(inputRaw, 'prompt_summary') ? normalizeString(inputRaw.prompt_summary, 4000) : null,
      user_goal: Object.prototype.hasOwnProperty.call(inputRaw, 'user_goal') ? normalizeString(inputRaw.user_goal, 4000) : null,
      context: (Object.prototype.hasOwnProperty.call(inputRaw, 'context') && inputRaw.context && typeof inputRaw.context === 'object' && !Array.isArray(inputRaw.context))
        ? inputRaw.context
        : {},
    },
    output: (env.output && typeof env.output === 'object' && !Array.isArray(env.output)) ? env.output : {},
    validation: {
      valid: validationRaw.valid === true,
      errors: Array.isArray(validationRaw.errors) ? validationRaw.errors : [],
      warnings: Array.isArray(validationRaw.warnings) ? validationRaw.warnings : [],
      qualityScore: Number.isFinite(Number(validationRaw.qualityScore)) ? Math.max(0, Math.min(100, Math.round(Number(validationRaw.qualityScore)))) : 0,
      riskFlags: normalizeStringArray(validationRaw.riskFlags, { maxItems: 50, maxLen: 200 }),
    },
    audit: {
      request_id: Object.prototype.hasOwnProperty.call(auditRaw, 'request_id') ? normalizeString(auditRaw.request_id, 200) : null,
      seed: Object.prototype.hasOwnProperty.call(auditRaw, 'seed') ? normalizeString(auditRaw.seed, 200) : null,
      tenant_id: Object.prototype.hasOwnProperty.call(auditRaw, 'tenant_id') ? normalizeString(auditRaw.tenant_id, 100) : null,
      user_id: Object.prototype.hasOwnProperty.call(auditRaw, 'user_id') ? normalizeString(auditRaw.user_id, 200) : null,
    },
  };

  return out;
}

/**
 * Constrói envelope padrão do projeto.
 *
 * @param {'chatbot_flow'|'rpa_test'|'tenant'} domain
 * @param {any} data - output bruto do domínio
 * @param {any} validationResult - { valid, errors, warnings, qualityScore, riskFlags }
 * @param {any} meta - { provider, input, audit, rawModelOutput? }
 * @returns {any}
 */
function buildAiEnvelope(domain, data, validationResult = {}, meta = {}) {
  const safeDomain = (typeof domain === 'string' && ALLOWED_DOMAINS.has(domain)) ? domain : null;

  const provider = meta?.provider || {};
  const audit = meta?.audit || {};
  const input = meta?.input || {};
  const context = (input && typeof input.context === 'object' && input.context && !Array.isArray(input.context)) ? input.context : {};

  // Se o chamador quiser guardar texto bruto do modelo, fazemos isso dentro de input.context
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'rawModelOutput')) {
    context.raw_model_output = meta.rawModelOutput;
  }

  const envelope = sanitizeAiEnvelope({
    domain: safeDomain,
    created_at: new Date().toISOString(),
    provider: {
      name: Object.prototype.hasOwnProperty.call(provider, 'name') ? provider.name : null,
      model: Object.prototype.hasOwnProperty.call(provider, 'model') ? provider.model : null,
      temperature: Object.prototype.hasOwnProperty.call(provider, 'temperature') ? provider.temperature : null,
    },
    input: {
      prompt_summary: Object.prototype.hasOwnProperty.call(input, 'prompt_summary') ? input.prompt_summary : null,
      user_goal: Object.prototype.hasOwnProperty.call(input, 'user_goal') ? input.user_goal : null,
      context,
    },
    output: (data && typeof data === 'object' && !Array.isArray(data)) ? data : {},
    validation: {
      valid: validationResult?.valid === true,
      errors: Array.isArray(validationResult?.errors) ? validationResult.errors : [],
      warnings: Array.isArray(validationResult?.warnings) ? validationResult.warnings : [],
      qualityScore: Number.isFinite(Number(validationResult?.qualityScore)) ? validationResult.qualityScore : (validationResult?.valid === true ? 100 : 0),
      riskFlags: Array.isArray(validationResult?.riskFlags) ? validationResult.riskFlags : [],
    },
    audit: {
      request_id: Object.prototype.hasOwnProperty.call(audit, 'request_id') ? audit.request_id : null,
      seed: Object.prototype.hasOwnProperty.call(audit, 'seed') ? audit.seed : null,
      tenant_id: Object.prototype.hasOwnProperty.call(audit, 'tenant_id') ? audit.tenant_id : null,
      user_id: Object.prototype.hasOwnProperty.call(audit, 'user_id') ? audit.user_id : null,
    },
  });

  return envelope;
}

/**
 * Valida envelope (AJV) e lança erro se inválido.
 *
 * @param {any} envelope
 * @returns {any} envelope sanitizado
 */
function validateAiEnvelopeOrThrow(envelope) {
  const ajv = getAjv();
  if (!_validateEnvelope) {
    const schema = readJson(ENVELOPE_SCHEMA_PATH);
    _validateEnvelope = ajv.compile(schema);
  }
  const sanitized = sanitizeAiEnvelope(envelope);
  const ok = _validateEnvelope(sanitized);
  if (ok !== true) {
    const err = new Error('Envelope de IA inválido (contrato AJV falhou)');
    // @ts-ignore
    err.code = 'AI_ENVELOPE_CONTRACT_INVALID';
    // @ts-ignore
    err.details = { errors: _validateEnvelope.errors ? [..._validateEnvelope.errors] : [] };
    throw err;
  }
  return sanitized;
}

module.exports = {
  buildAiEnvelope,
  validateAiEnvelopeOrThrow,
  sanitizeAiEnvelope,
  // Export extra: util interno para validação por contrato (AJV)
  validateByContract,
  ENVELOPE_VERSION,
};

