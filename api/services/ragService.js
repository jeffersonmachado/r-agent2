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
const { getTenantContext } = require('./tenantService');

// URL padrão do serviço Python RAG
const DEFAULT_RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || config.get('rag.serviceUrl', 'http://localhost:8000');
const DEFAULT_RAG_TIMEOUT = parseInt(process.env.RAG_TIMEOUT || config.get('rag.timeout', '5000'), 10);

/**
 * Obtém a URL do serviço RAG para um tenant específico.
 * 
 * IMPORTANTE: Variáveis de ambiente têm prioridade sobre config.json
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {string} URL do serviço RAG
 */
function getRagServiceUrl(tenantId) {
  // 1) Prioridade: variável de ambiente (override de tudo)
  if (process.env.RAG_SERVICE_URL) {
    return process.env.RAG_SERVICE_URL;
  }
  
  if (!tenantId) {
    return DEFAULT_RAG_SERVICE_URL;
  }
  
  // 2) Verifica se há configuração específica para o tenant no config.json
  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[tenantId];
  
  if (tenantConfig && tenantConfig.serviceUrl) {
    return tenantConfig.serviceUrl;
  }
  
  // 3) Fallback para URL padrão
  return DEFAULT_RAG_SERVICE_URL;
}

/**
 * Obtém o timeout do serviço RAG para um tenant específico.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {number} Timeout em milissegundos
 */
function getRagTimeout(tenantId) {
  if (!tenantId) {
    return DEFAULT_RAG_TIMEOUT;
  }
  
  // Verifica se há configuração específica para o tenant
  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[tenantId];
  
  if (tenantConfig && tenantConfig.timeout) {
    return parseInt(tenantConfig.timeout, 10);
  }
  
  return DEFAULT_RAG_TIMEOUT;
}

/**
 * Obtém a configuração de domínios RAG para um tenant específico.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Object} Configuração de domínios
 */
function getRagDomains(tenantId) {
  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[tenantId];
  
  if (tenantConfig && tenantConfig.domains) {
    return tenantConfig.domains;
  }
  
  // Retorna configuração padrão se não houver específica
  return {
    chatbot: {
      sources: ['knowledge_base', 'product_docs', 'chat_upload'],
      defaultCategory: 'general',
      enabled: true,
    },
    rpa: {
      sources: ['knowledge_base', 'product_docs'],
      defaultCategory: 'rpa',
      enabled: true,
    },
  };
}

/**
 * Obtém a configuração de um domínio específico para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} domain - Nome do domínio ('chatbot' ou 'rpa')
 * @returns {Object|null} Configuração do domínio ou null se não encontrado
 */
function getRagDomainConfig(tenantId, domain) {
  const domains = getRagDomains(tenantId);
  return domains[domain] || null;
}

/**
 * Verifica se um domínio está habilitado para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} domain - Nome do domínio ('chatbot' ou 'rpa')
 * @returns {boolean} true se habilitado
 */
function isRagDomainEnabled(tenantId, domain) {
  const domainConfig = getRagDomainConfig(tenantId, domain);
  return domainConfig ? domainConfig.enabled !== false : true;
}

/**
 * Obtém as fontes permitidas para um domínio de um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} domain - Nome do domínio ('chatbot' ou 'rpa')
 * @returns {string[]} Array de fontes permitidas
 */
function getRagDomainSources(tenantId, domain) {
  const domainConfig = getRagDomainConfig(tenantId, domain);
  return domainConfig ? (domainConfig.sources || []) : [];
}

/**
 * Trata erros HTTP do serviço RAG de forma padronizada.
 *
 * @param {Response} response - Resposta HTTP
 * @param {string} serviceUrl - URL do serviço
 * @param {string} endpoint - Endpoint que foi chamado
 * @param {string} errorText - Texto do erro
 * @returns {Error} Erro formatado
 */
function handleRagHttpError(response, serviceUrl, endpoint, errorText = 'Erro desconhecido') {
  if (response.status === 404) {
    return new Error(`Endpoint não encontrado no serviço RAG (${serviceUrl}${endpoint}). Verifique se o serviço está configurado corretamente e se as rotas foram carregadas. O serviço pode precisar ser reiniciado.`);
  } else if (response.status === 500) {
    return new Error(`Erro interno no serviço RAG (${serviceUrl}${endpoint}). Detalhes: ${errorText}`);
  } else if (response.status === 503) {
    return new Error(`Serviço RAG temporariamente indisponível (${serviceUrl}${endpoint}). Tente novamente mais tarde.`);
  } else {
    return new Error(`Erro HTTP ${response.status} do serviço RAG: ${errorText}`);
  }
}

