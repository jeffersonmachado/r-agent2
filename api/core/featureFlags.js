/**
 * Feature Flag Manager
 *
 * Sistema de gerenciamento de feature flags com suporte a:
 * - Configuração base por flag
 * - Overrides por tenant
 * - Overrides por usuário (prioridade mais alta)
 * - Estratégias de rollout: gradual, whitelist, blacklist, por grupo
 * - Singleton global configurável
 *
 * Módulo universal (ESM) — compatível com Node.js e browser.
 * @module api/core/featureFlags
 */

/* -----------------------------------------------------------------------
 * FeatureFlagManager
 * --------------------------------------------------------------------- */

const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_FLAG_VALUE_DEPTH = 8;
const MAX_SCOPE_LIST_LENGTH = 10000;
const MAX_RECORD_ENTRIES = 10000;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && !BLOCKED_KEYS.has(key);
}

function safeGet(record, key) {
  if (!record) return undefined;
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function safeHasOwn(record, key) {
  try {
    return Object.prototype.hasOwnProperty.call(record, key);
  } catch {
    return false;
  }
}

function safeEntries(record) {
  if (!isRecord(record)) return [];
  let keys = [];
  try {
    keys = Object.keys(record);
  } catch {
    return [];
  }
  const entries = [];
  const boundedKeys = keys.slice(0, MAX_RECORD_ENTRIES);
  for (const key of boundedKeys) {
    try {
      entries.push([key, record[key]]);
    } catch {
      // Ignore properties that throw on access.
    }
  }
  return entries;
}

function normalizeFlagName(flagName) {
  if (typeof flagName !== 'string') return '';
  const normalized = flagName.trim();
  if (!isSafeKey(normalized)) return '';
  return normalized;
}

function normalizeFlagValue(value, depth = 0) {
  if (depth >= MAX_FLAG_VALUE_DEPTH) return false;
  if (isRecord(value)) {
    if (safeHasOwn(value, 'enabled')) {
      try {
        return normalizeFlagValue(value.enabled, depth + 1);
      } catch {
        return false;
      }
    }
    return false;
  }
  if (Array.isArray(value)) return false;
  if (value == null) return false;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (['null', 'undefined', 'nan'].includes(normalized)) return false;
    if (['false', '0', 'off', 'no', 'disabled'].includes(normalized)) return false;
    if (['true', '1', 'on', 'yes', 'enabled'].includes(normalized)) return true;
    const numericLike = Number(normalized);
    if (Number.isFinite(numericLike)) return numericLike !== 0;
    return false;
  }
  return Boolean(value);
}

function createSafeRecord(input) {
  if (!isRecord(input)) return Object.create(null);
  const output = Object.create(null);
  for (const [key, value] of safeEntries(input)) {
    const normalizedKey = normalizeFlagName(key);
    if (!normalizedKey) continue;
    output[normalizedKey] = normalizeFlagValue(value);
  }
  return output;
}

function mergeRecords(...records) {
  const output = Object.create(null);
  for (const record of records) {
    if (!isRecord(record)) continue;
    for (const [key, value] of safeEntries(record)) {
      const normalizedKey = normalizeFlagName(key);
      if (!normalizedKey) continue;
      output[normalizedKey] = normalizeFlagValue(value);
    }
  }
  return output;
}

function collectFlagNamesFromRecord(record, targetSet) {
  if (!isRecord(record) || !(targetSet instanceof Set)) return;
  for (const [flagKey] of safeEntries(record)) {
    const normalizedFlag = normalizeFlagName(flagKey);
    if (!normalizedFlag) continue;
    targetSet.add(normalizedFlag);
  }
}

function collectFlagNamesFromScopedOverrides(scopedOverrides, targetSet) {
  if (!isRecord(scopedOverrides) || !(targetSet instanceof Set)) return;
  for (const [, flags] of safeEntries(scopedOverrides)) {
    collectFlagNamesFromRecord(flags, targetSet);
  }
}

function toExportFlagRecord(record) {
  const output = {};
  if (!isRecord(record)) return output;
  for (const [flagKey, flagValue] of safeEntries(record)) {
    const normalizedFlag = normalizeFlagName(flagKey);
    if (!normalizedFlag) continue;
    output[normalizedFlag] = normalizeFlagValue(flagValue);
  }
  return output;
}

