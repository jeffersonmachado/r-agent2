'use strict';

/**
 * RAP Knowledge Plane — Hybrid Retrieval Orchestrator.
 *
 * Combina, conforme o retrievalPurpose:
 *  - Vector RAG (rag-service)
 *  - Knowledge Graph (api/modules/knowledge-graph)
 *  - Episodic Projection (Event Ledger → conhecimento sanitizado)
 *
 * O Knowledge Router determina O QUE recuperar.
 * Este orquestrador determina COMO recuperar.
 */

const { KNOWLEDGE_TYPES, PURPOSE_KNOWLEDGE_TYPES } = require('./knowledge-router');

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

/**
 * Configuração de peso por knowledge type e purpose.
 * SEMANTIC sempre usa Vector RAG como base.
 * STRUCTURAL usa Knowledge Graph + Vector RAG complementar.
 * EPISODIC usa Event Projection + Vector RAG complementar.
 */
const RETRIEVAL_STRATEGY = Object.freeze({
  SEMANTIC: ['vector_rag'],
  STRUCTURAL: ['knowledge_graph', 'vector_rag'],
  EPISODIC: ['episodic_projection', 'vector_rag'],
});

/**
 * Pesos de contribuição no score híbrido.
 */
const HYBRID_WEIGHTS = Object.freeze({
  semanticSimilarity: 0.40,
  authority: 0.25,
  purposeMatch: 0.15,
  freshness: 0.10,
  validationState: 0.05,
  graphRelevance: 0.05,
});

/**
 * @param {Object} args
 * @param {string} args.query
 * @param {string} args.tenantId
 * @param {Object} [args.actor] — principal autenticado usado na ACL documental
 * @param {Object} args.knowledgeScope — ResolvedKnowledgeScope do Knowledge Router
 * @param {Object} [args.deps] — dependências injetáveis
 * @param {Object} [args.deps.vectorRag] — cliente Vector RAG
 * @param {Object} [args.deps.knowledgeGraph] — Knowledge Graph service
 * @param {Object} [args.deps.episodicProjection] — Episodic projector
 * @returns {Promise<Object>} { results, sources, strategy, metadata }
 */
async function hybridRetrieve({
  query,
  tenantId,
  actor = null,
  // Roles do ator para a ACL do corpus. Ausente = nenhum role (a busca continua fail-closed: o
  // corpus protegido simplesmente não devolve nada, e o chamador é avisado disso).
  actorRoles = null,
  knowledgeScope,
  deps = {},
} = {}) {
  if (!query || !tenantId || !knowledgeScope) {
    throw new Error('knowledge_retrieval_params_required');
  }

  const results = [];
  const sources = [];
  const strategiesUsed = [];
  // Falhas de estratégia NÃO podem virar vazio mudo: quem consome precisa distinguir "não há
  // conhecimento" de "o serviço de conhecimento está indisponível".
  const strategyFailures = [];

  const knowledgeTypes = knowledgeScope.knowledgeTypes || ['SEMANTIC'];

  // Determina estratégias necessárias baseado nos knowledge types
  const strategies = new Set();
  for (const kt of knowledgeTypes) {
    for (const s of (RETRIEVAL_STRATEGY[kt] || ['vector_rag'])) {
      strategies.add(s);
    }
  }

  // 1. Vector RAG (sempre base quando SEMANTIC presente)
  if (strategies.has('vector_rag') && knowledgeTypes.includes('SEMANTIC')) {
    try {
      const vectorResults = await retrieveVectorRag({
        query,
        tenantId,
        actor,
        actorRoles,
        knowledgeScope,
        deps,
      });
      results.push(...(vectorResults.results || []));
      sources.push(...(vectorResults.sources || []));
      strategiesUsed.push('vector_rag');
    } catch (error) {
      // A falha da estratégia precisa CHEGAR ao consumidor (antes era só um warn no log): sem isso o
      // enriquecedor não distingue "não há conhecimento" de "o serviço de conhecimento caiu".
      strategyFailures.push({ strategy: 'vector_rag', code: error.code || null, message: error.message });
      defaultLogger().warn('[KnowledgePlane] Vector RAG unavailable', { error: error.message, code: error.code || null });
    }
  }

  // 2. Knowledge Graph (STRUCTURAL)
  if (strategies.has('knowledge_graph') && knowledgeTypes.includes('STRUCTURAL')) {
    try {
      const graphResults = await retrieveFromGraph({
        query,
        tenantId,
        knowledgeScope,
        deps,
      });
      results.push(...(graphResults.results || []));
      sources.push(...(graphResults.sources || []));
      strategiesUsed.push('knowledge_graph');
    } catch (error) {
      defaultLogger().warn('[KnowledgePlane] Knowledge Graph unavailable', { error: error.message });
    }
  }

  // 3. Episodic Projection (EPISODIC)
  if (strategies.has('episodic_projection') && knowledgeTypes.includes('EPISODIC')) {
    try {
      const episodicResults = await retrieveEpisodic({
        query,
        tenantId,
        knowledgeScope,
        deps,
      });
      results.push(...(episodicResults.results || []));
      sources.push(...(episodicResults.sources || []));
      strategiesUsed.push('episodic_projection');
    } catch (error) {
      defaultLogger().warn('[KnowledgePlane] Episodic projection unavailable', { error: error.message });
    }
  }

  // Re-ranking com score híbrido
  const ranked = rankResults(results, knowledgeScope, HYBRID_WEIGHTS);

  return {
    // `collections` é uma LISTA; os limites de recuperação vivem em `limits` (defeito real
    // corrigido em 2026-09-25 — ler `collections?.maxResults` sempre devolvia undefined).
    results: ranked.slice(0, knowledgeScope.limits?.maxResults || 10),
    sources: deduplicateSources(sources),
    strategy: strategiesUsed,
    failures: strategyFailures,
    metadata: {
      totalRetrieved: results.length,
      strategiesUsed,
      strategyFailures,
      knowledgeTypes,
      retrievalPurpose: knowledgeScope.retrievalPurpose,
    },
  };
}

