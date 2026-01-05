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

// URL padrão do serviço Python RAG
const DEFAULT_RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || config.get('rag.serviceUrl', 'http://localhost:8000');
const DEFAULT_RAG_TIMEOUT = parseInt(process.env.RAG_TIMEOUT || config.get('rag.timeout', '5000'), 10);

/**
 * Obtém a URL do serviço RAG para um tenant específico.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {string} URL do serviço RAG
 */
function getRagServiceUrl(tenantId) {
  if (!tenantId) {
    return DEFAULT_RAG_SERVICE_URL;
  }
  
  // Verifica se há configuração específica para o tenant
  const ragConfig = config.get('rag', {});
  const tenantsConfig = ragConfig.tenants || {};
  const tenantConfig = tenantsConfig[tenantId];
  
  if (tenantConfig && tenantConfig.serviceUrl) {
    return tenantConfig.serviceUrl;
  }
  
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
      throw new Error(`RAG service timeout após ${timeout}ms`);
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
    // Pré-processa query com NLP (opcional, não bloqueia se falhar)
    let processedQuery = query.trim();
    try {
      const nlpResult = await nlpService.analyzeText(query, true);
      if (nlpResult.expanded_query) {
        processedQuery = nlpResult.expanded_query;
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
      throw new Error(`RAG service error: ${response.status} ${errorText}`);
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
    logger.error('[RAGService] Erro ao consultar RAG', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
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

    logger.debug('[RAGService] Indexando documento', {
      documentId: document.id,
      tenantId,
      title: document.title,
    });

    const serviceUrl = getRagServiceUrl(tenantId);
    const timeout = getRagTimeout(tenantId);
    const url = `${serviceUrl}/rag/index`;
    
    logger.debug('[RAGService] Chamando serviço RAG', { url, documentId: document.id, tenantId });

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

    if (!response.ok) {
      const errorText = await response.text();
      const errorMessage = errorText || response.statusText || 'Erro desconhecido';
      logger.error('[RAGService] Erro na resposta do serviço RAG', {
        status: response.status,
        statusText: response.statusText,
        errorText,
        url,
        documentId: document.id,
      });
      
      if (response.status === 404) {
        throw new Error(`Serviço RAG não encontrado. Verifique se o serviço está rodando em ${serviceUrl}. Erro: ${errorMessage}`);
      }
      
      throw new Error(`RAG service error: ${response.status} ${errorMessage}`);
    }

    const result = await response.json();

    logger.info('[RAGService] Documento indexado', {
      documentId: result.documentId,
      chunksCreated: result.chunksCreated,
    });

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
    const response = await fetchWithTimeout(
      `${serviceUrl}/rag/health`,
      {
        method: 'GET',
      },
      2000 // Timeout menor para health check
    );

    if (!response.ok) {
      return false;
    }

    const result = await response.json();
    return result.status === 'healthy';
  } catch (error) {
    logger.debug('[RAGService] Serviço RAG não disponível', {
      error: error.message,
    });
    return false;
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
};

