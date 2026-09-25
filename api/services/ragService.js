/**
 * Serviço RAG (Retrieval-Augmented Generation).
 *
 * Responsabilidades:
 * - Cliente HTTP para Python FastAPI RAG
 * - Validação de entrada
 * - Tratamento de erros e fallback
 * - Cache de respostas (opcional)
 */

const config = require('../utils/config');
const logger = require('../utils/logger');
const nlpService = require('./nlpService');
const ragDeduplicationService = require('./ragDeduplicationService');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');
const { resolveRuntimePath } = require('../utils/runtimePaths');
const {
  DEFAULT_RAG_TIMEOUT,
  fetchRagWithBreaker,
  fetchWithTimeout,
  getRagDomainConfig,
  getRagDomainSources,
  getRagDomains,
  getRagInternalHeaders,
  getRagQueryTimeout,
  getRagServiceUrl,
  getRagTimeout,
  getTenantContextForRag,
  handleRagHttpError,
  isRagCircuitOpen,
  isRagDomainEnabled,
  normalizeTenantId,
} = require('./rag/ragRuntime');
const {
  safeToString,
  safeTrim,
  safeTrimLower,
  safeErrorMessage,
} = require('../utils/defensiveCoercion');
// Knowledge Plane: domainRouter é alias backward-compatível do Knowledge Router.
const { resolveRetrievalScope, sanitizeScope } = require('../../src/core/knowledge-plane');
const { getClassificationForAgent } = require('../modules/agent-os/experience-segregation');
const ragResponseCache = require('./rag/ragResponseCache');

// ---------------------------------------------------------------------------
// Gating por intent: saudações e despedidas não precisam de recuperação RAG.
// Vocabulário real do NLP Python (rag-service/services/nlp_service.py):
// question, complaint, request, greeting, goodbye, information, support.
// Não existe intent de "confirmação" no vocabulário; 'goodbye' cobre
// agradecimentos/encerramentos (patterns incluem 'obrigado/obrigada').
// Configurável via env RAG_SKIP_INTENTS (CSV) ou config rag.skipIntents.
// ---------------------------------------------------------------------------

const DEFAULT_SKIP_INTENTS = ['greeting', 'goodbye'];
const DEFAULT_SKIP_INTENT_MIN_CONFIDENCE = 0.3;

function getSkipIntents() {
  const raw = process.env.RAG_SKIP_INTENTS || config.get('rag.skipIntents', '');
  if (!raw || (Array.isArray(raw) && raw.length === 0)) return DEFAULT_SKIP_INTENTS;
  const list = (Array.isArray(raw) ? raw : String(raw).split(','))
    .map((s) => safeTrimLower(s))
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_SKIP_INTENTS;
}

function getSkipIntentMinConfidence() {
  const raw = process.env.RAG_SKIP_INTENT_MIN_CONFIDENCE
    || config.get('rag.skipIntentMinConfidence', String(DEFAULT_SKIP_INTENT_MIN_CONFIDENCE));
  const value = Number.parseFloat(String(raw));
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : DEFAULT_SKIP_INTENT_MIN_CONFIDENCE;
}

/**
 * true se o intent classificado pelo NLP dispensa recuperação RAG.
 * Postura conservadora: só pula com intent classificado E confidence mínima;
 * se o NLP falhar (intent desconhecido), segue para o RAG normalmente.
 */
function shouldSkipRagForIntent(intent, intentConfidence) {
  if (!intent) return false;
  return (
    getSkipIntents().includes(String(intent).toLowerCase())
    && intentConfidence >= getSkipIntentMinConfidence()
  );
}

/**
 * Monta o escopo que entra na chave do cache de respostas: tudo que afeta o
 * resultado do /rag/query (scope de domínio, filtros, opções e tenant_context
 * injetado na query enviada ao Python).
 */
function buildResponseCacheScope(retrievalScope, filters, tenantContext) {
  return {
    scope: retrievalScope,
    filters: {
      roles: Array.isArray(filters.roles) ? filters.roles : [],
      agentId: filters.agentId || null,
      productId: filters.productId || null,
      clientId: filters.clientId || null,
      category: filters.category || null,
    },
    options: {
      topK: filters.topK || 6,
      minScore: filters.minScore ?? 0.45,
      maxTokens: filters.maxTokens || 1000,
    },
    tenantContext: tenantContext ? {
      ramo_atividade: tenantContext.ramo_atividade,
      objetivo: tenantContext.objetivo,
      site_oficial: tenantContext.site_oficial,
      prioridade: tenantContext.prioridade,
      escopo: tenantContext.escopo,
    } : null,
  };
}

