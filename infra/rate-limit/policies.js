/**
 * Políticas de Rate Limiting.
 * 
 * Define limites por tipo de operação:
 * - DRY_RUN: Mais permissivo (testes)
 * - GENERATION_REAL: Execuções reais (restritivo)
 * - BOOTSTRAP: Extremamente restritivo
 * - SCRAPING: Por domínio e por execução
 * - SYSTEM_VALIDATE: Validações de sistema
 * - TENANT_API / TENANT_USER_API: por tenant (dinâmico, codifica plano/pontos/duração)
 * 
 * Valores são lidos de config.json com fallback para variáveis de ambiente.
 */

const config = require('../../api/utils/config');

/**
 * Políticas padrão de rate limiting.
 * 
 * Estrutura:
 * {
 *   points: número máximo de pontos (execuções)
 *   duration: duração da janela em segundos
 * }
 */
/**
 * Obtém valor de configuração com fallback.
 * 
 * @param {string} configPath - Caminho no config.json (ex: 'rateLimit.policies.dryRun.points')
 * @param {string} envVar - Variável de ambiente (ex: 'RATE_LIMIT_DRY_RUN_POINTS')
 * @param {number} defaultValue - Valor padrão
 * @returns {number}
 */
function getConfigValue(configPath, envVar, defaultValue) {
  // Tenta ler do config.json primeiro
  const configValue = config.get(configPath);
  if (configValue !== undefined && configValue !== null) {
    return typeof configValue === 'number' ? configValue : parseInt(String(configValue), 10);
  }
  
  // Fallback para env var (compatibilidade)
  if (envVar && process.env[envVar] !== undefined) {
    return parseInt(process.env[envVar], 10);
  }
  
  return defaultValue;
}