function toExportScopedOverrides(scopedOverrides) {
  const output = {};
  if (!isRecord(scopedOverrides)) return output;
  for (const [scopeId, flags] of safeEntries(scopedOverrides)) {
    const normalizedScopeId = normalizeScopeId(scopeId);
    if (!normalizedScopeId) continue;
    output[normalizedScopeId] = toExportFlagRecord(flags);
  }
  return output;
}

function getOverrideValue(scopedOverrides, scopeId, flagName) {
  if (!scopeId || !flagName) return undefined;
  const scopeFlags = safeGet(scopedOverrides, scopeId);
  if (!isRecord(scopeFlags)) return undefined;
  if (!safeHasOwn(scopeFlags, flagName)) return undefined;
  return safeGet(scopeFlags, flagName);
}

function normalizeScopeId(scopeId) {
  if (typeof scopeId !== 'string') return '';
  const normalized = scopeId.trim();
  if (!isSafeKey(normalized)) return '';
  return normalized;
}

function safeToFiniteNumber(value) {
  try {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
  } catch {
    return null;
  }
}

function normalizePercentage(value) {
  const numericValue = safeToFiniteNumber(value);
  if (numericValue == null) return null;
  if (numericValue < 0) return 0;
  if (numericValue > 100) return 100;
  return numericValue;
}