function buildEffectiveAccessFilters(actor, filters = {}) {
  const actorRoles = actor
    ? [actor.role, ...(Array.isArray(actor.roles) ? actor.roles : [])]
    : [];
  const roles = [...new Set(actorRoles
    .map((role) => safeTrim(role))
    .filter(Boolean))];

  return {
    ...filters,
    roles,
    // ACL nunca é derivada de filtros controláveis pelo caller. Sem principal
    // autenticado, somente documentos sem restrição de role/agent são elegíveis.
    agentId: actor?.id ? safeTrim(actor.id) : null,
  };
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/**
 * Gera embeddings em batch reutilizando o modelo do serviço RAG (Python).
 *
 * Observação: este endpoint é "utilitário" e não faz busca vetorial, apenas gera embeddings.
 *
 * @param {string[]} texts
 * @param {string} tenantId
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{success: boolean, embeddings: number[][], model?: string, dimensions?: number, error?: string}>}
 */
async function generateEmbeddingsBatch(texts, tenantId, options = {}) {
  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) throw new Error('tenantId é obrigatório');

  const safeTexts = (Array.isArray(texts) ? texts : [])
    .map((t) => safeTrim(t))
    .filter(Boolean)
    .map((t) => (t.length > 4000 ? t.slice(0, 4000) : t))
    .slice(0, 128);

  if (safeTexts.length === 0) {
    return { success: true, embeddings: [], dimensions: 0 };
  }

  const serviceUrl = getRagServiceUrl(tenantId);
  const timeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs : Math.min(getRagTimeout(tenantId) * 2, 15000);

  const url = `${serviceUrl}/rag/embeddings`;
  const response = await fetchRagWithBreaker(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getRagInternalHeaders(),
      },
      body: JSON.stringify({ texts: safeTexts, tenantId }),
    },
    timeout
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Erro ao gerar embeddings via RAG: HTTP ${response.status} ${errorText || response.statusText}`);
  }

  const result = await response.json();
  if (!result || result.success !== true || !Array.isArray(result.embeddings)) {
    return {
      success: false,
      embeddings: [],
      error: result?.error || 'Resposta inválida do endpoint de embeddings',
    };
  }

  return {
    success: true,
    embeddings: result.embeddings,
    model: result.model,
    dimensions: result.dimensions,
  };
}

/**
 * Consulta RAG.
 *
 * @param {string} query - Query do usuário
 * @param {string} tenantId - ID do tenant
 * @param {Object} context - Contexto (sessionId, flowId, nodeId, variables)
 * @param {Object} filters - Filtros (roles, agentId, productId, clientId)
 * @returns {Promise<{success: boolean, response?: string, sources?: Array, confidence?: number, error?: string}>}
 */
async function queryRag(query, tenantId, context = {}, filters = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Query não pode ser vazia');
  }
  if (query.trim().length > 2000) {
    throw new Error('Query excede o limite de 2000 caracteres');
  }

  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  // Replay é exclusivo de interações via UI (RPA browser). Consulta RAG é
  // backend e não é interação via UI — replay fica opt-in via ENABLE_RAG_REPLAY=true.
  const shouldRecordReplay = process.env.ENABLE_RAG_REPLAY === 'true';
  const shouldRecord = process.env.ENABLE_RAG_RECORDING !== 'false';
  let replay = null;
  let replayId = null;
  let recording = null;
  let recordingId = null;
  
  if (shouldRecordReplay) {
    replay = new ReplaySystem({
      storagePath: resolveRuntimePath('replays', 'rag'),
      tenantId,
      context: 'rag',
      enableScreenshots: false,
    });
    
    replayId = `${tenantId}-rag-query-${Date.now()}`;
    replay.start(replayId, {
      tenantId,
      query: query.substring(0, 100), // Primeiros 100 chars
      contextKeys: Object.keys(context),
      filtersKeys: Object.keys(filters),
    });
  }

  if (shouldRecord) {
    recording = new RecordingSystem({
      storagePath: resolveRuntimePath('recordings', 'rag'),
      tenantId,
      context: 'rag',
      enableTimestamps: true,
    });
    
    recordingId = `${tenantId}-rag-query-${Date.now()}`;
    recording.start(recordingId, {
      name: 'Consulta RAG',
      description: 'Consulta ao sistema RAG',
      tenantId,
      query: query.substring(0, 200),
      source: 'automatic',
    });
    recording.recordAction({
      type: 'rag-query',
      step: 'query',
      value: { query: query.substring(0, 200), tenantId },
    });
  }

  filters = buildEffectiveAccessFilters(context.actor || null, filters);

  // Knowledge Router: resolve o escopo de recuperação ANTES da busca vetorial.
  // P1: filters.scope NÃO pode ser bypass — apenas ResolvedKnowledgeScope interno.
  // O domínio nunca vem do texto da pergunta nem de payload externo.
  const { isResolvedScope, resolveKnowledgeContext, resolveRetrievalTenantKeys } = require('../../src/core/knowledge-plane');

  let scopeResolution;
  if (filters.scope && isResolvedScope(filters.scope)) {
    // Scope já resolvido internamente pelo Knowledge Router (ex.: via SpecialistContext).
    scopeResolution = {
      allowed: true,
      scope: filters.scope,
      reason: 'internal_resolved_scope',
    };
  } else if (filters.scope) {
    // P1: Payload externo tentando injetar scope — REJEITADO.
    logger.warn('[RAGService] External scope bypass attempt rejected', {
      tenantId,
      scopeKeys: Object.keys(filters.scope || {}),
    });
    scopeResolution = {
      allowed: false,
      scope: { domain: 'OPERATIONAL', classifications: ['PRODUCTION'] },
      reason: 'external_scope_rejected',
    };
  } else {
    // P1: Usa Principal.classification como fonte canônica (não role).
    const principal = context.actor
      ? {
        classification: context.actor.classification
          || getClassificationForAgent(context.actor)
          || 'PRODUCTION',
      }
      : null;
    const knowledgeResult = resolveKnowledgeContext({
      principal,
      requestedDomain: filters.domain || null,
    });
    scopeResolution = {
      allowed: knowledgeResult.allowed,
      scope: {
        domain: knowledgeResult.scope.domain,
        classifications: [...knowledgeResult.scope.classifications],
      },
      reason: knowledgeResult.scope.reason,
    };
  }

  if (!scopeResolution.allowed) {
    logger.warn('[RAGService] Recuperação negada pelo Domain Router', {
      tenantId,
      reason: scopeResolution.reason,
      actorRole: context.actor?.role || null,
    });
    return {
      success: false,
      error: 'domain_not_allowed',
      reason: scopeResolution.reason,
      response: 'Não encontrei informação operacional autorizada para responder.',
      sources: [],
      confidence: 0,
    };
  }

  const retrievalScope = {
    domain: scopeResolution.scope.domain,
    classifications: [...scopeResolution.scope.classifications],
    // Escopo explícito de tenant: conhecimento OPERACIONAL GLOBAL ∪ do tenant
    // atual. Nunca inclui outro tenant; nunca se aplica ao domínio SYSTEM.
    // O serviço RAG deriva as mesmas chaves de forma independente — este campo
    // é declaração auditável, não autoridade.
    tenantKeys: resolveRetrievalTenantKeys({
      scope: scopeResolution.scope,
      tenantId,
    }),
  };

  try {
    // Carrega tenant_context para injetar contexto cognitivo
    const tenantContext = await getTenantContextForRag(tenantId);
    if (tenantContext) {
      logger.debug('[RAGService] Tenant context carregado', {
        tenantId,
        ramo_atividade: tenantContext.ramo_atividade?.substring(0, 50),
        objetivo: tenantContext.objetivo?.substring(0, 50),
        escopo: tenantContext.escopo,
      });
    }

    // Cache de resposta por tenant/identidade/escopo. Mutações documentais
    // invalidam o tenant; o TTL limita entradas sem mudança de corpus. O check
    // acontece ANTES do NLP analyze e do /rag/query:
    // um hit poupa as 2 chamadas HTTP ao rag-service.
    // Efeito colateral conhecido e DESEJADO: o Python registra cada query
    // para aprendizado adaptativo (rag-service/api/routes/query.py,
    // learning_service.record_query_result); um hit de cache pula esse
    // registro — reduzir queries repetidas é o próprio objetivo do cache.
    const responseCacheKey = ragResponseCache.buildCacheKey(
      tenantId,
      query,
      buildResponseCacheScope(retrievalScope, filters, tenantContext)
    );
    const cachedResponse = ragResponseCache.getCachedResponse(responseCacheKey);
    if (cachedResponse) {
      logger.debug('[RAGService] Resposta RAG servida do cache (hit)', {
        tenantId,
        query: query.substring(0, 100),
      });
      // Cópia superficial marcada — nunca mutar o objeto cacheado.
      return { ...cachedResponse, fromCache: true };
    }

    // Pré-processa query com NLP (opcional, não bloqueia se falhar)
    let processedQuery = query.trim();
    
    // Injeta contexto do tenant na query antes do NLP (se disponível)
    if (tenantContext && tenantContext.ramo_atividade) {
      // Adiciona contexto do ramo de atividade para melhorar busca vetorial
      const contextPrefix = `[Contexto do negócio: ${tenantContext.ramo_atividade}] `;
      processedQuery = contextPrefix + processedQuery;
      logger.debug('[RAGService] Contexto do tenant injetado na query', {
        ramo_atividade: tenantContext.ramo_atividade.substring(0, 50),
      });
    }
    
    let nlpIntent = null;
    let nlpIntentConfidence = 0;
    try {
      const nlpResult = await nlpService.analyzeText(query, true);
      nlpIntent = typeof nlpResult.intent === 'string' ? nlpResult.intent : null;
      nlpIntentConfidence = Number.isFinite(nlpResult.confidence) ? nlpResult.confidence : 0;
      if (nlpResult.expanded_query) {
        // Mantém o contexto do tenant mesmo após expansão NLP
        if (tenantContext && tenantContext.ramo_atividade && !processedQuery.includes('[Contexto do negócio:')) {
          const contextPrefix = `[Contexto do negócio: ${tenantContext.ramo_atividade}] `;
          processedQuery = contextPrefix + nlpResult.expanded_query;
        } else {
          processedQuery = nlpResult.expanded_query;
        }
        logger.debug('[RAGService] Query expandida com NLP', {
          original: query.substring(0, 100),
          expanded: processedQuery.substring(0, 100),
          intent: nlpResult.intent,
        });
      }
    } catch (nlpError) {
      logger.warn('[RAGService] NLP não disponível, usando query original', { error: safeErrorMessage(nlpError) });
      // Continua com query original se NLP falhar
    }

    // Gating por intent: saudações/despedidas não precisam de recuperação RAG.
    // Acontece APÓS o analyze e ANTES do /rag/query. Respostas skipped NÃO
    // entram no cache de respostas. Shape: success=true + skipped=true +
    // response=null — o caller (aiNode) segue sem contexto RAG, sem acionar
    // fallback de erro.
    if (shouldSkipRagForIntent(nlpIntent, nlpIntentConfidence)) {
      logger.info('[RAGService] RAG pulado por gating de intent', {
        tenantId,
        intent: nlpIntent,
        intentConfidence: nlpIntentConfidence,
      });
      return {
        success: true,
        skipped: true,
        reason: 'intent_gated',
        intent: nlpIntent,
        response: null,
        sources: [],
        confidence: 0,
        metadata: { intentConfidence: nlpIntentConfidence },
        error: null,
      };
    }

    const requestBody = {
      query: processedQuery,
      tenantId,
      tenantContext: tenantContext ? {
        ramo_atividade: tenantContext.ramo_atividade,
        objetivo: tenantContext.objetivo,
        site_oficial: tenantContext.site_oficial,
        prioridade: tenantContext.prioridade,
        escopo: tenantContext.escopo,
      } : null,
      filters: {
        roles: filters.roles || [],
        agentId: filters.agentId || null,
        productId: filters.productId || null,
        clientId: filters.clientId || null,
        category: filters.category || null,
      },
      options: {
        topK: Math.trunc(clampNumber(filters.topK, 6, 1, 50)),
        minScore: clampNumber(filters.minScore, 0.45, 0, 1),
        maxTokens: Math.trunc(clampNumber(filters.maxTokens, 1000, 1, 2000)),
      },
      scope: retrievalScope,
    };

    logger.debug('[RAGService] Consultando RAG', {
      query: query.substring(0, 100),
      tenantId,
      filters: requestBody.filters,
    });

    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagQueryTimeout(tenantId);
    
    // Repassa a credencial de LLM do tenant (mesma gerida em Configuração > IA)
    // ao rag-service via header interno, para que a geração use a chave do
    // tenant em vez de depender de OPENAI_API_KEY global. Falha ao resolver a
    // chave não bloqueia: o rag-service cai no fallback sem LLM.
    let ragLlmHeaders = {};
    try {
      // Só resolve a credencial quando a conexão Sequelize já está estabelecida
      // (em testes de unidade não há DB: getSequelize() retorna null e evita o
      // connect() implícito de getDecryptedAPIKey).
      // eslint-disable-next-line global-require
      const { getSequelize } = require('../db/sequelize');
      if (getSequelize()) {
        // eslint-disable-next-line global-require
        const { getDecryptedAPIKey } = require('./tenantAIService');
        const tenantLlmApiKey = await getDecryptedAPIKey(tenantId, 'openai');
        if (tenantLlmApiKey) {
          ragLlmHeaders = { 'X-RAG-LLM-API-Key': tenantLlmApiKey };
        }
      }
    } catch (llmKeyError) {
      logger.warn('[RAGService] Falha ao resolver credencial de LLM do tenant', {
        tenantId,
        error: safeErrorMessage(llmKeyError),
      });
    }
    
    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
          ...ragLlmHeaders,
        },
        body: JSON.stringify(requestBody),
      },
      timeout
    );

    if (!response.ok) {
      const errorText = await response.text();
      const serviceUrl = getRagServiceUrl(tenantId);
      
      // Mensagens mais claras para erros HTTP comuns
      let errorMessage = `RAG service error: ${response.status}`;
      if (response.status === 404) {
        errorMessage = `Endpoint não encontrado no serviço RAG (${serviceUrl}/rag/query). Verifique se o serviço está configurado corretamente.`;
      } else if (response.status === 500) {
        errorMessage = `Erro interno no serviço RAG (${serviceUrl}). Detalhes: ${errorText || 'Erro desconhecido'}`;
      } else if (response.status === 503) {
        errorMessage = `Serviço RAG temporariamente indisponível (${serviceUrl}). Tente novamente mais tarde.`;
      } else {
        errorMessage = `Erro HTTP ${response.status} do serviço RAG: ${errorText || 'Erro desconhecido'}`;
      }
      
      throw new Error(errorMessage);
    }

    const result = await response.json();

    logger.debug('[RAGService] Resposta RAG recebida', {
      success: result.success,
      confidence: result.confidence,
      chunksFound: result.metadata?.chunksFound || 0,
      sourcesCount: result.sources?.length || 0,
      hasResponse: !!result.response,
      error: result.error,
    });
    
    // Log detalhado se não encontrou chunks
    if (!result.success || (result.metadata?.chunksFound || 0) === 0) {
      logger.warn('[RAGService] Nenhum chunk encontrado na busca RAG', {
        tenantId,
        query: query.substring(0, 100),
        success: result.success,
        chunksFound: result.metadata?.chunksFound || 0,
        sourcesCount: result.sources?.length || 0,
        error: result.error,
        response: result.response ? result.response.substring(0, 200) : null,
      });
    }

    // ETAPA 7: Filtra chunks para eliminar duplicatas e garantir diversidade
    let filteredSources = result.sources || [];
    
    if (Array.isArray(filteredSources) && filteredSources.length > 0) {
      // Aplica filtros de deduplicação: remove inativos, máximo 1 por source_id
      filteredSources = ragDeduplicationService.filterChunksForRetrieval(tenantId, filteredSources);
      
      logger.debug('[RAGService] Chunks filtrados após deduplicação', {
        tenantId,
        originalCount: (result.sources || []).length,
        filteredCount: filteredSources.length,
      });
    }

    const responsePayload = {
      success: result.success,
      response: result.response,
      sources: filteredSources, // Usa sources filtrados
      confidence: result.confidence || 0.0,
      metadata: {
        ...result.metadata,
        originalChunksCount: (result.sources || []).length,
        filteredChunksCount: filteredSources.length,
      },
      error: result.error || null,
    };

    // Cacheia SOMENTE sucesso com resposta não-vazia. Erros, respostas
    // vazias e falhas de circuito nunca entram no cache.
    if (
      responsePayload.success
      && typeof responsePayload.response === 'string'
      && responsePayload.response.trim()
    ) {
      ragResponseCache.setCachedResponse(responseCacheKey, responsePayload, tenantId);
    }

    return responsePayload;
  } catch (error) {
    const serviceUrl = getRagServiceUrl(tenantId);
    const rawErrorMessage = safeErrorMessage(error);
    
    // Melhora mensagens de erro para casos comuns
    let errorMessage = rawErrorMessage || 'Erro desconhecido ao consultar RAG';
    
    if (rawErrorMessage.includes('fetch failed') || rawErrorMessage.includes('ECONNREFUSED') || rawErrorMessage.includes('ENOTFOUND')) {
      errorMessage = `Serviço RAG não está acessível em ${serviceUrl}. Verifique se o serviço está rodando.`;
    } else if (rawErrorMessage.includes('timeout')) {
      errorMessage = `Timeout ao consultar serviço RAG em ${serviceUrl}. O serviço pode estar sobrecarregado.`;
    } else if (rawErrorMessage.includes('404') || rawErrorMessage.includes('Not found')) {
      errorMessage = `Endpoint não encontrado no serviço RAG (${serviceUrl}). Verifique se o serviço está configurado corretamente.`;
    }
    
    // Cria um novo erro com mensagem melhorada
    const improvedError = new Error(errorMessage);
    improvedError.originalError = error;
    
    // Registra erro no replay
    if (replay) {
      replay.recordError(improvedError, 'rag-query');
      replay.stop();
      replay.save(`${replayId}-error`);
    }

    // Registra erro na gravação
    if (recording) {
      recording.recordCustom('error', {
        step: 'query-error',
        value: { error: errorMessage },
      });
      recording.stop();
      recording.save(`${recordingId}-error`);
    }
    
    logger.error('[RAGService] Erro ao consultar RAG', {
      error: errorMessage,
      originalError: rawErrorMessage,
      serviceUrl,
      tenantId,
      stack: error.stack,
    });
    
    throw improvedError;
  }
}

/**
 * Indexa um documento.
 *
 * @param {Object} document - Documento a indexar
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<{success: boolean, documentId: string, chunksCreated: number, error?: string}>}
 */
async function indexDocument(document, tenantId) {
  if (!document || !document.id) {
    throw new Error('Documento deve ter id');
  }

  if (!document.content) {
    throw new Error('Documento deve ter content');
  }

  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  try {
    // ETAPA 1: Normalização de conteúdo
    const normalizedContent = ragDeduplicationService.normalizeContent(document.content);
    
    // ETAPA 2: Geração de content_hash
    const contentHash = await ragDeduplicationService.generateContentHash(normalizedContent);
    
    // ETAPA 3: Verificação de duplicidade estrutural
    const sourceId = document.metadata?.source_id || document.id;
    const structuralCheck = await ragDeduplicationService.checkStructuralDuplicate(tenantId, contentHash, sourceId);
    
    if (structuralCheck.isDuplicate) {
      logger.info('[RAGService] Documento duplicado estruturalmente detectado, descartando ingestão', {
        documentId: document.id,
        tenantId,
        contentHash: contentHash.substring(0, 16) + '...',
        existingChunkId: structuralCheck.existingChunk?.chunk_id,
        existingDocumentId: structuralCheck.existingChunk?.document_id,
      });

      // Retorna sucesso mas sem criar novos chunks
      return {
        success: true,
        documentId: structuralCheck.existingChunk?.document_id || document.id,
        chunksCreated: 0,
        isDuplicate: true,
        reason: 'structural_duplicate',
        message: 'Documento duplicado estruturalmente (mesmo conteúdo), usando documento existente',
      };
    }

    // ETAPA 4: Determina source_version
    const currentVersion = await ragDeduplicationService.getCurrentSourceVersion(tenantId, sourceId);
    const sourceVersion = document.metadata?.source_version || (currentVersion + 1);

    // Se é nova versão, desativa versões anteriores
    if (sourceVersion > currentVersion) {
      await ragDeduplicationService.deactivatePreviousVersions(tenantId, sourceId, sourceVersion);
    }

    // ETAPA 5: Prepara metadados obrigatórios
    const enhancedMetadata = {
      ...document.metadata,
      source_id: sourceId,
      source_version: sourceVersion,
      content_hash: contentHash,
      tenant_id: tenantId,
    };

    const requestBody = {
      document: {
        id: document.id,
        tenantId,
        title: document.title || 'Sem título',
        content: normalizedContent, // Usa conteúdo normalizado
        metadata: enhancedMetadata,
        permissions: document.permissions || {},
        status: document.status || 'active',
        // Segregação de domínios: callers operacionais nunca enviam domain —
        // o servidor fixa OPERATIONAL/PRODUCTION. SYSTEM exige declaração
        // explícita de um pipeline técnico autorizado.
        domain: document.domain || 'OPERATIONAL',
        classification: document.classification || 'PRODUCTION',
        sensitivity: document.sensitivity || 'INTERNAL',
      },
    };

    logger.info('[RAGService] Indexando documento (após verificação de duplicidade)', {
      documentId: document.id,
      tenantId,
      title: document.title,
      contentLength: normalizedContent.length,
      contentHash: contentHash.substring(0, 16) + '...',
      sourceId,
      sourceVersion,
    });

    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);
    const url = `${serviceUrl}/rag/index`;
    
    logger.info('[RAGService] Chamando serviço RAG para indexar', { 
      url, 
      documentId: document.id, 
      tenantId,
      serviceUrl,
      requestBody: {
        documentId: requestBody.document.id,
        tenantId: requestBody.document.tenantId,
        title: requestBody.document.title,
        contentLength: requestBody.document.content?.length || 0
      }
    });

    const response = await fetchRagWithBreaker(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
        body: JSON.stringify(requestBody),
      },
      timeout * 2 // Indexação pode demorar mais
    );

    logger.info('[RAGService] Resposta do serviço RAG recebida', {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
      documentId: document.id,
      tenantId
    });

    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = errorText || response.statusText || 'Erro desconhecido';
      logger.error('[RAGService] Erro na resposta do serviço RAG', {
        status: response.status,
        statusText: response.statusText,
        errorText,
        url,
        documentId: document.id,
        tenantId,
      });
      
      if (response.status === 404) {
        throw new Error(`Serviço RAG não encontrado. Verifique se o serviço está rodando em ${serviceUrl}. Erro: ${errorMessage}`);
      }
      
      throw new Error(`RAG service error: ${response.status} ${errorMessage}`);
    }

    const result = await response.json();

    // ETAPA 6: Após indexação, registra chunks nos índices de deduplicação
    // Nota: O serviço Python já faz deduplicação internamente, mas precisamos
    // registrar no Node.js para que o filtro de recuperação funcione corretamente
    // Como não temos os semantic_hashes individuais dos chunks do Python,
    // registramos o documento como um único registro representativo
    if (result.success && result.chunksCreated > 0) {
      try {
        // Gera chunk_id determinístico para o documento completo
        const chunkId = ragDeduplicationService.generateChunkId(document.id, '', 0);
        
        // Gera semantic_hash baseado no content_hash (placeholder até termos embeddings reais)
        // Isso permite que o registro funcione, mas a deduplicação semântica real
        // acontece no Python durante a indexação
        const semanticHash = ragDeduplicationService.generateContentHashSync(
          contentHash + document.id + tenantId
        );
        
        const chunkMetadata = {
          chunk_id: chunkId,
          document_id: document.id,
          source_id: sourceId || document.id,
          source_version: sourceVersion || 1,
          content_hash: contentHash || '',
          semantic_hash: semanticHash,
          active: true,
          created_at: new Date().toISOString(),
        };

        ragDeduplicationService.registerChunk(tenantId, chunkMetadata, null);
        
        logger.debug('[RAGService] Chunk registrado nos índices de deduplicação', {
          tenantId,
          chunkId: chunkId.substring(0, 16) + '...',
          documentId: document.id,
          chunksCreated: result.chunksCreated,
        });
      } catch (dedupError) {
        logger.warn('[RAGService] Erro ao registrar chunk na deduplicação (não bloqueia indexação)', {
          error: dedupError.message,
          documentId: document.id,
          tenantId,
        });
      }
    }

    logger.info('[RAGService] Documento indexado com sucesso', {
      documentId: result.documentId,
      chunksCreated: result.chunksCreated,
      success: result.success,
      tenantId,
      contentHash: contentHash.substring(0, 16) + '...',
      sourceId,
      sourceVersion,
    });

    // Corpus do tenant mudou: invalida cache de respostas para não servir
    // respostas stale até o TTL expirar.
    const invalidatedCache = ragResponseCache.invalidateTenant(tenantId);
    if (invalidatedCache > 0) {
      logger.debug('[RAGService] Cache de respostas invalidado após indexação', {
        tenantId,
        invalidated: invalidatedCache,
      });
    }

    return {
      success: result.success,
      documentId: result.documentId,
      chunksCreated: result.chunksCreated || 0,
      error: result.error || null,
      isDuplicate: false, // Já foi verificado antes, então não é duplicata
      contentHash: contentHash ? contentHash.substring(0, 16) + '...' : null,
      sourceId: sourceId || document.id,
      sourceVersion: sourceVersion || 1,
    };
  } catch (error) {
    logger.error('[RAGService] Erro ao indexar documento', {
      error: safeErrorMessage(error),
      documentId: document.id,
    });
    throw error;
  }
}

/**
 * Remove um documento do índice RAG do tenant (chunks + status inactive).
 *
 * O índice é DERIVADO: quando a fonte canônica é removida (ex.: manual
 * operacional excluído), o índice correspondente não pode sobreviver.
 * Escopo sempre por tenant — o serviço RAG nunca remove documento de outro
 * tenant, mesmo que um documentId alheio seja informado.
 *
 * @param {string} documentId
 * @param {string} tenantId
 * @returns {Promise<{success: boolean, documentId: string, chunksRemoved: number}>}
 */
async function deindexDocument(documentId, tenantId) {
  const normalizedId = safeTrim(documentId);
  if (!normalizedId) {
    throw new Error('documentId é obrigatório');
  }
  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  const serviceUrl = getRagServiceUrl(tenantId);
  const timeout = getRagTimeout(tenantId);

  const response = await fetchRagWithBreaker(
    `${serviceUrl}/rag/deindex`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getRagInternalHeaders(),
      },
      body: JSON.stringify({ documentId: normalizedId, tenantId }),
    },
    timeout
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`RAG service error: ${response.status} ${errorText || response.statusText}`);
  }

  const result = await response.json();
  return {
    success: result?.success === true,
    documentId: result?.documentId || normalizedId,
    chunksRemoved: Number.isFinite(result?.chunksRemoved) ? result.chunksRemoved : 0,
    error: result?.error || null,
  };
}

/**
 * BUSCA VETORIAL PURA (retrieve-only) — devolve CHUNKS, nunca uma resposta gerada.
 *
 * ACHADO REAL (2026-09-25): só existia `queryRag`, que busca chunks E gera resposta com LLM.
 * Consumidores que precisam de CONTEÚDO (enriquecimento de engenharia, análise) ficavam reféns do
 * provedor de IA: com ~5954 chunks SYSTEM indexados, o retrieval devolvia indisponibilidade
 * porque o breaker abria por falha de GERAÇÃO — sendo que a busca vetorial não precisa de LLM.
 *
 * Aqui a separação é explícita: RETRIEVAL não é GERAÇÃO. Mesma infraestrutura do `queryRag`
 * (URL por tenant, headers internos, breaker, timeout), sem a etapa de geração.
 *
 * `scope` NUNCA é opcional na prática: sem ele, o Domain Policy aplica o mais restritivo
 * (`OPERATIONAL`/`PRODUCTION`). Consumidores do domínio SYSTEM DEVEM informar o escopo.
 *
 * @returns {Promise<{success:boolean, chunks:Array, metadata:Object, error:string|null}>}
 */
async function searchChunks(query, tenantId, options = {}) {
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('Query não pode ser vazia');
  }
  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  const serviceUrl = getRagServiceUrl(tenantId);
  const timeout = getRagQueryTimeout(tenantId);

  const payload = {
    query: safeTrim(query).substring(0, 2000),
    tenantId,
    topK: Number.isFinite(options.topK) ? options.topK : undefined,
    minScore: Number.isFinite(options.minScore) ? options.minScore : undefined,
  };
  if (options.scope) payload.scope = options.scope;
  if (options.filters) payload.filters = options.filters;

  const response = await fetchRagWithBreaker(
    `${serviceUrl}/rag/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getRagInternalHeaders(),
      },
      body: JSON.stringify(payload),
    },
    timeout
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    // Falha de busca é ERRO, nunca lista vazia: quem consome precisa distinguir
    // "não há conhecimento" de "o serviço falhou".
    return {
      success: false,
      chunks: [],
      metadata: null,
      error: `RAG search error: ${response.status} ${safeErrorMessage(errorText) || response.statusText}`,
    };
  }

  const result = await response.json();
  return {
    success: result?.success === true,
    chunks: Array.isArray(result?.chunks) ? result.chunks : [],
    metadata: result?.metadata || null,
    error: result?.error || null,
  };
}