// ---------------------------------------------------------------------------
// Retrieval strategies
// ---------------------------------------------------------------------------

async function retrieveVectorRag({ query, tenantId, actor, actorRoles = null, knowledgeScope, deps }) {
  const ragService = deps.vectorRag || (() => {
    try { return require('../../../api/services/ragService'); } catch (_) { return null; }
  })();

  // CAMINHO RETRIEVE-ONLY (correção de arquitetura, 2026-09-25).
  //
  // Antes usava `queryRag`, que BUSCA e GERA: o retrieval dependia do provedor de IA sem precisar.
  // Medido: com ~5954 chunks SYSTEM indexados, o enriquecimento recebia
  // `VECTOR_RAG_UNAVAILABLE` porque o circuit breaker abria por falha de GERAÇÃO — o dado estava
  // lá e a busca vetorial não exige LLM. Agora o caminho é `searchChunks` (`POST /rag/search`),
  // que devolve CHUNKS com score e proveniência, sem geração.
  const search = typeof ragService.searchChunks === 'function'
    ? ragService.searchChunks.bind(ragService)
    : null;
  if (!search) {
    return { results: [], sources: [] };
  }

  const result = await search(query, tenantId, {
    topK: knowledgeScope.limits?.maxResults || 6,
    minScore: knowledgeScope.limits?.minScore ?? undefined,
    // ACL: sem roles informados, a cláusula de interseção do corpus exclui os chunks protegidos
    // (medido: 0 de 5954 no domínio SYSTEM). A ACL não é contornada — os roles vêm do ator.
    filters: Array.isArray(actorRoles) && actorRoles.length > 0 ? { roles: actorRoles } : undefined,
    // Escopo SEMPRE explícito: o domínio SYSTEM (engenharia) não é o default do Domain Policy
    // (que aplica OPERATIONAL/PRODUCTION quando ausente).
    scope: {
      domain: knowledgeScope.domain,
      classifications: knowledgeScope.classifications,
      sensitivities: knowledgeScope.sensitivities,
    },
  });

  // FALHA VISÍVEL (missão V2): antes, `!result.success` virava `{ results: [], sources: [] }` — vazio
  // MUDO. Medido em 2026-09-25: com ~5954 chunks SYSTEM indexados, o retrieval devolvia 0 itens e o
  // único sinal era KNOWLEDGE_NO_RESULTS, que descreve AUSÊNCIA DE CONHECIMENTO quando a causa real
  // era INDISPONIBILIDADE do serviço. Diagnóstico errado é pior que erro: a causa viaja com o erro.
  if (!result.success) {
    const err = new Error(result.error || result.message || 'busca vetorial indisponível');
    err.code = 'VECTOR_RAG_UNAVAILABLE';
    err.ragErrorCode = result.errorCode || result.code || null;
    throw err;
  }

  // O endpoint retrieve-only devolve `chunks` (não `sources`): manter a leitura antiga deixaria o
  // retrieval permanentemente vazio, agora por CONTRATO errado em vez de geração indisponível.
  const chunks = Array.isArray(result.chunks) ? result.chunks : [];
  return {
    results: chunks.map((chunk) => ({
      text: chunk.text || chunk.content || '',
      source: chunk,
      score: chunk.score || 0,
      strategy: 'vector_rag',
    })),
    sources: chunks,
  };
}

