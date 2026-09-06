/**
 * Tenant Capabilities (feature flags de produto por tenant).
 *
 * Fonte de verdade: tenant_settings (key = 'capabilities', JSONB) via
 * tenantSettingsService — padrão canônico de feature flags por tenant.
 *
 * Shape persistido:
 *   { caseManagement: boolean, caseCreationPolicy: 'manual'|'suggest'|'automatic',
 *     autonomyLevel: 'suggest'|'approve'|'autonomous'|'exception_only' }
 *
 * Defaults (quando ausente): caseManagement=true preserva tenants existentes
 * (compatibilidade: inbox atual é 100% ticket-based). inbox é sempre true
 * nesta fase. autonomyLevel='suggest' preserva o comportamento manual
 * existente (compatibilidade: nenhuma acao automatica sem opt-in).
 *
 * Sem fallback em memória: falha de DB gera erro explícito
 * (err.code = 'capabilities_db_error').
 */

'use strict';

const tenantSettingsService = require('./tenantSettingsService');
const logger = require('../utils/logger');

const SETTINGS_KEY = 'capabilities';

const CASE_CREATION_POLICIES = ['manual', 'suggest', 'automatic'];

// Níveis de autonomia das recomendações operacionais (tenant-intelligence):
//   suggest        → recomendação fica aberta; aplicação sempre manual (default, compat)
//   approve        → manual + aplicação em lote ("Aprovar todas")
//   autonomous     → aplicação automática na geração
//   exception_only → aplicação automática, exceto prioridade 'high' (exceções humanas)
const AUTONOMY_LEVELS = ['suggest', 'approve', 'autonomous', 'exception_only'];

const DEFAULT_CAPABILITIES = Object.freeze({
  inbox: true,
  caseManagement: true,
  caseCreationPolicy: 'manual',
  autonomyLevel: 'suggest',
});

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function dbError(operation, result) {
  const err = new Error(`capabilities_db_error:${operation}:${safeToString(result && result.error, 'unknown')}`);
  err.code = 'capabilities_db_error';
  err.details = result && result.details;
  return err;
}

function normalizeCapabilities(raw) {
  const stored = raw && typeof raw === 'object' ? raw : {};
  return {
    inbox: true, // sempre true nesta fase
    caseManagement: typeof stored.caseManagement === 'boolean'
      ? stored.caseManagement
      : DEFAULT_CAPABILITIES.caseManagement,
    caseCreationPolicy: CASE_CREATION_POLICIES.includes(stored.caseCreationPolicy)
      ? stored.caseCreationPolicy
      : DEFAULT_CAPABILITIES.caseCreationPolicy,
    autonomyLevel: AUTONOMY_LEVELS.includes(stored.autonomyLevel)
      ? stored.autonomyLevel
      : DEFAULT_CAPABILITIES.autonomyLevel,
  };
}

/**
 * Lê as capabilities do tenant. Defaults compatíveis quando ausentes.
 *
 * @param {string} tenantKey
 * @returns {Promise<{inbox: true, caseManagement: boolean, caseCreationPolicy: string}>}
 * @throws {Error} err.code === 'capabilities_db_error' em falha de DB
 */
async function getTenantCapabilities(tenantKey) {
  const key = safeToString(tenantKey).trim();
  if (!key) {
    const err = new Error('tenantKey é obrigatório');
    err.code = 'invalid_args';
    throw err;
  }

  const result = await tenantSettingsService.getSetting({ tenantId: key, key: SETTINGS_KEY });
  if (!result.ok) {
    // Tenant sem registro na tabela tenants: não há settings possíveis → defaults.
    if (result.error === 'tenant_not_found') {
      return { ...DEFAULT_CAPABILITIES };
    }
    logger.error('[tenantCapabilitiesService] Falha ao ler capabilities do tenant', {
      tenantKey: key,
      error: result.error,
    });
    throw dbError('read', result);
  }

  return normalizeCapabilities(result.value);
}

/**
 * Faz merge validado de um payload parcial e persiste.
 *
 * @param {string} tenantKey
 * @param {object} partial - { caseManagement?, caseCreationPolicy?, inbox? }
 * @returns {Promise<{ok: true, capabilities: object}|{ok: false, error: string, message: string}>}
 * @throws {Error} err.code === 'capabilities_db_error' em falha de DB
 */
async function setTenantCapabilities(tenantKey, partial = {}) {
  const key = safeToString(tenantKey).trim();
  if (!key) {
    return { ok: false, error: 'invalid_args', message: 'tenantKey é obrigatório' };
  }
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return { ok: false, error: 'invalid_payload', message: 'payload deve ser um objeto' };
  }

  const allowedKeys = new Set(['inbox', 'caseManagement', 'caseCreationPolicy', 'autonomyLevel']);
  const unknownKeys = Object.keys(partial).filter((k) => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: `chaves desconhecidas: ${unknownKeys.join(', ')}`,
    };
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'inbox') && partial.inbox !== true) {
    return { ok: false, error: 'invalid_payload', message: 'inbox é sempre true nesta fase' };
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'caseManagement') && typeof partial.caseManagement !== 'boolean') {
    return { ok: false, error: 'invalid_payload', message: 'caseManagement deve ser boolean' };
  }
  if (
    Object.prototype.hasOwnProperty.call(partial, 'caseCreationPolicy')
    && !CASE_CREATION_POLICIES.includes(partial.caseCreationPolicy)
  ) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: `caseCreationPolicy deve ser um de: ${CASE_CREATION_POLICIES.join(', ')}`,
    };
  }
  if (
    Object.prototype.hasOwnProperty.call(partial, 'autonomyLevel')
    && !AUTONOMY_LEVELS.includes(partial.autonomyLevel)
  ) {
    return {
      ok: false,
      error: 'invalid_payload',
      message: `autonomyLevel deve ser um de: ${AUTONOMY_LEVELS.join(', ')}`,
    };
  }

  const current = await getTenantCapabilities(key);
  const next = {
    inbox: true,
    caseManagement: Object.prototype.hasOwnProperty.call(partial, 'caseManagement')
      ? partial.caseManagement
      : current.caseManagement,
    caseCreationPolicy: Object.prototype.hasOwnProperty.call(partial, 'caseCreationPolicy')
      ? partial.caseCreationPolicy
      : current.caseCreationPolicy,
    autonomyLevel: Object.prototype.hasOwnProperty.call(partial, 'autonomyLevel')
      ? partial.autonomyLevel
      : current.autonomyLevel,
  };

  const persisted = await tenantSettingsService.upsertSetting({
    tenantId: key,
    key: SETTINGS_KEY,
    value: {
      caseManagement: next.caseManagement,
      caseCreationPolicy: next.caseCreationPolicy,
      autonomyLevel: next.autonomyLevel,
    },
  });
  if (!persisted.ok) {
    if (persisted.error === 'tenant_not_found') {
      return { ok: false, error: 'tenant_not_found', message: 'tenant não encontrado' };
    }
    logger.error('[tenantCapabilitiesService] Falha ao persistir capabilities do tenant', {
      tenantKey: key,
      error: persisted.error,
    });
    throw dbError('write', persisted);
  }

  return { ok: true, capabilities: next };
}

module.exports = {
  SETTINGS_KEY,
  CASE_CREATION_POLICIES,
  AUTONOMY_LEVELS,
  DEFAULT_CAPABILITIES,
  getTenantCapabilities,
  setTenantCapabilities,
};