/**
 * Verifica se o serviço RAG está disponível.
 *
 * @returns {Promise<boolean>}
 */
async function isRagAvailable(tenantId = null) {
  try {
    // Circuito aberto: indisponibilidade já conhecida — responde false sem
    // ir à rede e sem contar falha nova no breaker.
    if (isRagCircuitOpen()) {
      logger.warn('[RAGService] Circuit breaker aberto, RAG considerado indisponível sem health check', { tenantId });
      return false;
    }

    const serviceUrl = getRagServiceUrl(tenantId);
    logger.info('[RAGService] Verificando disponibilidade', { serviceUrl, tenantId });

    // Health check é probe diagnóstico: usa fetchWithTimeout direto (sem
    // retry e sem alimentar o breaker — quem alimenta é o tráfego real).
    const response = await fetchWithTimeout(
      `${serviceUrl}/rag/health`,
      {
        method: 'GET',
        headers: {
          ...getRagInternalHeaders(),
        },
      },
      2000 // Timeout menor para health check
    );

    if (!response.ok) {
      logger.warn('[RAGService] Resposta não OK', { 
        status: response.status, 
        statusText: response.statusText,
        serviceUrl,
        tenantId 
      });
      return false;
    }

    const result = await response.json();
    const isHealthy = result.status === 'healthy';
    logger.info('[RAGService] Status do serviço', { 
      isHealthy, 
      status: result.status,
      serviceUrl,
      tenantId 
    });
    return isHealthy;
  } catch (error) {
    logger.warn('[RAGService] Serviço RAG não disponível', {
      error: safeErrorMessage(error),
      stack: error.stack,
      tenantId
    });
    return false;
  }
}