function normalizeStartDate(value) {
  if (value instanceof Date) {
    try {
      if (Number.isFinite(value.getTime())) return value;
    } catch {
      // Fall through to default date.
    }
  }
  if (typeof value === 'number') {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const numericTimestamp = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (Number.isFinite(numericTimestamp)) {
      const parsedFromTimestamp = new Date(numericTimestamp);
      if (Number.isFinite(parsedFromTimestamp.getTime())) return parsedFromTimestamp;
    }
    const parsed = new Date(trimmed);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  return new Date();
}

function normalizeScopeIdList(input) {
  if (!Array.isArray(input)) return [];
  let length = 0;
  try {
    length = input.length;
  } catch {
    return [];
  }

  const normalizedList = [];
  const boundedLength = Math.min(length, MAX_SCOPE_LIST_LENGTH);
  for (let index = 0; index < boundedLength; index += 1) {
    const normalizedValue = normalizeScopeId(safeGet(input, index));
    if (!normalizedValue) continue;
    normalizedList.push(normalizedValue);
  }
  return normalizedList;
}

export class FeatureFlagManager {
  /**
   * @param {Object} [config={}] Mapa de flag -> valor booleano padrão
   */
  constructor(config = {}) {
    this._config = createSafeRecord(config);
    this._tenantOverrides = Object.create(null);
    this._userOverrides = Object.create(null);
  }

  /**
   * Verifica se uma feature está habilitada para um dado contexto.
   * Prioridade: user override > tenant override > config base.
   *
   * @param {string} flagName
   * @param {{ tenantId?: string, userId?: string }} [context={}]
   * @returns {boolean}
   */
  isEnabled(flagName, context = {}) {
    const normalizedFlagName = normalizeFlagName(flagName);
    if (!normalizedFlagName) return false;
    const tenantId = normalizeScopeId(safeGet(context, 'tenantId'));
    const userId = normalizeScopeId(safeGet(context, 'userId'));

    const userOverride = getOverrideValue(this._userOverrides, userId, normalizedFlagName);
    if (userOverride !== undefined) {
      return normalizeFlagValue(userOverride);
    }

    const tenantOverride = getOverrideValue(this._tenantOverrides, tenantId, normalizedFlagName);
    if (tenantOverride !== undefined) {
      return normalizeFlagValue(tenantOverride);
    }

    return normalizeFlagValue(safeGet(this._config, normalizedFlagName));
  }

  /**
   * Define (ou mescla) flags para um tenant específico.
   * @param {string} tenantId
   * @param {Object} flags
   */
  setTenantFlags(tenantId, flags) {
    const safeTenantId = normalizeScopeId(tenantId);
    if (!safeTenantId) return;
    const safeFlags = createSafeRecord(flags);
    this._tenantOverrides[safeTenantId] = mergeRecords(this._tenantOverrides[safeTenantId], safeFlags);
  }

  /**
   * Define (ou mescla) flags para um usuário específico.
   * @param {string} userId
   * @param {Object} flags
   */
  setUserFlags(userId, flags) {
    const safeUserId = normalizeScopeId(userId);
    if (!safeUserId) return;
    const safeFlags = createSafeRecord(flags);
    this._userOverrides[safeUserId] = mergeRecords(this._userOverrides[safeUserId], safeFlags);
  }

  /**
   * Retorna o status de todas as features para um dado contexto.
   * @param {{ tenantId?: string, userId?: string }} [context={}]
   * @returns {Object}
   */
  getFeatureStatus(context = {}) {
    const allKeys = new Set();
    collectFlagNamesFromRecord(this._config, allKeys);
    collectFlagNamesFromScopedOverrides(this._tenantOverrides, allKeys);
    collectFlagNamesFromScopedOverrides(this._userOverrides, allKeys);

    const status = {};
    for (const key of allKeys) {
      status[key] = this.isEnabled(key, context);
    }
    return status;
  }

  /**
   * Exporta a configuração atual (para persistência ou transferência).
   * @returns {{ config: Object, tenantOverrides: Object, userOverrides: Object, exportedAt: string }}
   */
  export() {
    const safeConfig = toExportFlagRecord(this._config);
    const safeTenantOverrides = toExportScopedOverrides(this._tenantOverrides);
    const safeUserOverrides = toExportScopedOverrides(this._userOverrides);

    return {
      config: safeConfig,
      tenantOverrides: safeTenantOverrides,
      userOverrides: safeUserOverrides,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Importa uma configuração previamente exportada.
   * @param {{ config?: Object, tenantOverrides?: Object, userOverrides?: Object }} exported
   */
  import(exported) {
    if (!exported) return;
    const exportedConfig = safeGet(exported, 'config');
    const exportedTenantOverrides = safeGet(exported, 'tenantOverrides');
    const exportedUserOverrides = safeGet(exported, 'userOverrides');

    if (isRecord(exportedConfig)) this._config = createSafeRecord(exportedConfig);
    if (isRecord(exportedTenantOverrides)) {
      const nextTenantOverrides = Object.create(null);
      for (const [tenantId, tenantFlags] of safeEntries(exportedTenantOverrides)) {
        const safeTenantId = normalizeScopeId(tenantId);
        if (!safeTenantId) continue;
        nextTenantOverrides[safeTenantId] = createSafeRecord(tenantFlags);
      }
      this._tenantOverrides = nextTenantOverrides;
    }
    if (isRecord(exportedUserOverrides)) {
      const nextUserOverrides = Object.create(null);
      for (const [userId, userFlags] of safeEntries(exportedUserOverrides)) {
        const safeUserId = normalizeScopeId(userId);
        if (!safeUserId) continue;
        nextUserOverrides[safeUserId] = createSafeRecord(userFlags);
      }
      this._userOverrides = nextUserOverrides;
    }
  }
}

/* -----------------------------------------------------------------------
 * RolloutStrategy
 * --------------------------------------------------------------------- */

export class RolloutStrategy {
  /**
   * Estratégia de rollout gradual por fases com base em datas/horários.
   *
   * @param {{ startDate: Date, phase1?: { percentage: number, duration?: string }, phase2?: { percentage: number, duration?: string }, phase3?: { percentage: number, duration?: string }, phase4?: { percentage: number } }} options
   * @returns {{ getCurrentPhase(): { phase: number, percentage: number } }}
   */
  static gradual(options) {
    const safeOptions = options && typeof options === 'object' ? options : {};
    const startDate = normalizeStartDate(safeGet(safeOptions, 'startDate'));

    function parseDurationMs(duration) {
      if (!duration) return 0;
      if (typeof duration === 'number') {
        if (!Number.isFinite(duration) || duration <= 0) return 0;
        return duration;
      }
      let normalizedDuration = '';
      try {
        normalizedDuration = String(duration).trim().toLowerCase();
      } catch {
        return 0;
      }
      const numericOnly = safeToFiniteNumber(normalizedDuration);
      if (numericOnly != null) {
        return numericOnly > 0 ? numericOnly : 0;
      }
      const match = normalizedDuration.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/);
      if (!match) return 0;
      const value = parseFloat(match[1]);
      const unit = match[2];
      const multiplierMap = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
      return value * (multiplierMap[unit] || 0);
    }

    const phases = [1, 2, 3, 4]
      .map((n) => {
        const phaseValue = safeGet(safeOptions, `phase${n}`);
        const phaseConfig = isRecord(phaseValue) ? phaseValue : null;
        if (!phaseConfig) return null;
        const percentage = normalizePercentage(safeGet(phaseConfig, 'percentage'));
        if (percentage == null) return null;
        return {
          phase: n,
          percentage,
          durationMs: parseDurationMs(safeGet(phaseConfig, 'duration')),
        };
      })
      .filter(Boolean);

    return {
      getCurrentPhase() {
        if (phases.length === 0) {
          return { phase: 0, percentage: 0 };
        }
        const elapsed = Date.now() - startDate.getTime();
        let accumulated = 0;
        for (let index = 0; index < phases.length; index += 1) {
          const phaseConfig = phases[index];
          const isLastPhase = index === phases.length - 1;
          const duration = phaseConfig.durationMs;
          if (duration > 0 && elapsed < accumulated + duration) {
            return { phase: phaseConfig.phase, percentage: phaseConfig.percentage };
          }
          if (duration > 0) {
            accumulated += duration;
          } else {
            if (isLastPhase) {
              // Last phase — no duration constraint
              return { phase: phaseConfig.phase, percentage: phaseConfig.percentage };
            }
            // Intermediate zero-duration phases are skipped.
            continue;
          }
        }
        const last = phases[phases.length - 1];
        return { phase: last.phase, percentage: last.percentage };
      },
    };
  }

  /**
   * Estratégia de whitelist: habilitado apenas para tenants listados.
   * @param {string[]} allowedTenantIds
   * @returns {{ isEnabled(tenantId: string): boolean }}
   */
  static whitelist(allowedTenantIds) {
    const set = new Set(normalizeScopeIdList(allowedTenantIds));
    return {
      isEnabled(tenantId) {
        const normalizedTenantId = normalizeScopeId(tenantId);
        if (!normalizedTenantId) return false;
        return set.has(normalizedTenantId);
      },
    };
  }

  /**
   * Estratégia de blacklist: bloqueado apenas para tenants listados.
   * @param {string[]} blockedTenantIds
   * @returns {{ isEnabled(tenantId: string): boolean }}
   */
  static blacklist(blockedTenantIds) {
    const set = new Set(normalizeScopeIdList(blockedTenantIds));
    return {
      isEnabled(tenantId) {
        const normalizedTenantId = normalizeScopeId(tenantId);
        if (!normalizedTenantId) return true;
        return !set.has(normalizedTenantId);
      },
    };
  }

  /**
   * Estratégia por grupo: decide com base no campo `group` do contexto.
   * @param {Object} groupMap Mapa { groupName: { enabled: boolean } }
   * @returns {{ isEnabled(context: { group: string }): boolean }}
   */
  static byGroup(groupMap) {
    const safeGroupMap = Object.create(null);
    if (isRecord(groupMap)) {
      for (const [groupKey, groupValue] of safeEntries(groupMap)) {
        const normalizedGroupKey = normalizeScopeId(groupKey);
        if (!normalizedGroupKey || !isRecord(groupValue)) continue;
        safeGroupMap[normalizedGroupKey] = groupValue;
      }
    }
    return {
      isEnabled(context) {
        const group = normalizeScopeId(safeGet(context, 'group'));
        const groupConfig = safeGet(safeGroupMap, group);
        if (!group || !groupConfig || !isRecord(groupConfig)) return false;
        return normalizeFlagValue(groupConfig);
      },
    };
  }
}

/* -----------------------------------------------------------------------
 * Singleton global
 * --------------------------------------------------------------------- */

let _globalManager = null;

/**
 * Retorna o singleton global do FeatureFlagManager.
 * Se não foi inicializado, cria uma instância padrão vazia.
 * @returns {FeatureFlagManager}
 */
export function getFeatureFlagManager() {
  if (!_globalManager) {
    _globalManager = new FeatureFlagManager();
  }
  return _globalManager;
}

/**
 * Inicializa (ou reinicializa) o singleton global com a configuração fornecida.
 * @param {Object} config
 * @returns {FeatureFlagManager}
 */
export function initializeFeatureFlagManager(config = {}) {
  _globalManager = new FeatureFlagManager(config);
  return _globalManager;
}
