/**
 * Sistema de Feature Flag para Rollout Gradual do Canonical Runtime
 * 
 * Permite controle granular de habilitação por:
 * - Ambiente (dev, staging, prod)
 * - Tenant (tenant-specific)
 * - Usuário (user-specific)
 * - Percentual aleatório (gradual rollout)
 * 
 * @module canonical/featureFlags
 */

/**
 * Gerenciador de Feature Flags
 */
export class FeatureFlagManager {
  constructor(config = {}) {
    this.config = {
      canonicalRuntime: false,
      bpmnNativeSupport: false,
      canonicalUI: false,
      ...config,
    };

    this.tenantOverrides = new Map();
    this.userOverrides = new Map();
    this.seedValue = Date.now();
  }

  /**
   * Define override de feature flag para um tenant específico
   * 
   * @param {string} tenantId - ID do tenant
   * @param {Object} flags - Flags para ativar/desativar
   */
  setTenantFlags(tenantId, flags) {
    this.tenantOverrides.set(tenantId, {
      ...this.tenantOverrides.get(tenantId),
      ...flags,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Define override de feature flag para um usuário específico
   * 
   * @param {string} userId - ID do usuário
   * @param {Object} flags - Flags para ativar/desativar
   */
  setUserFlags(userId, flags) {
    this.userOverrides.set(userId, {
      ...this.userOverrides.get(userId),
      ...flags,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Verifica se uma feature está habilitada
   * 
   * @param {string} featureName - Nome da feature (ex: 'canonicalRuntime')
   * @param {Object} context - Contexto (tenantId, userId, environment)
   * @returns {boolean} Se a feature está habilitada
   */
  isEnabled(featureName, context = {}) {
    const { tenantId, userId, environment = 'prod', rolloutPercentage = 100 } =
      context;

    // 1. Verificar override de usuário (prioridade máxima)
    if (userId && this.userOverrides.has(userId)) {
      const userFlags = this.userOverrides.get(userId);
      if (featureName in userFlags) {
        return userFlags[featureName];
      }
    }

    // 2. Verificar override de tenant
    if (tenantId && this.tenantOverrides.has(tenantId)) {
      const tenantFlags = this.tenantOverrides.get(tenantId);
      if (featureName in tenantFlags) {
        return tenantFlags[featureName];
      }
    }

    // 3. Verificar configuração base (com rollout gradual)
    const baseFlag = this.config[featureName];
    if (baseFlag === null || baseFlag === undefined) {
      return false;
    }

    // Se é booleano simples, retornar
    if (typeof baseFlag === 'boolean') {
      return baseFlag;
    }

    // Se é configuração de tipo objeto (rollout)
    if (typeof baseFlag === 'object' && baseFlag.enabled) {
      // Verificar rollout percentage
      if (rolloutPercentage < 100) {
        // Usar hash determinístico baseado em tenantId/userId
        const hashValue = this.hashContext(context);
        const randomPercentage = (hashValue % 100) + 1;
        return randomPercentage <= rolloutPercentage;
      }
      return true;
    }

    return false;
  }

  /**
   * Calcula hash determinístico para consistência de rollout
   * @private
   */
  hashContext(context) {
    const key = `${context.tenantId || 'unknown'}-${context.userId || 'unknown'}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Converter para32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Obtém relatório de todas as features e seu status
   * 
   * @param {Object} context - Contexto de execução
   * @returns {Object} Status de todas as features
   */
  getFeatureStatus(context = {}) {
    const baseFeatures = Object.keys(this.config);
    const status = {};

    baseFeatures.forEach((feature) => {
      status[feature] = this.isEnabled(feature, context);
    });

    return status;
  }

  /**
   * Registra uma mudança de flag para auditoria
   * 
   * @private
   */
  recordAuditLog(action, featureName, context, result) {
    const log = {
      timestamp: new Date().toISOString(),
      action,
      feature: featureName,
      context: {
        tenantId: context.tenantId,
        userId: context.userId,
        environment: context.environment,
      },
      result,
    };

    // Enviar para logging/monitoring se disponível
    if (typeof window !== 'undefined' && window.__logMetric) {
      window.__logMetric('feature_flag', log);
    }

    return log;
  }

  /**
   * Exporta configuração atual para backup
   */
  export() {
    return {
      config: this.config,
      tenantOverrides: Array.from(this.tenantOverrides.entries()),
      userOverrides: Array.from(this.userOverrides.entries()),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Importa configuração de backup
   */
  import(data) {
    if (data.config) {
      this.config = { ...this.config, ...data.config };
    }
    if (data.tenantOverrides) {
      this.tenantOverrides = new Map(data.tenantOverrides);
    }
    if (data.userOverrides) {
      this.userOverrides = new Map(data.userOverrides);
    }
  }
}

/**
 * Estratégia de Rollout em Fases
 */
export class RolloutStrategy {
  /**
   * Cria estratégia de rollout gradual
   * 
   * @example
   * const strategy = RolloutStrategy.gradual({
   *   startDate: '2024-01-01',
   *   phase1: { percentage: 10, duration: '7d' },
   *   phase2: { percentage: 25, duration: '7d' },
   *   phase3: { percentage: 50, duration: '7d' },
   *   phase4: { percentage: 100 },
   * });
   */
  static gradual(config) {
    return {
      type: 'gradual',
      phases: config,
      startDate: config.startDate ? new Date(config.startDate) : new Date(),
      getCurrentPhase: function() {
        const now = new Date();
        const elapsed = now - this.startDate;
        let phase = 1;
        let accumulatedTime = 0;

        for (const [key, value] of Object.entries(this.phases)) {
          if (key.startsWith('phase') && value.duration) {
            accumulatedTime += parseDuration(value.duration);
            if (elapsed < accumulatedTime) {
              return {
                phase,
                percentage: value.percentage,
                endsAt: new Date(this.startDate.getTime() + accumulatedTime),
              };
            }
            phase++;
          }
        }

        return {
          phase,
          percentage: this.phases.phase4?.percentage || 100,
          complete: true,
        };
      },
    };
  }

  /**
   * Cria estratégia de rollout por tenant whitelist
   */
  static whitelist(tenantIds) {
    return {
      type: 'whitelist',
      tenants: new Set(tenantIds),
      isEnabled: function(tenantId) {
        return this.tenants.has(tenantId);
      },
    };
  }

  /**
   * Cria estratégia de rollout por tenant exclusão
   */
  static blacklist(tenantIds) {
    return {
      type: 'blacklist',
      tenants: new Set(tenantIds),
      isEnabled: function(tenantId) {
        return !this.tenants.has(tenantId);
      },
    };
  }

  /**
   * Cria estratégia de rollout por grupo (region, tier, etc)
   */
  static byGroup(groupConfig) {
    return {
      type: 'group',
      groups: groupConfig,
      isEnabled: function(context) {
        const groupName = context.group;
        if (!groupName || !this.groups[groupName]) {
          return false;
        }

        const groupSettings = this.groups[groupName];
        return groupSettings.enabled !== false;
      },
    };
  }
}

/**
 * Utilidade para parsing de durações
 * @private
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)([dhms])$/);
  if (!match) return 0;

  const [, amount, unit] = match;
  const multipliers = {
    d: 86400000, // dias em ms
    h: 3600000, // horas em ms
    m: 60000, // minutos em ms
    s: 1000, // segundos em ms
  };

  return parseInt(amount) * (multipliers[unit] || 0);
}

/**
 * Hook React para usar feature flags
 * 
 * @example
 * const { isEnabled } = useFeatureFlag();
 * if (isEnabled('canonicalRuntime', { tenantId })) {
 *   // Renderizar novo componente
 * }
 */
export function useFeatureFlag(manager = null) {
  if (!manager) {
    manager = globalFeatureFlagManager || new FeatureFlagManager();
  }

  return {
    isEnabled: (feature, context) => manager.isEnabled(feature, context),
    getStatus: (context) => manager.getFeatureStatus(context),
    setTenantFlags: (tenantId, flags) => manager.setTenantFlags(tenantId, flags),
    setUserFlags: (userId, flags) => manager.setUserFlags(userId, flags),
  };
}

/**
 * Singleton global para feature flags
 */
let globalFeatureFlagManager = null;

/**
 * Inicializa o gerenciador global de feature flags
 */
export function initializeFeatureFlagManager(config = {}) {
  globalFeatureFlagManager = new FeatureFlagManager(config);

  // Se estamos no navegador, expor para DevTools
  if (typeof window !== 'undefined') {
    window.__featureFlags = globalFeatureFlagManager;
  }

  return globalFeatureFlagManager;
}

/**
 * Obtém o gerenciador global de feature flags
 */
export function getFeatureFlagManager() {
  if (!globalFeatureFlagManager) {
    globalFeatureFlagManager = new FeatureFlagManager();
  }
  return globalFeatureFlagManager;
}

/**
 * Middleware Express para integração backend
 * 
 * @example
 * app.use(featureFlagMiddleware(manager));
 * 
 * // No controller:
 * if (req.flags.isEnabled('canonicalRuntime')) {
 *   // Usar novo caminho
 * }
 */
export function featureFlagMiddleware(manager = null) {
  const flagManager = manager || getFeatureFlagManager();

  return (req, res, next) => {
    const context = {
      tenantId: req.tenant?.id || req.user?.tenantId,
      userId: req.user?.id,
      environment: process.env.NODE_ENV || 'production',
    };

    req.flags = {
      isEnabled: (feature) => flagManager.isEnabled(feature, context),
      getStatus: () => flagManager.getFeatureStatus(context),
      context,
    };

    next();
  };
}

// Exportar tudo como default também
export default {
  FeatureFlagManager,
  RolloutStrategy,
  useFeatureFlag,
  initializeFeatureFlagManager,
  getFeatureFlagManager,
  featureFlagMiddleware,
};
