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

export class FeatureFlagManager {
  /**
   * @param {Object} [config={}] Mapa de flag -> valor booleano padrão
   */
  constructor(config = {}) {
    this._config = { ...config };
    this._tenantOverrides = {};
    this._userOverrides = {};
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
    const { tenantId, userId } = context;

    if (userId && this._userOverrides[userId]) {
      const userFlags = this._userOverrides[userId];
      if (Object.prototype.hasOwnProperty.call(userFlags, flagName)) {
        return Boolean(userFlags[flagName]);
      }
    }

    if (tenantId && this._tenantOverrides[tenantId]) {
      const tenantFlags = this._tenantOverrides[tenantId];
      if (Object.prototype.hasOwnProperty.call(tenantFlags, flagName)) {
        return Boolean(tenantFlags[flagName]);
      }
    }

    return Boolean(this._config[flagName]);
  }

  /**
   * Define (ou mescla) flags para um tenant específico.
   * @param {string} tenantId
   * @param {Object} flags
   */
  setTenantFlags(tenantId, flags) {
    this._tenantOverrides[tenantId] = {
      ...(this._tenantOverrides[tenantId] || {}),
      ...flags,
    };
  }

  /**
   * Define (ou mescla) flags para um usuário específico.
   * @param {string} userId
   * @param {Object} flags
   */
  setUserFlags(userId, flags) {
    this._userOverrides[userId] = {
      ...(this._userOverrides[userId] || {}),
      ...flags,
    };
  }

  /**
   * Retorna o status de todas as features para um dado contexto.
   * @param {{ tenantId?: string, userId?: string }} [context={}]
   * @returns {Object}
   */
  getFeatureStatus(context = {}) {
    const allKeys = new Set([
      ...Object.keys(this._config),
      ...Object.values(this._tenantOverrides).flatMap(Object.keys),
      ...Object.values(this._userOverrides).flatMap(Object.keys),
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
    if (exported.config) this._config = { ...exported.config };
    if (exported.tenantOverrides) {
      this._tenantOverrides = JSON.parse(JSON.stringify(exported.tenantOverrides));
    }
    if (exported.userOverrides) {
      this._userOverrides = JSON.parse(JSON.stringify(exported.userOverrides));
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
    const { startDate } = options;

    function parseDurationMs(duration) {
      if (!duration) return 0;
      const match = String(duration).match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/);
      if (!match) return 0;
      const value = parseFloat(match[1]);
      const unit = match[2];
      const multiplierMap = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
      return value * (multiplierMap[unit] || 0);
    }

    const phases = [1, 2, 3, 4]
      .map((n) => ({ phase: n, ...(options[`phase${n}`] || null) }))
      .filter((p) => p.percentage != null);

    return {
      getCurrentPhase() {
        const elapsed = Date.now() - startDate.getTime();
        let accumulated = 0;
        for (const phaseConfig of phases) {
          const duration = parseDurationMs(phaseConfig.duration);
          if (duration > 0 && elapsed < accumulated + duration) {
            return { phase: phaseConfig.phase, percentage: phaseConfig.percentage };
          }
          if (duration > 0) {
            accumulated += duration;
          } else {
            // Last phase — no duration constraint
            return { phase: phaseConfig.phase, percentage: phaseConfig.percentage };
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
    const set = new Set(allowedTenantIds);
    return {
      isEnabled(tenantId) {
        return set.has(tenantId);
      },
    };
  }

  /**
   * Estratégia de blacklist: bloqueado apenas para tenants listados.
   * @param {string[]} blockedTenantIds
   * @returns {{ isEnabled(tenantId: string): boolean }}
   */
  static blacklist(blockedTenantIds) {
    const set = new Set(blockedTenantIds);
    return {
      isEnabled(tenantId) {
        return !set.has(tenantId);
      },
    };
  }

  /**
   * Estratégia por grupo: decide com base no campo `group` do contexto.
   * @param {Object} groupMap Mapa { groupName: { enabled: boolean } }
   * @returns {{ isEnabled(context: { group: string }): boolean }}
   */
  static byGroup(groupMap) {
    return {
      isEnabled(context) {
        const group = context && context.group;
        if (!group || !groupMap[group]) return false;
        return Boolean(groupMap[group].enabled);
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
