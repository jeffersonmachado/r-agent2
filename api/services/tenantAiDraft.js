/**
 * Utilitário para geração/validação de tenant "safe-mode" a partir de output de IA.
 *
 * Regras mandatórias (hardening):
 * - status = pending_review
 * - integrações externas desativadas por padrão
 * - tenant_key (slug) seguro
 * - proibir campos sensíveis (tokens, api keys, secrets, etc.)
 * - validação contract-first via AJV (contracts/tenant.contract.json)
 *
 * IMPORTANTE:
 * - outputs de IA são SEMPRE não confiáveis
 * - este módulo constrói um draft por whitelist (não confia no shape do modelo)
 */

const FORBIDDEN_SENSITIVE_KEYS = [
  'secret',
  // 'token' é ambíguo (ex.: tokens_ia é quota). Preferimos padrões específicos.
  'access_token',
  'refresh_token',
  'id_token',
  'apikey',
  'api_key',
  'password',
  'credential',
  'private_key',
];

function slugifyTenantKey(name) {
  const base = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  const candidate = base.length >= 3 ? base : `tenant-${Date.now()}`;
  return candidate.slice(0, 50);
}

function containsSensitiveKeys(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || depth > 6) return false;
  for (const [k, v] of Object.entries(obj)) {
    const keyLower = String(k).toLowerCase();
    if (FORBIDDEN_SENSITIVE_KEYS.some(x => keyLower.includes(x))) return true;
    if (v && typeof v === 'object' && containsSensitiveKeys(v, depth + 1)) return true;
  }
  return false;
}

function buildTenantDraftFromAi(tenantData, options = {}) {
  const tenant_key = options.tenant_key || slugifyTenantKey(tenantData?.name);
  return {
    tenant_key,
    name: String(tenantData?.name || '').trim(),
    site: String(tenantData?.site || 'https://exemplo.com').trim(),
    ramo_atividade: String(tenantData?.ramo_atividade || '').trim(),
    objetivo: String(tenantData?.objetivo || '').trim(),
    status: 'pending_review',
    plan: 'trial',
    limits: {
      usuarios: 1,
      agentes_ia: 1,
      execucoes_rpa: 0,
      tokens_ia: 5000,
      documentos_rag: 0,
      storage_mb: 50,
    },
    settings: {
      externalIntegrationsEnabled: false,
      webScrapingEnabled: false,
    },
    branding: {},
  };
}

function clampString(v, maxLen) {
  const s = String(v || '').trim();
  if (!Number.isFinite(maxLen) || maxLen <= 0) return s;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen).trim();
}

/**
 * @param {any} draft
 * @param {any} tenantContract - contracts/tenant.contract.json
 * @returns {{ valid: boolean, errors: Array<{code:string,message:string}>, warnings: any[], riskFlags: string[], qualityScore: number }}
 */
function validateTenantDraft(draft, tenantContract) {
  const errors = [];
  const warnings = [];
  const riskFlags = ['PENDING_REVIEW'];
  let qualityScore = 100;

  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) {
    return { valid: false, errors: [{ code: 'INVALID_TENANT', message: 'Tenant draft deve ser um objeto' }], warnings, riskFlags, qualityScore: 0 };
  }

  // contrato: additionalProperties=false via whitelist
  const allowedKeys = new Set(Object.keys(tenantContract?.properties || {}));
  for (const k of Object.keys(draft)) {
    if (!allowedKeys.has(k)) errors.push({ code: 'ADDITIONAL_PROPERTY', message: `Campo não permitido: ${k}` });
  }
  for (const reqKey of tenantContract?.required || []) {
    if (!Object.prototype.hasOwnProperty.call(draft, reqKey)) errors.push({ code: 'REQUIRED', message: `Campo obrigatório ausente: ${reqKey}` });
  }

  // slug seguro
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(draft.tenant_key || '')) {
    errors.push({ code: 'TENANT_KEY_INVALID', message: 'tenant_key inválido (slug inseguro)' });
  }

  // safe-mode
  if (draft.status !== 'pending_review') errors.push({ code: 'STATUS_REQUIRED', message: 'status deve ser pending_review no nascimento por IA' });
  if (draft.settings && draft.settings.externalIntegrationsEnabled === true) {
    errors.push({ code: 'EXTERNAL_INTEGRATIONS_FORBIDDEN', message: 'Integrações externas devem nascer desativadas' });
  }

  // proibir segredos
  if (containsSensitiveKeys(draft)) {
    errors.push({ code: 'SENSITIVE_FIELDS_FORBIDDEN', message: 'Campos sensíveis são proibidos no nascimento do tenant' });
  }

  // heurísticas (score)
  if ((draft.site || '').includes('exemplo.com')) {
    warnings.push({ code: 'SITE_PLACEHOLDER', message: 'Site está usando placeholder (https://exemplo.com)' });
    qualityScore -= 10;
    riskFlags.push('SITE_PLACEHOLDER');
  }
  if (!draft.ramo_atividade || draft.ramo_atividade.length < 20) {
    warnings.push({ code: 'RAMO_WEAK', message: 'ramo_atividade parece curto; pode ficar genérico' });
    qualityScore -= 10;
  }

  if (qualityScore < 0) qualityScore = 0;
  if (qualityScore > 100) qualityScore = 100;
  return { valid: errors.length === 0, errors, warnings, riskFlags: Array.from(new Set(riskFlags)), qualityScore };
}