/**
 * Atualiza sinônimos aprendidos baseado em documentos.
 *
 * @param {string} tenantId - ID do tenant
 * @param {Array} documents - Lista de documentos
 * @returns {Promise<{success: boolean, synonymsCount?: number, error?: string}>}
 */
async function updateSynonymsFromDocuments(tenantId, documents) {
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  if (!documents || !Array.isArray(documents)) {
    throw new Error('documents deve ser um array');
  }

  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);

    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/learning/update-synonyms`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          documents: documents.map(doc => ({
            id: doc.id,
            title: doc.title || '',
            content: doc.content || '',
            metadata: doc.metadata || {},
          })),
        }),
      },
      timeout
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw handleRagHttpError(response, serviceUrl, '/rag/learning/update-synonyms', errorText);
    }

    const result = await response.json();

    logger.info('[RAGService] Sinônimos atualizados', {
      tenantId,
      synonymsCount: result.synonymsCount,
    });

    return {
      success: result.success,
      synonymsCount: result.synonymsCount,
      synonyms: result.synonyms,
    };
  } catch (error) {
    logger.error('[RAGService] Erro ao atualizar sinônimos', {
      error: safeErrorMessage(error),
      tenantId,
    });
    throw error;
  }
}

/**
 * Obtém métricas de aprendizado para um tenant.
 *
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Métricas de aprendizado
 */
async function getLearningMetrics(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);

    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/learning/metrics/${tenantId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
      },
      timeout,
      { idempotent: true }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw await handleRagHttpError(response, serviceUrl, `/rag/learning/metrics/${tenantId}`, errorText);
    }

    return await response.json();
  } catch (error) {
    logger.error('[RAGService] Erro ao obter métricas de aprendizado', {
      error: safeErrorMessage(error),
      tenantId,
    });
    throw error;
  }
}

/**
 * Dispara processo de aprendizado completo para um tenant.
 *
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Resultado do aprendizado
 */
async function triggerLearning(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);

    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/learning/trigger-learning/${tenantId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
      },
      timeout * 2 // Aprendizado pode demorar mais
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw await handleRagHttpError(response, serviceUrl, `/rag/learning/trigger-learning/${tenantId}`, errorText);
    }

    const result = await response.json();

    logger.info('[RAGService] Aprendizado disparado', {
      tenantId,
      optimizedConfig: result.optimizedConfig,
    });

    return result;
  } catch (error) {
    logger.error('[RAGService] Erro ao disparar aprendizado', {
      error: safeErrorMessage(error),
      tenantId,
    });
    throw error;
  }
}

/**
 * Obtém todos os dados de aprendizado para um tenant.
 *
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Dados completos de aprendizado
 */
async function getFullLearningData(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);

    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/learning/full-data/${tenantId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
      },
      timeout,
      { idempotent: true }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw await handleRagHttpError(response, serviceUrl, `/rag/learning/full-data/${tenantId}`, errorText);
    }

    return await response.json();
  } catch (error) {
    logger.error('[RAGService] Erro ao obter dados completos de aprendizado', {
      error: safeErrorMessage(error),
      tenantId,
    });
    throw error;
  }
}

/**
 * Atualiza sinônimos de um termo específico.
 *
 * @param {string} tenantId - ID do tenant
 * @param {string} term - Termo principal
 * @param {Array<string>} synonyms - Lista de sinônimos
 * @returns {Promise<Object>} Resultado da atualização
 */
async function updateSynonym(tenantId, term, synonyms) {
  if (!tenantId || !term) {
    throw new Error('tenantId e term são obrigatórios');
  }

  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);

    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/learning/synonyms`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
        body: JSON.stringify({
          tenant_id: tenantId,
          term,
          synonyms: Array.isArray(synonyms) ? synonyms : [synonyms],
        }),
      },
      timeout
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw await handleRagHttpError(response, serviceUrl, '/rag/learning/synonyms', errorText);
    }

    return await response.json();
  } catch (error) {
    logger.error('[RAGService] Erro ao atualizar sinônimo', {
      error: safeErrorMessage(error),
      tenantId,
      term,
    });
    throw error;
  }
}

