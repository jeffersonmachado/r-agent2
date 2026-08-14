'use strict';

/**
 * RAP Knowledge Plane — Knowledge Tools.
 *
 * Tools canônicas para o Knowledge Plane, registradas no Cognitive Tool Registry.
 *
 * Classificação:
 *  - knowledge.searchOperational → PRODUCTION (apenas OPERATIONAL)
 *  - knowledge.searchSystem → SUPPORT (apenas SYSTEM)
 *  - knowledge.impactAnalysis → SUPPORT/DEVELOPMENT
 *  - knowledge.coverageAnalysis → DEVELOPMENT
 *  - knowledge.incidentSearch → SUPPORT
 *  - knowledge.releaseImpact → SUPPORT/DEVELOPMENT
 *
 * NUNCA expor parâmetros de domínio/classification/tenant via input da tool.
 * Esses vêm do contexto autenticado.
 */

const { resolveKnowledgeContext } = require('./knowledge-router');
const { buildProvenance, SOURCE_KINDS } = require('./provenance');

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Registra tools do Knowledge Plane no Cognitive Tool Registry.
 *
 * @param {Object} registry - Cognitive Tool Registry
 * @param {Object} [deps] - dependências (ragService, knowledgeGraph, etc.)
 */
function registerKnowledgeTools(registry, deps = {}) {
  const log = deps.logger || defaultLogger();

  // -----------------------------------------------------------------------
  // knowledge.searchOperational — PRODUCTION
  // -----------------------------------------------------------------------
  registry.register({
    id: 'knowledge.searchOperational',
    capability: 'knowledge.operational',
    visibility: 'PRODUCTION',
    permissions: ['knowledge.read'],
    description: 'Busca conhecimento operacional (tenant, vertical, propósito).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    executionMode: 'atomic',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        retrievalPurpose: { type: 'string', enum: ['CUSTOMER_SERVICE', 'SALES', 'SCHEDULING', 'CRM', 'CAMPAIGN', 'BILLING', 'OPERATION', 'VOICE'] },
      },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const principal = context.actor
        ? { classification: context.actor.classification || 'PRODUCTION' }
        : { classification: 'PRODUCTION' };

      const knowledgeResult = resolveKnowledgeContext({
        principal,
        retrievalPurpose: input.retrievalPurpose || null,
      });

      if (!knowledgeResult.allowed || knowledgeResult.scope.domain !== 'OPERATIONAL') {
        throw new Error('knowledge_domain_denied: OPERATIONAL scope not authorized');
      }

      const ragService = deps.ragService || (() => {
        try { return require('../../../api/services/ragService'); } catch (_) { return null; }
      })();

      if (!ragService || typeof ragService.queryRag !== 'function') {
        throw new Error('knowledge_service_unavailable: RAG service not available');
      }

      const result = await ragService.queryRag(input.query, context.tenantId, { actor: context.actor || null }, {
        domain: 'OPERATIONAL',
        classifications: knowledgeResult.scope.classifications,
        scope: knowledgeResult.scope,
      });

      return {
        query: input.query,
        domain: 'OPERATIONAL',
        purpose: input.retrievalPurpose || null,
        sources: result.sources || [],
        content: result.content || null,
        success: result.success,
      };
    },
  });

  // -----------------------------------------------------------------------
  // knowledge.searchSystem — SUPPORT
  // -----------------------------------------------------------------------
  registry.register({
    id: 'knowledge.searchSystem',
    capability: 'knowledge.system',
    visibility: 'SUPPORT',
    permissions: ['knowledge.system.read'],
    description: 'Busca conhecimento técnico do sistema (arquitetura, código, modelos, incidentes).',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    executionMode: 'atomic',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        retrievalPurpose: { type: 'string', enum: ['DIAGNOSIS', 'AUDIT', 'DEVELOPMENT', 'QA', 'IMPACT_ANALYSIS', 'COVERAGE_ANALYSIS', 'RELEASE_VALIDATION', 'DOCUMENTATION', 'INCIDENT_ANALYSIS'] },
      },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const principal = context.actor
        ? { classification: context.actor.classification || 'PRODUCTION' }
        : { classification: 'PRODUCTION' };

      const knowledgeResult = resolveKnowledgeContext({
        principal,
        requestedDomain: 'SYSTEM',
        retrievalPurpose: input.retrievalPurpose || null,
      });

      if (!knowledgeResult.allowed) {
        throw new Error(`knowledge_domain_denied: SYSTEM not authorized (${knowledgeResult.scope.reason})`);
      }

      const ragService = deps.ragService || (() => {
        try { return require('../../../api/services/ragService'); } catch (_) { return null; }
      })();

      if (!ragService || typeof ragService.queryRag !== 'function') {
        throw new Error('knowledge_service_unavailable: RAG service not available');
      }

      const result = await ragService.queryRag(input.query, context.tenantId, { actor: context.actor || null }, {
        domain: 'SYSTEM',
        classifications: knowledgeResult.scope.classifications,
        scope: knowledgeResult.scope,
      });

      return {
        query: input.query,
        domain: 'SYSTEM',
        purpose: input.retrievalPurpose || null,
        sources: result.sources || [],
        content: result.content || null,
        success: result.success,
      };
    },
  });

  // -----------------------------------------------------------------------
  // knowledge.impactAnalysis — SUPPORT/DEVELOPMENT
  // -----------------------------------------------------------------------
  registry.register({
    id: 'knowledge.impactAnalysis',
    capability: 'knowledge.system',
    visibility: 'SUPPORT',
    permissions: ['knowledge.system.read'],
    description: 'Analisa impacto de mudanças usando inventário + traceability graph.',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    executionMode: 'atomic',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        component: { type: 'string' },
      },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const principal = context.actor
        ? { classification: context.actor.classification || 'PRODUCTION' }
        : { classification: 'PRODUCTION' };

      const knowledgeResult = resolveKnowledgeContext({
        principal,
        requestedDomain: 'SYSTEM',
        retrievalPurpose: 'IMPACT_ANALYSIS',
      });

      if (!knowledgeResult.allowed) {
        throw new Error('knowledge_impact_analysis_denied');
      }

      // Busca no Knowledge Graph + System RAG
      const traceabilityGraph = deps.traceabilityGraph || (() => {
        try { return require('../../../qa/coverage/traceabilityGraph'); } catch (_) { return null; }
      })();

      const ragService = deps.ragService || (() => {
        try { return require('../../../api/services/ragService'); } catch (_) { return null; }
      })();

      let graphResult = null;
      if (traceabilityGraph && typeof traceabilityGraph.getImpact === 'function') {
        graphResult = await traceabilityGraph.getImpact({
          component: input.component || input.query,
        });
      }

      let ragResult = null;
      if (ragService && typeof ragService.queryRag === 'function') {
        ragResult = await ragService.queryRag(input.query, context.tenantId, { actor: context.actor || null }, {
          domain: 'SYSTEM',
          classifications: knowledgeResult.scope.classifications,
          scope: knowledgeResult.scope,
        });
      }

      return {
        query: input.query,
        component: input.component || null,
        graphImpact: graphResult || null,
        knowledgeSources: ragResult?.sources || [],
        success: true,
      };
    },
  });

  // -----------------------------------------------------------------------
  // knowledge.coverageAnalysis — DEVELOPMENT
  // -----------------------------------------------------------------------
  registry.register({
    id: 'knowledge.coverageAnalysis',
    capability: 'knowledge.system',
    visibility: 'DEVELOPMENT',
    permissions: ['knowledge.system.read'],
    description: 'Analisa cobertura de QA usando Coverage Engine + System RAG.',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    executionMode: 'atomic',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
      },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const principal = context.actor
        ? { classification: context.actor.classification || 'PRODUCTION' }
        : { classification: 'PRODUCTION' };

      const knowledgeResult = resolveKnowledgeContext({
        principal,
        requestedDomain: 'SYSTEM',
        retrievalPurpose: 'COVERAGE_ANALYSIS',
      });

      if (!knowledgeResult.allowed) {
        throw new Error('knowledge_coverage_analysis_denied');
      }

      const coverageEngine = deps.coverageEngine || (() => {
        try { return require('../../../qa/coverage/coverageEngine'); } catch (_) { return null; }
      })();

      let coverageResult = null;
      if (coverageEngine && typeof coverageEngine.analyze === 'function') {
        coverageResult = await coverageEngine.analyze({ query: input.query });
      }

      return {
        query: input.query,
        coverage: coverageResult || null,
        success: !!coverageResult,
      };
    },
  });

  // -----------------------------------------------------------------------
  // knowledge.incidentSearch — SUPPORT
  // -----------------------------------------------------------------------
  registry.register({
    id: 'knowledge.incidentSearch',
    capability: 'knowledge.system',
    visibility: 'SUPPORT',
    permissions: ['knowledge.system.read'],
    description: 'Busca incidentes similares com root cause e fix no SYSTEM knowledge.',
    riskLevel: 'low',
    sideEffects: false,
    confirmationPolicy: 'autonomous',
    executionMode: 'atomic',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
      },
      additionalProperties: true,
    },
    execute: async (input, context) => {
      const principal = context.actor
        ? { classification: context.actor.classification || 'PRODUCTION' }
        : { classification: 'PRODUCTION' };

      const knowledgeResult = resolveKnowledgeContext({
        principal,
        requestedDomain: 'SYSTEM',
        retrievalPurpose: 'INCIDENT_ANALYSIS',
      });

      if (!knowledgeResult.allowed) {
        throw new Error('knowledge_incident_search_denied');
      }

      const ragService = deps.ragService || (() => {
        try { return require('../../../api/services/ragService'); } catch (_) { return null; }
      })();

      if (!ragService || typeof ragService.queryRag !== 'function') {
        throw new Error('knowledge_service_unavailable: RAG service not available');
      }

      const result = await ragService.queryRag(input.query, context.tenantId, { actor: context.actor || null }, {
        domain: 'SYSTEM',
        classifications: knowledgeResult.scope.classifications,
        scope: knowledgeResult.scope,
      });

      return {
        query: input.query,
        domain: 'SYSTEM',
        purpose: 'INCIDENT_ANALYSIS',
        sources: result.sources || [],
        content: result.content || null,
        success: result.success,
        provenance: result.sources?.map((s) => ({
          sourceKind: s.sourceKind || null,
          lastValidatedAt: s.lastValidatedAt || null,
          authority: s.authority || null,
        })) || [],
      };
    },
  });

  log.info('[KnowledgePlane] Knowledge tools registered', {
    tools: [
      'knowledge.searchOperational',
      'knowledge.searchSystem',
      'knowledge.impactAnalysis',
      'knowledge.coverageAnalysis',
      'knowledge.incidentSearch',
    ],
  });
}

module.exports = { registerKnowledgeTools };