/**
 * Faz requisição HTTP com timeout.
 *
 * @param {string} url - URL da requisição
 * @param {Object} options - Opções da requisição
 * @param {number} timeout - Timeout em ms
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = DEFAULT_RAG_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`RAG service timeout após ${timeout}ms ao acessar ${url}`);
    }
    // Melhora mensagens de erro de conexão
    if (error.message && error.message.includes('fetch failed')) {
      throw new Error(`Falha ao conectar com serviço RAG em ${url}. Verifique se o serviço está rodando e acessível.`);
    }
    throw error;
  }
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

  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  try {
    // Carrega tenant_context para injetar contexto cognitivo
    let tenantContext = null;
    try {
      tenantContext = getTenantContext(tenantId);
      if (tenantContext) {
        logger.debug('[RAGService] Tenant context carregado', {
          tenantId,
          ramo_atividade: tenantContext.ramo_atividade?.substring(0, 50),
          objetivo: tenantContext.objetivo?.substring(0, 50),
          escopo: tenantContext.escopo,
        });
      }
    } catch (contextError) {
      logger.warn('[RAGService] Erro ao carregar tenant context', { error: contextError.message });
      // Continua sem contexto se falhar
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
      logger.warn('[RAGService] NLP não disponível, usando query original', { error: nlpError.message });
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
    };

    logger.debug('[RAGService] Consultando RAG', {
      query: query.substring(0, 100),
      tenantId,
      filters: requestBody.filters,
    });

    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);
    
    const response = await fetchWithTimeout(
      `${serviceUrl}/rag/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
    });

    return {
      success: result.success,
      response: result.response,
      sources: result.sources || [],
      confidence: result.confidence || 0.0,
      metadata: result.metadata || {},
      error: result.error || null,
    };
  } catch (error) {
    const serviceUrl = getRagServiceUrl(tenantId);
    
    // Melhora mensagens de erro para casos comuns
    let errorMessage = error.message;
    
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
      errorMessage = `Serviço RAG não está acessível em ${serviceUrl}. Verifique se o serviço está rodando.`;
    } else if (error.message.includes('timeout')) {
      errorMessage = `Timeout ao consultar serviço RAG em ${serviceUrl}. O serviço pode estar sobrecarregado.`;
    } else if (error.message.includes('404') || error.message.includes('Not found')) {
      errorMessage = `Endpoint não encontrado no serviço RAG (${serviceUrl}). Verifique se o serviço está configurado corretamente.`;
    }
    
    logger.error('[RAGService] Erro ao consultar RAG', {
      error: errorMessage,
      originalError: error.message,
      serviceUrl,
      tenantId,
      stack: error.stack,
    });
    
    // Cria um novo erro com mensagem melhorada
    const improvedError = new Error(errorMessage);
    improvedError.originalError = error;
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

  if (!tenantId) {
    throw new Error('tenantId é obrigatório');
  }

  try {
    const requestBody = {
      document: {
        id: document.id,
        tenantId,
        title: document.title || 'Sem título',
        content: document.content,
        metadata: document.metadata || {},
        permissions: document.permissions || {},
        status: document.status || 'active',
      },
    };

    logger.info('[RAGService] Indexando documento', {
      documentId: document.id,
      tenantId,
      title: document.title,
      contentLength: document.content?.length || 0,
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

    logger.info('[RAGService] Documento indexado com sucesso', {
      documentId: result.documentId,
      chunksCreated: result.chunksCreated,
      success: result.success,
      tenantId,
      result: result
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
        error: healthErr.message,
        tenantId
      });
    }

    return {
      success: result.success,
      documentId: result.documentId,
      chunksCreated: result.chunksCreated || 0,
      error: result.error || null,
    };
  } catch (error) {
    logger.error('[RAGService] Erro ao indexar documento', {
      error: error.message,
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
      error: error.message,
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
      error: error.message,
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
      error: error.message,
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
      error: error.message,
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
      error: error.message,
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
      error: error.message,
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
      error: error.message,
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
      error: error.message,
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
      error: error.message,
      tenantId
    });
    throw error;
  }
}

module.exports = {
  queryRag,
  indexDocument,
  isRagAvailable,
  getRagServiceUrl,
  getRagTimeout,
  getRagDomains,
  getRagDomainConfig,
  isRagDomainEnabled,
  getRagDomainSources,
  updateSynonymsFromDocuments,
  getLearningMetrics,
  triggerLearning,
  getFullLearningData,
  updateSynonym,
  deleteSynonym,
  cleanInvalidQueries,
  cleanOrphanedDocuments,
};