/**
 * Contract-first (AJV) + safe-mode real:
 * - sempre produz tenantDraft com defaults seguros
 * - valida contra tenant.contract.json com AJV
 *
 * @param {any} aiTenantData - output bruto da IA (não confiável)
 * @param {{ tenantContractPath: string, tenant_key?: string }} options
 * @returns {{ tenantDraft: any, valid: boolean, errors: any[], warnings: any[], riskFlags: string[], qualityScore: number }}
 */
function createTenantAiDraft(aiTenantData, options = {}) {
  const tenantContractPath = options.tenantContractPath || 'contracts/tenant.contract.json';
  const tenant_key = options.tenant_key || slugifyTenantKey(aiTenantData?.name);

  const tenantDraft = buildTenantDraftFromAi(aiTenantData, { tenant_key });
  const warnings = [];
  const riskFlags = ['PENDING_REVIEW'];
  let qualityScore = 100;

  // Enforce contract maxLength deterministically (evita falhas por texto "bom, mas longo").
  // IMPORTANT: deve acontecer ANTES do AJV.
  const contract = require('../../contracts/tenant.contract.json');
  const ramoMax = contract?.properties?.ramo_atividade?.maxLength;
  const objMax = contract?.properties?.objetivo?.maxLength;

  const originalRamo = tenantDraft.ramo_atividade;
  const originalObj = tenantDraft.objetivo;
  if (Number.isFinite(ramoMax)) tenantDraft.ramo_atividade = clampString(tenantDraft.ramo_atividade, ramoMax);
  if (Number.isFinite(objMax)) tenantDraft.objetivo = clampString(tenantDraft.objetivo, objMax);

  const truncations = [];
  if (originalRamo && tenantDraft.ramo_atividade && originalRamo.length !== tenantDraft.ramo_atividade.length) {
    truncations.push({ field: 'ramo_atividade', originalLength: originalRamo.length, maxLength: ramoMax });
  }
  if (originalObj && tenantDraft.objetivo && originalObj.length !== tenantDraft.objetivo.length) {
    truncations.push({ field: 'objetivo', originalLength: originalObj.length, maxLength: objMax });
  }
  if (truncations.length > 0) {
    warnings.push({
      code: 'FIELDS_TRUNCATED',
      message: 'Alguns campos foram truncados para atender ao contrato (maxLength).',
      details: truncations,
    });
    riskFlags.push('FIELDS_TRUNCATED');
    qualityScore -= 5;
  }

  // Proibir segredos no payload bruto (defesa extra; ainda assim construímos por whitelist)
  if (containsSensitiveKeys(aiTenantData)) {
    riskFlags.push('SENSITIVE_FIELDS_DETECTED');
    warnings.push({
      code: 'SENSITIVE_FIELDS_DETECTED',
      message: 'Campos sensíveis foram detectados no output bruto do modelo (foram ignorados/descartados)',
    });
    qualityScore -= 20;
  }

  // AJV contract-first (FORMA)
  const { validateByContract } = require('../../engine/ai/aiEnvelope');
  const ajvRes = validateByContract(tenantContractPath, tenantDraft);
  const errors = [];
  if (!ajvRes.valid) {
    errors.push({
      code: 'TENANT_CONTRACT_AJV_FAILED',
      message: `Tenant draft não passou no contrato AJV (${tenantContractPath})`,
      details: ajvRes.errors || [],
    });
  }

  // Semântica adicional (hardening)
  const semantic = validateTenantDraft(tenantDraft, contract);
  if (!semantic.valid) {
    for (const e of semantic.errors || []) errors.push(e);
  }
  for (const w of semantic.warnings || []) warnings.push(w);
  for (const rf of semantic.riskFlags || []) riskFlags.push(rf);
  if (typeof semantic.qualityScore === 'number') qualityScore = Math.min(qualityScore, semantic.qualityScore);

  if (qualityScore < 0) qualityScore = 0;
  if (qualityScore > 100) qualityScore = 100;

  return {
    tenantDraft,
    valid: errors.length === 0,
    errors,
    warnings,
    riskFlags: Array.from(new Set(riskFlags)),
    qualityScore,
  };
}

module.exports = {
  slugifyTenantKey,
  buildTenantDraftFromAi,
  validateTenantDraft,
  createTenantAiDraft,
};