async function retrieveFromGraph({ query, tenantId, knowledgeScope, deps }) {
  const graphService = deps.knowledgeGraph || (() => {
    try { return require('../../../api/modules/knowledge-graph/service'); } catch (_) { return null; }
  })();

  if (!graphService || typeof graphService.queryGraph !== 'function') {
    return { results: [], sources: [] };
  }

  try {
    const graphResult = await graphService.queryGraph({
      tenantId,
      query,
      filters: {
        domain: knowledgeScope.domain,
        classifications: knowledgeScope.classifications,
      },
      limit: 10,
    });

    const nodes = graphResult.nodes || graphResult.data || [];
    return {
      results: nodes.map((n) => ({
        text: formatGraphNode(n),
        source: { ...n, sourceKind: 'KNOWLEDGE_GRAPH', knowledgeType: 'STRUCTURAL' },
        score: 0.8,
        strategy: 'knowledge_graph',
      })),
      sources: nodes.map((n) => ({ ...n, sourceKind: 'KNOWLEDGE_GRAPH' })),
    };
  } catch (_) {
    return { results: [], sources: [] };
  }
}

async function retrieveEpisodic({ query, tenantId, knowledgeScope, deps }) {
  // Episodic projection from Event Ledger — TODO: implement projection pipeline.
  // Por enquanto, retorna vazio (não inventa dados).
  return { results: [], sources: [] };
}

// ---------------------------------------------------------------------------
// Ranking & Utilities
// ---------------------------------------------------------------------------

function rankResults(results, knowledgeScope, weights) {
  return results
    .map((r) => {
      const authorityScore = normalizeAuthority(r.source?.authority || 0, 100);
      const purposeMatch = r.source?.retrievalPurposes?.includes(knowledgeScope.retrievalPurpose) ? 1 : 0.5;
      const freshness = computeFreshness(r.source);
      const validationState = r.source?.validatedBy ? 1 : 0.3;
      const graphRelevance = r.strategy === 'knowledge_graph' ? 0.8 : 0;

      const hybridScore =
        (r.score || 0) * weights.semanticSimilarity +
        authorityScore * weights.authority +
        purposeMatch * weights.purposeMatch +
        freshness * weights.freshness +
        validationState * weights.validationState +
        graphRelevance * weights.graphRelevance;

      return { ...r, hybridScore };
    })
    .sort((a, b) => b.hybridScore - a.hybridScore);
}

function normalizeAuthority(value, max) {
  return Math.min(1, Math.max(0, (value || 0) / (max || 100)));
}

function computeFreshness(source) {
  if (!source || !source.lastValidatedAt) return 0.3;
  const ageDays = (Date.now() - new Date(source.lastValidatedAt).getTime()) / (24 * 3600 * 1000);
  if (ageDays < 7) return 1;
  if (ageDays < 30) return 0.8;
  if (ageDays < 90) return 0.5;
  return 0.2;
}

function deduplicateSources(sources) {
  const seen = new Set();
  return sources.filter((s) => {
    const key = s.id || s.sourceRef || JSON.stringify(s);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatGraphNode(node) {
  if (!node) return '';
  const name = node.name || node.label || node.id || '';
  const type = node.type || node.nodeType || '';
  const props = node.properties || node.props || {};
  const propStr = Object.entries(props).map(([k, v]) => `${k}: ${v}`).join(', ');
  return `[${type}] ${name}${propStr ? ` (${propStr})` : ''}`;
}

module.exports = {
  hybridRetrieve,
  HYBRID_WEIGHTS,
  RETRIEVAL_STRATEGY,
};
