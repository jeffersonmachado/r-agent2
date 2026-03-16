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

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeKey(key) {
  return typeof key === 'string' && key.length > 0 && !BLOCKED_KEYS.has(key);
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
    if (Object.prototype.hasOwnProperty.call(value, 'enabled')) {
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
  for (const [key, value] of Object.entries(input)) {
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
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = normalizeFlagName(key);
      if (!normalizedKey) continue;
      output[normalizedKey] = normalizeFlagValue(value);
    }
  }
  return output;
}

function normalizeScopeId(scopeId) {
  if (typeof scopeId !== 'string') return '';
  const normalized = scopeId.trim();
  if (!isSafeKey(normalized)) return '';
  return normalized;
}

function normalizePercentage(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  if (numericValue < 0) return 0;
  if (numericValue > 100) return 100;
  return numericValue;
}

function normalizeStartDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
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
    const tenantId = normalizeScopeId(context?.tenantId);
    const userId = normalizeScopeId(context?.userId);

    if (userId && this._userOverrides[userId]) {
      const userFlags = this._userOverrides[userId];
      if (Object.prototype.hasOwnProperty.call(userFlags, normalizedFlagName)) {
        return Boolean(userFlags[normalizedFlagName]);
      }
    }

    if (tenantId && this._tenantOverrides[tenantId]) {
      const tenantFlags = this._tenantOverrides[tenantId];
      if (Object.prototype.hasOwnProperty.call(tenantFlags, normalizedFlagName)) {
        return Boolean(tenantFlags[normalizedFlagName]);
      }
    }

    return Boolean(this._config[normalizedFlagName]);
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
    const tenantKeySets = Object.values(this._tenantOverrides)
      .filter((value) => value && typeof value === 'object')
      .flatMap((value) => Object.keys(value));
    const userKeySets = Object.values(this._userOverrides)
      .filter((value) => value && typeof value === 'object')
      .flatMap((value) => Object.keys(value));

    const allKeys = new Set([
      ...Object.keys(this._config),
      ...tenantKeySets,
      ...userKeySets,
    ]);

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
    return {
      config: { ...this._config },
      tenantOverrides: JSON.parse(JSON.stringify(this._tenantOverrides)),
      userOverrides: JSON.parse(JSON.stringify(this._userOverrides)),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Importa uma configuração previamente exportada.
   * @param {{ config?: Object, tenantOverrides?: Object, userOverrides?: Object }} exported
   */
  import(exported) {
    if (!exported) return;
    if (isRecord(exported.config)) this._config = createSafeRecord(exported.config);
    if (isRecord(exported.tenantOverrides)) {
      const nextTenantOverrides = Object.create(null);
      for (const [tenantId, tenantFlags] of Object.entries(exported.tenantOverrides)) {
        const safeTenantId = normalizeScopeId(tenantId);
        if (!safeTenantId) continue;
        nextTenantOverrides[safeTenantId] = createSafeRecord(tenantFlags);
      }
      this._tenantOverrides = nextTenantOverrides;
    }
    if (isRecord(exported.userOverrides)) {
      const nextUserOverrides = Object.create(null);
      for (const [userId, userFlags] of Object.entries(exported.userOverrides)) {
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
    const startDate = normalizeStartDate(safeOptions.startDate);

    function parseDurationMs(duration) {
      if (!duration) return 0;
      if (typeof duration === 'number') {
        if (!Number.isFinite(duration) || duration <= 0) return 0;
        return duration;
      }
      const normalizedDuration = String(duration).trim().toLowerCase();
      const numericOnly = Number(normalizedDuration);
      if (Number.isFinite(numericOnly)) {
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
        const phaseConfig = isRecord(safeOptions[`phase${n}`]) ? safeOptions[`phase${n}`] : null;
        if (!phaseConfig) return null;
        const percentage = normalizePercentage(phaseConfig.percentage);
        if (percentage == null) return null;
        return {
          phase: n,
          percentage,
          durationMs: parseDurationMs(phaseConfig.duration),
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
    const set = new Set(
      (Array.isArray(allowedTenantIds) ? allowedTenantIds : [])
        .map((tenantId) => normalizeScopeId(tenantId))
        .filter(Boolean)
    );
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
    const set = new Set(
      (Array.isArray(blockedTenantIds) ? blockedTenantIds : [])
        .map((tenantId) => normalizeScopeId(tenantId))
        .filter(Boolean)
    );
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
      for (const [groupKey, groupValue] of Object.entries(groupMap)) {
        const normalizedGroupKey = normalizeScopeId(groupKey);
        if (!normalizedGroupKey || !isRecord(groupValue)) continue;
        safeGroupMap[normalizedGroupKey] = groupValue;
      }
    }
    return {
      isEnabled(context) {
        const group = normalizeScopeId(context && context.group);
        if (!group || !safeGroupMap[group] || !isRecord(safeGroupMap[group])) return false;
        return normalizeFlagValue(safeGroupMap[group].enabled);
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
