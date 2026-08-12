'use strict';

/**
 * Knowledge Plane Observability — eventos e métricas do Knowledge Plane.
 *
 * Eventos emitidos:
 *  - knowledge.query.started
 *  - knowledge.query.completed
 *  - knowledge.query.denied
 *  - knowledge.query.failed
 *  - knowledge.promotion.requested
 *  - knowledge.promotion.approved
 *  - knowledge.promotion.rejected
 *  - knowledge.index.updated
 *
 * Sempre com: tenant, principal, agent, domain, purpose, source counts,
 * latency, confidence. Sem conteúdo sensível.
 */

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Event emitter para o Knowledge Plane (best-effort).
 */
function createKnowledgeEventEmitter(deps = {}) {
  const log = deps.logger || defaultLogger();
  const eventLedger = deps.eventLedger || null;
  const metricsCollector = deps.metricsCollector || null;

  async function emit(type, payload = {}) {
    try {
      if (eventLedger && typeof eventLedger.appendEventV1 === 'function') {
        await eventLedger.appendEventV1({
          tenantId: payload.tenantId || 'system',
          type,
          source: 'knowledge-plane',
          correlationId: payload.correlationId || null,
          subject: payload.subject || null,
          actor: payload.actor || null,
          payload: sanitizePayload(payload),
        });
      }
    } catch (error) {
      log.warn('[KnowledgePlane] Event emit failed (best-effort)', { type, error: error.message });
    }

    // Métricas
    if (metricsCollector && typeof metricsCollector.increment === 'function') {
      try {
        metricsCollector.increment(`knowledge.${type}`, {
          domain: payload.domain || 'unknown',
          purpose: payload.purpose || 'unknown',
        });
      } catch (_) { /* best-effort */ }
    }
  }

  function sanitizePayload(payload) {
    const clean = { ...payload };
    // Remove campos sensíveis
    delete clean.query;
    delete clean.content;
    delete clean.rawResponse;
    return clean;
  }

  return {
    emit,

    queryStarted(args) {
      return emit('knowledge.query.started', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },

    queryCompleted(args) {
      return emit('knowledge.query.completed', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },

    queryDenied(args) {
      return emit('knowledge.query.denied', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },

    queryFailed(args) {
      return emit('knowledge.query.failed', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },

    promotionRequested(args) {
      return emit('knowledge.promotion.requested', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },

    promotionApproved(args) {
      return emit('knowledge.promotion.approved', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },

    promotionRejected(args) {
      return emit('knowledge.promotion.rejected', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },

    indexUpdated(args) {
      return emit('knowledge.index.updated', {
        ...args,
        timestamp: new Date().toISOString(),
      });
    },
  };
}

/**
 * Knowledge Plane metrics collector.
 */
function createKnowledgeMetrics() {
  const metrics = new Map();

  return {
    increment(key, labels = {}) {
      const labelStr = JSON.stringify(labels);
      const fullKey = `${key}:${labelStr}`;
      metrics.set(fullKey, (metrics.get(fullKey) || 0) + 1);
    },

    /**
     * Retorna snapshot das métricas atuais.
     */
    snapshot() {
      const result = {
        retrievalHitRate: 0,
        noContextRate: 0,
        crossDomainDenied: 0,
        averageConfidence: 0,
        authorityDistribution: {},
        staleSourceRate: 0,
        cacheHitRate: 0,
        graphContribution: 0,
        episodicContribution: 0,
        promotionRate: 0,
        byDomain: { OPERATIONAL: {}, SYSTEM: {} },
        generatedAt: new Date().toISOString(),
      };

      for (const [key, value] of metrics) {
        const [metricName, labelsStr] = key.split(':');
        const labels = JSON.parse(labelsStr || '{}');

        if (metricName === 'knowledge.query.completed') {
          if (labels.domain) {
            result.byDomain[labels.domain] = result.byDomain[labels.domain] || {};
            result.byDomain[labels.domain].completed = value;
          }
        }
        if (metricName === 'knowledge.query.denied') {
          result.crossDomainDenied += value;
        }
      }

      return result;
    },

    reset() {
      metrics.clear();
    },
  };
}

module.exports = {
  createKnowledgeEventEmitter,
  createKnowledgeMetrics,
};