/**
 * Remove um sinônimo específico.
 *
 * @param {string} tenantId - ID do tenant
 * @param {string} term - Termo a remover
 * @returns {Promise<Object>} Resultado da remoção
 */
async function deleteSynonym(tenantId, term) {
  if (!tenantId || !term) {
    throw new Error('tenantId e term são obrigatórios');
  }

  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);

    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/learning/synonyms/${tenantId}/${encodeURIComponent(term)}`,
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
      },
      timeout
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw await handleRagHttpError(response, serviceUrl, `/rag/learning/synonyms/${tenantId}/${encodeURIComponent(term)}`, errorText);
    }

    return await response.json();
  } catch (error) {
    logger.error('[RAGService] Erro ao remover sinônimo', {
      error: safeErrorMessage(error),
      tenantId,
      term,
    });
    throw error;
  }
}

/**
 * Remove queries inválidas do histórico de aprendizado.
 *
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Resultado da limpeza
 */
async function cleanInvalidQueries(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);

    const response = await fetchRagWithBreaker(
      `${serviceUrl}/rag/learning/clean-invalid-queries/${tenantId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
      },
      timeout
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw await handleRagHttpError(response, serviceUrl, `/rag/learning/clean-invalid-queries/${tenantId}`, errorText);
    }

    return await response.json();
  } catch (error) {
    logger.error('[RAGService] Erro ao limpar queries inválidas', {
      error: safeErrorMessage(error),
      tenantId,
    });
    throw error;
  }
}