const DEFAULT_POLICIES = {
  // DRY-RUN: 50 execuções por minuto
  DRY_RUN: {
    points: getConfigValue('rateLimit.policies.dryRun.points', 'RATE_LIMIT_DRY_RUN_POINTS', 50),
    duration: getConfigValue('rateLimit.policies.dryRun.duration', 'RATE_LIMIT_DRY_RUN_DURATION', 60),
  },

  // Geração real: 5 execuções por minuto
  GENERATION_REAL: {
    points: getConfigValue('rateLimit.policies.generation.points', 'RATE_LIMIT_GENERATION_POINTS', 5),
    duration: getConfigValue('rateLimit.policies.generation.duration', 'RATE_LIMIT_GENERATION_DURATION', 60),
  },

  // Bootstrap: 1 execução a cada 5 minutos
  BOOTSTRAP: {
    points: getConfigValue('rateLimit.policies.bootstrap.points', 'RATE_LIMIT_BOOTSTRAP_POINTS', 1),
    duration: getConfigValue('rateLimit.policies.bootstrap.duration', 'RATE_LIMIT_BOOTSTRAP_DURATION', 300),
  },

  // Scraping: 10 requisições por 5 minutos
  SCRAPING: {
    points: getConfigValue('rateLimit.policies.scraping.points', 'RATE_LIMIT_SCRAPING_POINTS', 10),
    duration: getConfigValue('rateLimit.policies.scraping.duration', 'RATE_LIMIT_SCRAPING_DURATION', 300),
  },

  // Validação de sistema: 10 execuções por minuto
  SYSTEM_VALIDATE: {
    points: getConfigValue('rateLimit.policies.systemValidate.points', 'RATE_LIMIT_SYSTEM_VALIDATE_POINTS', 10),
    duration: getConfigValue('rateLimit.policies.systemValidate.duration', 'RATE_LIMIT_SYSTEM_VALIDATE_DURATION', 60),
  },

  // -----------------------------------------------------------------------
  // Public access tokens (storefront/kiosk/panel/station)
  // -----------------------------------------------------------------------
  // Resolve endpoint (anti brute-force por IP)
  PUBLIC_TOKEN_RESOLVE: {
    points: getConfigValue('rateLimit.policies.publicTokens.resolve.points', 'RATE_LIMIT_PUBLIC_TOKENS_RESOLVE_POINTS', 60),
    duration: getConfigValue('rateLimit.policies.publicTokens.resolve.duration', 'RATE_LIMIT_PUBLIC_TOKENS_RESOLVE_DURATION', 60),
  },
  // Uso por kind (limite por tokenId)
  PUBLIC_TOKEN_STOREFRONT: {
    points: getConfigValue('rateLimit.policies.publicTokens.storefront.points', 'RATE_LIMIT_PUBLIC_TOKENS_STOREFRONT_POINTS', 300),
    duration: getConfigValue('rateLimit.policies.publicTokens.storefront.duration', 'RATE_LIMIT_PUBLIC_TOKENS_STOREFRONT_DURATION', 60),
  },
  PUBLIC_TOKEN_KIOSK: {
    points: getConfigValue('rateLimit.policies.publicTokens.kiosk.points', 'RATE_LIMIT_PUBLIC_TOKENS_KIOSK_POINTS', 120),
    duration: getConfigValue('rateLimit.policies.publicTokens.kiosk.duration', 'RATE_LIMIT_PUBLIC_TOKENS_KIOSK_DURATION', 60),
  },
  PUBLIC_TOKEN_PANEL: {
    points: getConfigValue('rateLimit.policies.publicTokens.panel.points', 'RATE_LIMIT_PUBLIC_TOKENS_PANEL_POINTS', 600),
    duration: getConfigValue('rateLimit.policies.publicTokens.panel.duration', 'RATE_LIMIT_PUBLIC_TOKENS_PANEL_DURATION', 60),
  },
  PUBLIC_TOKEN_STATION: {
    points: getConfigValue('rateLimit.policies.publicTokens.station.points', 'RATE_LIMIT_PUBLIC_TOKENS_STATION_POINTS', 300),
    duration: getConfigValue('rateLimit.policies.publicTokens.station.duration', 'RATE_LIMIT_PUBLIC_TOKENS_STATION_DURATION', 60),
  },
  // API pública com API Keys (por tokenId)
  PUBLIC_API: {
    points: getConfigValue('rateLimit.policies.publicApi.points', 'RATE_LIMIT_PUBLIC_API_POINTS', 120),
    duration: getConfigValue('rateLimit.policies.publicApi.duration', 'RATE_LIMIT_PUBLIC_API_DURATION', 60),
  },

  // -----------------------------------------------------------------------
  // Internal execution queue quotas (per tenant)
  // -----------------------------------------------------------------------
  EXECUTION_QUEUE_ENQUEUE: {
    points: getConfigValue('rateLimit.policies.executionQueue.enqueue.points', 'RATE_LIMIT_EXECUTION_QUEUE_ENQUEUE_POINTS', 300),
    duration: getConfigValue('rateLimit.policies.executionQueue.enqueue.duration', 'RATE_LIMIT_EXECUTION_QUEUE_ENQUEUE_DURATION', 60),
  },

  // -----------------------------------------------------------------------
  // Endpoints pré-autenticação (anti brute-force por IP)
  // login, signup, rpa/login, accept-invitation, request/reset-password.
  // Estas rotas são excluídas do rate limit por tenant (não há tenant ainda);
  // sem esta política ficavam totalmente desprotegidas.
  // -----------------------------------------------------------------------
  AUTH_PUBLIC: {
    points: getConfigValue('rateLimit.policies.authPublic.points', 'RATE_LIMIT_AUTH_PUBLIC_POINTS', 30),
    duration: getConfigValue('rateLimit.policies.authPublic.duration', 'RATE_LIMIT_AUTH_PUBLIC_DURATION', 60),
  },
};

