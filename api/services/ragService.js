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
  isRagDomainEnabled,
  normalizeTenantId,
} = require('./rag/ragRuntime');
const {
  safeToString,
  safeTrim,
  safeTrimLower,
  safeErrorMessage,
} = require('../utils/defensiveCoercion');
const { resolveRetrievalScope, sanitizeScope } = require('./rag/domainRouter');

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
  const response = await fetchWithTimeout(
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
  if (!query || !query.trim()) {
    throw new Error('Query não pode ser vazia');
  }

  // Inicializa replay (opcional, pode ser desabilitado para performance)
  const shouldRecordReplay = process.env.ENABLE_RAG_REPLAY !== 'false';
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

  tenantId = normalizeTenantId(tenantId);
  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  // Domain Router: resolve o escopo de recuperação ANTES da busca vetorial.
  // Precedência: escopo já resolvido pela rota (filters.scope) > ator do
  // contexto > default restritivo. O domínio nunca vem do texto da pergunta.
  let scopeResolution;
  if (filters.scope) {
    scopeResolution = {
      allowed: true,
      scope: sanitizeScope(filters.scope),
      reason: 'caller_provided_scope',
    };
  } else {
    scopeResolution = resolveRetrievalScope({
      actor: context.actor || null,
      requestedDomain: filters.domain || null,
    });
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

  const retrievalScope = scopeResolution.scope;

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
    
    try {
      const nlpResult = await nlpService.analyzeText(query, true);
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
        topK: filters.topK || 6,  // Aumentado de 5 para 6 para melhor cobertura
        minScore: filters.minScore || 0.45,  // Reduzido de 0.5 para 0.45 para melhor captura de chunks relevantes
        maxTokens: filters.maxTokens || 1000,
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
    
    const response = await fetchWithTimeout(
      `${serviceUrl}/rag/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
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

    return {
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
    const structuralCheck = ragDeduplicationService.checkStructuralDuplicate(tenantId, contentHash, sourceId);
    
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
    const currentVersion = ragDeduplicationService.getCurrentSourceVersion(tenantId, sourceId);
    const sourceVersion = document.metadata?.source_version || (currentVersion + 1);

    // Se é nova versão, desativa versões anteriores
    if (sourceVersion > currentVersion) {
      ragDeduplicationService.deactivatePreviousVersions(tenantId, sourceId, sourceVersion);
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

    const response = await fetchWithTimeout(
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
    
    // Verifica vector store após indexação
    try {
      const healthUrl = `${serviceUrl}/rag/health${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ''}`;
      logger.info('[RAGService] Verificando vector store após indexação', { healthUrl, tenantId });
      
      const healthResponse = await fetchWithTimeout(healthUrl, { method: 'GET' }, 2000);
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        logger.info('[RAGService] Vector store após indexação', {
          tenantId,
          indexedDocuments: healthData.indexedDocuments,
          indexedChunks: healthData.indexedChunks,
          vectorStore: healthData.vectorStore,
          documentId: document.id
        });
      } else {
        logger.warn('[RAGService] Não foi possível verificar vector store após indexação', {
          status: healthResponse.status,
          tenantId
        });
      }
    } catch (healthErr) {
      logger.warn('[RAGService] Erro ao verificar vector store após indexação', {
        error: safeErrorMessage(healthErr),
        tenantId
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
 * Verifica se o serviço RAG está disponível.
 *
 * @returns {Promise<boolean>}
 */
async function isRagAvailable(tenantId = null) {
  try {
    const serviceUrl = getRagServiceUrl(tenantId);
    logger.info('[RAGService] Verificando disponibilidade', { serviceUrl, tenantId });
    
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

    const response = await fetchWithTimeout(
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

    const response = await fetchWithTimeout(
      `${serviceUrl}/rag/learning/metrics/${tenantId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
      },
      timeout
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

    const response = await fetchWithTimeout(
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

    const response = await fetchWithTimeout(
      `${serviceUrl}/rag/learning/full-data/${tenantId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...getRagInternalHeaders(),
        },
      },
      timeout
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

    const response = await fetchWithTimeout(
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

    const response = await fetchWithTimeout(
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

    const response = await fetchWithTimeout(
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
    
    const response = await fetchWithTimeout(
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

  const response = await fetchWithTimeout(url, { method: 'GET', headers: { ...getRagInternalHeaders() } }, Math.min(4000, timeout));
  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Erro ao listar documentos do vector store: HTTP ${response.status} ${errorText || response.statusText}`);
  }
  return await response.json();
}

module.exports = {
  queryRag,
  indexDocument,
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
  cleanOrphanedDocuments,
  listVectorDocuments,
};