/** Obtém as regras de validação do aprendizado via canal interno autenticado. */
async function getValidationRules(tenantId) {
  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) throw new Error('tenantId é obrigatório');

  const serviceUrl = getRagServiceUrl(tenantId);
  const response = await fetchRagWithBreaker(
    `${serviceUrl}/rag/learning/validation-rules`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...getRagInternalHeaders(),
      },
    },
    getRagTimeout(tenantId),
    { idempotent: true }
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw await handleRagHttpError(response, serviceUrl, '/rag/learning/validation-rules', errorText);
  }
  return response.json();
}

/** Adapta as regras de validação de um tenant via canal interno autenticado. */
async function adaptValidationRules(tenantId) {
  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) throw new Error('tenantId é obrigatório');

  const serviceUrl = getRagServiceUrl(tenantId);
  const endpoint = `/rag/learning/validation-rules/adapt/${encodeURIComponent(tenantId)}`;
  const response = await fetchRagWithBreaker(
    `${serviceUrl}${endpoint}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getRagInternalHeaders(),
      },
    },
    getRagTimeout(tenantId)
  );
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw await handleRagHttpError(response, serviceUrl, endpoint, errorText);
  }
  return response.json();
}

/**
 * Remove documentos órfãos do vector store.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string[]} documentIds - Lista de IDs de documentos para remover
 * @returns {Promise<{success: boolean, removedDocuments: number, removedChunks: number, error?: string}>}
 */
async function cleanOrphanedDocuments(tenantId, documentIds) {
  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    const url = `${serviceUrl}/rag/clean-orphans?tenant_id=${encodeURIComponent(tenantId)}`;
    
    logger.info('[RAGService] Limpando documentos órfãos', {
      tenantId,
      documentIdsCount: documentIds.length,
      url
    });
    
    const response = await fetchRagWithBreaker(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
        body: JSON.stringify({ document_ids: documentIds })
      },
      getRagTimeout(tenantId) * 2 // Timeout maior para operação de limpeza
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[RAGService] Erro ao limpar documentos órfãos', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        tenantId
      });
      throw new Error(`Erro ao limpar documentos órfãos: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    logger.info('[RAGService] Documentos órfãos removidos', {
      tenantId,
      success: result.success,
      removedDocuments: result.removedDocuments,
      removedChunks: result.removedChunks,
      orphanedDocuments: result.orphanedDocuments?.length || 0
    });

    // Corpus do tenant mudou: invalida cache de respostas.
    ragResponseCache.invalidateTenant(tenantId);
    
    return {
      success: result.success,
      removedDocuments: result.removedDocuments || 0,
      removedChunks: result.removedChunks || 0,
      orphanedDocuments: result.orphanedDocuments || [],
      error: result.error
    };
  } catch (error) {
    logger.error('[RAGService] Erro ao limpar documentos órfãos', {
      error: safeErrorMessage(error),
      tenantId
    });
    throw error;
  }
}

