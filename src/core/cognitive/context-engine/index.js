'use strict';

/**
 * Context Engine do Cognitive Core.
 *
 * Monta o contexto operacional de uma interação consultando serviços já
 * existentes do RAP (CRM/leads, agenda, tickets, campanhas, métricas).
 *
 * Garantias:
 *  - isolamento por tenant (tenantId obrigatório; cache segmentado por tenant)
 *  - cada fonte é best-effort e rastreada em `trace` (fonte, status, duração)
 *  - nenhuma fonte vaza dados de outro tenant (todas as consultas levam tenantId)
 */

const { sanitize } = require('../sanitize');

const DEFAULT_CACHE_TTL_MS = 30 * 1000;

function defaultLogger() {
  return require('../../../../api/utils/logger');
}

function defaultResolvers() {
  // Resolvers lazy sobre serviços reais. Cada um recebe ({ tenantId, input }).
  return {
    customer: async ({ tenantId, input }) => {
      const marketing = require('../../../../api/services/marketing/marketingService');
      if (input.customerId) {
        return marketing.getLeadById({ tenantId, leadId: input.customerId });
      }
      return null;
    },
    crm: async ({ tenantId }) => {
      const marketing = require('../../../../api/services/marketing/marketingService');
      const stats = await marketing.getLeadStats({ tenantId });
      return stats || null;
    },
    appointments: async ({ tenantId, input }) => {
      const scheduleService = require('../../../../api/services/scheduleService');
      return scheduleService.listSchedules({
        tenantId,
        contextType: input.contextType,
        contextId: input.contextId,
        limit: 20,
      });
    },
    conversation: async ({ tenantId, input }) => {
      if (!input.conversationId) return null;
      const channelConversationService = require('../../../../api/services/channelConversationService');
      if (typeof channelConversationService.getConversationById !== 'function') return null;
      return channelConversationService.getConversationById({ tenantId, conversationId: input.conversationId });
    },
    tickets: async ({ tenantId }) => {
      const queueService = require('../../../../api/services/queueService');
      if (typeof queueService.listAllTickets !== 'function') return null;
      const { tickets } = queueService.listAllTickets({ tenantId }) || {};
      return Array.isArray(tickets) ? tickets.slice(0, 20) : null;
    },
    campaigns: async ({ tenantId }) => {
      const ccCampaignsService = require('../../../../api/services/cc/ccCampaignsService');
      return ccCampaignsService.listCampaigns({ tenantKey: tenantId });
    },
    metrics: async () => null, // snapshot de métricas é opcional; resolvers podem ser injetados
  };
}

function createContextEngine({ resolvers, logger, cacheTtlMs } = {}) {
  const log = logger || defaultLogger();
  const sources = { ...defaultResolvers(), ...(resolvers || {}) };
  const ttl = Number.isFinite(cacheTtlMs) ? cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  const cache = new Map(); // chave: `${tenantId}::${source}::${cacheKey}`

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > ttl) {
      cache.delete(key);
      return undefined;
    }
    return hit.value;
  }

  function cacheSet(key, value) {
    cache.set(key, { at: Date.now(), value });
  }

  /**
   * @param {object} input
   * @param {string} input.tenantId   obrigatório
   * @param {string} [input.channel]
   * @param {string} [input.userId]
   * @param {string} [input.customerId]
   * @param {string} [input.conversationId]
   * @param {string} [input.message]
   * @param {object} [input.payload]
   */
  async function buildContext(input = {}) {
    const tenantId = String(input.tenantId || '').trim();
    if (!tenantId) throw new Error('cognitive_context_tenant_required');

    const trace = [];
    const context = {
      tenantId,
      channel: input.channel || null,
      customer: null,
      conversation: null,
      crm: null,
      appointments: null,
      tickets: null,
      campaigns: null,
      metrics: null,
    };

    await Promise.all(Object.keys(sources).map(async (sourceName) => {
      const startedAt = Date.now();
      const cacheKey = `${tenantId}::${sourceName}::${input.customerId || ''}::${input.conversationId || ''}`;
      try {
        const cached = cacheGet(cacheKey);
        if (cached !== undefined) {
          context[sourceName] = cached;
          trace.push({ source: sourceName, status: 'cache_hit', durationMs: Date.now() - startedAt });
          return;
        }
        const value = await sources[sourceName]({ tenantId, input });
        context[sourceName] = value ?? null;
        cacheSet(cacheKey, value ?? null);
        trace.push({ source: sourceName, status: 'resolved', durationMs: Date.now() - startedAt });
      } catch (error) {
        context[sourceName] = null;
        trace.push({ source: sourceName, status: 'error', durationMs: Date.now() - startedAt, error: error.message });
        log.warn('[CognitiveContextEngine] Source resolution failed (best-effort)', {
          tenantId,
          source: sourceName,
          error: error.message,
        });
      }
    }));

    return { ...context, trace: sanitize(trace), builtAt: new Date().toISOString() };
  }

  function clearCache() {
    cache.clear();
  }

  return { buildContext, clearCache };
}

module.exports = { createContextEngine };