// -----------------------------------------------------------------------
// Rate limit por tenant (api/middleware/tenantRateLimit.js).
// O operationType é dinâmico e codifica plano/pontos/duração:
//   TENANT_API_<plano>_<points>_<duration>        (limites do plano)
//   TENANT_API_<points>_<duration>                (enterprise custom)
//   TENANT_USER_API_<plano>_<points>_<duration>   (por usuário, plano)
//   TENANT_USER_API_<points>_<duration>           (enterprise custom)
// Estas tabelas são a fonte canônica de pontos por plano; o middleware
// consome as mesmas tabelas para headers e fallbacks.
// -----------------------------------------------------------------------
const TENANT_API_PLAN_LIMITS = {
  basic: { points: 500, duration: 60 },
  free: { points: 100, duration: 60 },
  trial: { points: 500, duration: 60 },
  pro: { points: 2000, duration: 60 },
  enterprise: { points: 10000, duration: 60 },
};

// Limites por usuário são menores que por tenant
const TENANT_USER_API_PLAN_LIMITS = {
  basic: { points: 100, duration: 60 },
  free: { points: 20, duration: 60 },
  trial: { points: 100, duration: 60 },
  pro: { points: 500, duration: 60 },
  enterprise: { points: 2000, duration: 60 },
};

const TENANT_API_OPERATION_PATTERN = /^TENANT_(USER_)?API_(?:([a-z]+)_)?(\d+)_(\d+)$/;

/**
 * Resolve política dinâmica de rate limit por tenant.
 *
 * @param {string} operationType - Tipo de operação (TENANT_API_* / TENANT_USER_API_*)
 * @returns {Object|null} Política ou null se não reconhecida
 */
function getTenantApiPolicy(operationType) {
  const match = TENANT_API_OPERATION_PATTERN.exec(operationType);
  if (!match) {
    return null;
  }

  const userScope = match[1] === 'USER_';
  const plan = match[2] || null;
  const points = parseInt(match[3], 10);
  const duration = parseInt(match[4], 10);

  if (!Number.isFinite(points) || points <= 0 || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  if (plan) {
    // Plano conhecido: usa os limites canônicos do plano
    const planLimits = userScope ? TENANT_USER_API_PLAN_LIMITS : TENANT_API_PLAN_LIMITS;
    return planLimits[plan] || null;
  }

  // Sem plano: limite customizado (enterprise via tenant.settings)
  return { points, duration };
}

/**
 * Políticas específicas para scraping por domínio.
 */
const SCRAPING_DOMAIN_POLICIES = {
  // Máximo de requisições por segundo por domínio
  REQUESTS_PER_SECOND: {
    points: getConfigValue('rateLimit.policies.scraping.requestsPerSecond', 'RATE_LIMIT_SCRAPING_RPS', 3),
    duration: 1, // 1 segundo
  },
  
  // Máximo de páginas por execução
  PAGES_PER_EXECUTION: {
    points: getConfigValue('rateLimit.policies.scraping.pagesPerExecution', 'RATE_LIMIT_SCRAPING_PAGES', 20),
    duration: 3600, // 1 hora (janela para resetar contador por execução)
  },
};

/**
 * Obtém política por tipo de operação.
 * 
 * @param {string} operationType - Tipo de operação
 * @returns {Object|null} Política ou null se não encontrada
 */
function getPolicy(operationType) {
  return DEFAULT_POLICIES[operationType] || getTenantApiPolicy(operationType);
}

/**
 * Obtém política de scraping por domínio.
 * 
 * @param {string} policyType - Tipo de política (REQUESTS_PER_SECOND, PAGES_PER_EXECUTION)
 * @returns {Object|null} Política ou null se não encontrada
 */
function getScrapingDomainPolicy(policyType) {
  return SCRAPING_DOMAIN_POLICIES[policyType] || null;
}

/**
 * Lista todas as políticas disponíveis.
 * 
 * @returns {Object} Todas as políticas
 */
function getAllPolicies() {
  return {
    ...DEFAULT_POLICIES,
    scrapingDomain: SCRAPING_DOMAIN_POLICIES,
  };
}

module.exports = {
  DEFAULT_POLICIES,
  SCRAPING_DOMAIN_POLICIES,
  TENANT_API_PLAN_LIMITS,
  TENANT_USER_API_PLAN_LIMITS,
  getPolicy,
  getScrapingDomainPolicy,
  getAllPolicies,
};