/**
 * Lista documentIds presentes no vector store (por tenant).
 *
 * @param {string} tenantId
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{success: boolean, tenantId: string, documentIds: string[], documentCount: number, chunkCount: number, error?: string}>}
 */
async function listVectorDocuments(tenantId, options = {}) {
  if (!tenantId) throw new Error('tenantId é obrigatório');
  const limit = Number.isFinite(options.limit) ? options.limit : 5000;

  const serviceUrl = getRagServiceUrl(tenantId);
  const timeout = getRagTimeout(tenantId);
  const url = `${serviceUrl}/rag/documents?tenant_id=${encodeURIComponent(tenantId)}&limit=${encodeURIComponent(safeToString(limit))}`;

  const response = await fetchRagWithBreaker(url, { method: 'GET', headers: { ...getRagInternalHeaders() } }, Math.min(4000, timeout), { idempotent: true });
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Erro ao listar documentos do vector store: HTTP ${response.status} ${errorText || response.statusText}`);
  }
  return await response.json();
}

module.exports = {
  queryRag,
  searchChunks,
  indexDocument,
  deindexDocument,
  isRagAvailable,
  getRagServiceUrl,
  getRagTimeout,
  getRagInternalHeaders,
  getRagDomains,
  getRagDomainConfig,
  isRagDomainEnabled,
  getRagDomainSources,
  generateEmbeddingsBatch,
  updateSynonymsFromDocuments,
  getLearningMetrics,
  triggerLearning,
  getFullLearningData,
  updateSynonym,
  deleteSynonym,
  cleanInvalidQueries,
  getValidationRules,
  adaptValidationRules,
  cleanOrphanedDocuments,
  listVectorDocuments,
};
