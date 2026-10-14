const rng = require('./shared/random');
const clock = require('./shared/clock');
/**
 * Sistema de monitoramento de fallbacks.
 * 
 * Responsabilidades:
 * - Rastrear uso de fallbacks em tempo real
 * - Alertar quando uso de fallback excede thresholds
 * - Fornecer métricas de saúde do sistema
 * 
 * IMPORTANTE: Este módulo não afeta o fluxo principal,
 * mas qualquer falha interna precisa ser logada explicitamente.
 */

const logger = require('../api/utils/logger');

/**
 * Tipos de fallback monitorados
 */
const FALLBACK_TYPES = {
  RATE_LIMIT_REDIS_TO_MEMORY: 'rate_limit_redis_to_memory',
  RATE_LIMIT_FAIL_OPEN: 'rate_limit_fail_open',
  AI_PROVIDER_FALLBACK: 'ai_provider_fallback',
  AI_PROVIDER_STATIC: 'ai_provider_static',
  RAG_FALLBACK_TO_DIRECT: 'rag_fallback_to_direct',
  AI_NODE_NO_PROVIDER: 'ai_node_no_provider',
  FRONTEND_AI_SIMULATION: 'frontend_ai_simulation',
  AUTH_TOKEN_FALLBACK: 'auth_token_fallback',
};

/**
 * Thresholds de alerta (por minuto)
 */
const ALERT_THRESHOLDS = {
  [FALLBACK_TYPES.RATE_LIMIT_REDIS_TO_MEMORY]: 1, // Qualquer uso em produção é crítico
  [FALLBACK_TYPES.RATE_LIMIT_FAIL_OPEN]: 0, // Nunca deve acontecer
  [FALLBACK_TYPES.AI_PROVIDER_FALLBACK]: 10, // 10 fallbacks/min = problema
  [FALLBACK_TYPES.AI_PROVIDER_STATIC]: 1, // Qualquer uso é crítico
  [FALLBACK_TYPES.RAG_FALLBACK_TO_DIRECT]: 20, // 20 fallbacks/min = investigar
  [FALLBACK_TYPES.AI_NODE_NO_PROVIDER]: 1, // Qualquer uso é crítico
  [FALLBACK_TYPES.FRONTEND_AI_SIMULATION]: 0, // Nunca deve acontecer em produção
  [FALLBACK_TYPES.AUTH_TOKEN_FALLBACK]: 0, // Nunca deve acontecer
};

/**
 * Contadores de fallback (por tipo, por minuto)
 * Estrutura: { [fallbackType]: { [minute]: count } }
 */
const fallbackCounts = new Map();

/**
 * Histórico de alertas (para evitar spam)
 */
const alertHistory = new Map();

/**
 * Limpa contadores antigos (mantém apenas últimos 60 minutos)
 */
function cleanupOldCounts() {
  const now = clock.nowMs();
  const oneHourAgo = now - (60 * 60 * 1000);
  
  for (const [type, counts] of fallbackCounts.entries()) {
    for (const [minute, _] of counts.entries()) {
      if (minute < oneHourAgo) {
        counts.delete(minute);
      }
    }
    if (counts.size === 0) {
      fallbackCounts.delete(type);
    }
  }
}

/**
 * Registra uso de fallback
 * 
 * @param {string} fallbackType - Tipo de fallback
 * @param {Object} metadata - Metadados adicionais
 */
function recordFallback(fallbackType, metadata = {}) {
  try {
    // Limpa contadores antigos periodicamente
    if (rng.random() < 0.1) { // 10% de chance a cada chamada
      cleanupOldCounts();
    }
    
    const now = clock.nowMs();
    const minute = Math.floor(now / 60000) * 60000; // Arredonda para o minuto
    
    // Incrementa contador
    if (!fallbackCounts.has(fallbackType)) {
      fallbackCounts.set(fallbackType, new Map());
    }
    const counts = fallbackCounts.get(fallbackType);
    const currentCount = counts.get(minute) || 0;
    counts.set(minute, currentCount + 1);
    
    // Verifica threshold
    const threshold = ALERT_THRESHOLDS[fallbackType];
    if (threshold !== undefined && currentCount + 1 >= threshold) {
      checkAndAlert(fallbackType, currentCount + 1, threshold, metadata);
    }
    
    // Log estruturado
    logger.warn('[FallbackMonitor] Fallback registrado', {
      fallbackType,
      count: currentCount + 1,
      threshold,
      minute: new Date(minute).toISOString(),
      ...metadata,
    });
  } catch (error) {
    logger.error('[FallbackMonitor] Erro ao registrar fallback', { error: error.message });
  }
}

/**
 * Verifica e emite alerta se necessário
 * 
 * @param {string} fallbackType - Tipo de fallback
 * @param {number} count - Contagem atual
 * @param {number} threshold - Threshold configurado
 * @param {Object} metadata - Metadados
 */
function checkAndAlert(fallbackType, count, threshold, metadata) {
  const now = clock.nowMs();
  const alertKey = `${fallbackType}:${Math.floor(now / 60000)}`;
  
  // Evita spam de alertas (máximo 1 alerta por minuto por tipo)
  if (alertHistory.has(alertKey)) {
    return;
  }
  
  alertHistory.set(alertKey, now);
  
  // Limpa histórico antigo
  for (const [key, timestamp] of alertHistory.entries()) {
    if (now - timestamp > 5 * 60 * 1000) { // 5 minutos
      alertHistory.delete(key);
    }
  }
  
  // Emite alerta
  const severity = threshold === 0 ? 'CRITICAL' : 'HIGH';
  logger.error(`[FallbackMonitor] ALERTA: Fallback "${fallbackType}" excedeu threshold`, {
    fallbackType,
    count,
    threshold,
    severity,
    alert: `FALLBACK_THRESHOLD_EXCEEDED_${fallbackType.toUpperCase()}`,
    ...metadata,
  });
}

/**
 * Obtém métricas de fallback
 * 
 * @returns {Object} Métricas agregadas
 */
function getFallbackMetrics() {
  const now = clock.nowMs();
  const oneMinuteAgo = now - 60000;
  const fiveMinutesAgo = now - (5 * 60000);
  const oneHourAgo = now - (60 * 60 * 1000);
  
  const metrics = {
    lastMinute: {},
    last5Minutes: {},
    lastHour: {},
    total: {},
  };
  
  for (const [type, counts] of fallbackCounts.entries()) {
    let lastMinuteCount = 0;
    let last5MinutesCount = 0;
    let lastHourCount = 0;
    let totalCount = 0;
    
    for (const [minute, count] of counts.entries()) {
      totalCount += count;
      if (minute >= oneHourAgo) {
        lastHourCount += count;
        if (minute >= fiveMinutesAgo) {
          last5MinutesCount += count;
          if (minute >= oneMinuteAgo) {
            lastMinuteCount += count;
          }
        }
      }
    }
    
    metrics.lastMinute[type] = lastMinuteCount;
    metrics.last5Minutes[type] = last5MinutesCount;
    metrics.lastHour[type] = lastHourCount;
    metrics.total[type] = totalCount;
  }
  
  return metrics;
}

/**
 * Reseta todas as métricas (útil em testes)
 */
function resetMetrics() {
  fallbackCounts.clear();
  alertHistory.clear();
}

module.exports = {
  FALLBACK_TYPES,
  recordFallback,
  getFallbackMetrics,
  resetMetrics,
};

