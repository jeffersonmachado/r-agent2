/**
 * Serviço de gerenciamento de documentos RAG.
 * 
 * Responsabilidades:
 * - CRUD de documentos
 * - Persistência em arquivo JSON
 * - Integração com ragService para indexação
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const ragService = require('./ragService');
const config = require('../utils/config');

const dataDir = path.join(__dirname, '../data');
const documentsFile = path.join(dataDir, 'rag_documents.json');

// Cache em memória
let documents = new Map();

/**
 * Carrega documentos do arquivo.
 */
function loadDocuments() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (fs.existsSync(documentsFile)) {
      const data = fs.readFileSync(documentsFile, 'utf8');
      const parsedData = JSON.parse(data);
      // Garante que seja um array
      const docsArray = Array.isArray(parsedData) ? parsedData : [];
      documents = new Map(docsArray.map(doc => [doc.id, doc]));
      logger.info(`[RAGDocuments] Carregados ${documents.size} documentos`);
    } else {
      documents = new Map();
      saveDocuments();
    }
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao carregar documentos:', error);
    documents = new Map();
  }
}

/**
 * Salva documentos no arquivo.
 */
function saveDocuments() {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const docsArray = Array.from(documents.values());
    fs.writeFileSync(documentsFile, JSON.stringify(docsArray, null, 2), 'utf8');
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao salvar documentos:', error);
    throw error;
  }
}

/**
 * Lista documentos com filtros opcionais.
 * 
 * @param {Object} filters - Filtros (tenantId, source, category, productId, clientId, status)
 * @returns {Array} Lista de documentos
 */
function listDocuments(filters = {}) {
  let result = Array.from(documents.values());

  if (filters.tenantId) {
    result = result.filter(doc => doc.tenantId === filters.tenantId);
  }

  if (filters.source) {
    result = result.filter(doc => doc.metadata?.source === filters.source);
  }

  if (filters.category) {
    result = result.filter(doc => doc.metadata?.category === filters.category);
  }

  if (filters.productId) {
    result = result.filter(doc => doc.metadata?.productId === filters.productId);
  }

  if (filters.clientId) {
    result = result.filter(doc => doc.metadata?.clientId === filters.clientId);
  }

  if (filters.status) {
    result = result.filter(doc => doc.status === filters.status);
  }

  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    result = result.filter(doc => 
      doc.title?.toLowerCase().includes(searchLower) ||
      doc.content?.toLowerCase().includes(searchLower)
    );
  }

  // Ordena por data de atualização (mais recente primeiro)
  result.sort((a, b) => {
    const dateA = new Date(a.metadata?.updatedAt || a.metadata?.createdAt || 0);
    const dateB = new Date(b.metadata?.updatedAt || b.metadata?.createdAt || 0);
    return dateB - dateA;
  });

  return result;
}

/**
 * Obtém um documento por ID.
 * 
 * @param {string} documentId - ID do documento
 * @returns {Object|null} Documento ou null
 */
function getDocument(documentId) {
  return documents.get(documentId) || null;
}

/**
 * Cria um novo documento.
 * 
 * @param {Object} documentData - Dados do documento
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<{success: boolean, document: Object, error?: string}>}
 */
async function createDocument(documentData, tenantId) {
  try {
    const now = new Date().toISOString();
    
    const document = {
      id: documentData.id || `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      tenantId: tenantId || documentData.tenantId || config.get('api.defaultTenantId', 'tenant-demo'),
      title: documentData.title || 'Sem título',
      content: documentData.content || '',
      metadata: {
        source: documentData.metadata?.source || 'manual',
        category: documentData.metadata?.category || null,
        productId: documentData.metadata?.productId || null,
        clientId: documentData.metadata?.clientId || null,
        tags: documentData.metadata?.tags || [],
        author: documentData.metadata?.author || null,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      permissions: {
        roles: documentData.permissions?.roles || null,
        agents: documentData.permissions?.agents || null,
      },
      status: documentData.status || 'active',
      indexed: false,
      indexedAt: null,
      chunksCount: 0,
    };

    documents.set(document.id, document);
    saveDocuments();

    // Indexa automaticamente se solicitado
    if (documentData.autoIndex !== false) {
      try {
        const indexResult = await ragService.indexDocument(document, document.tenantId);
        if (indexResult.success) {
          document.indexed = true;
          document.indexedAt = new Date().toISOString();
          document.chunksCount = indexResult.chunksCreated || 0;
          saveDocuments();
        }
      } catch (indexError) {
        logger.warn('[RAGDocuments] Erro ao indexar documento automaticamente:', indexError.message);
        // Não falha a criação se a indexação falhar
      }
    }

    return {
      success: true,
      document,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao criar documento:', error);
    return {
      success: false,
      document: null,
      error: error.message,
    };
  }
}

/**
 * Atualiza um documento existente.
 * 
 * @param {string} documentId - ID do documento
 * @param {Object} updates - Atualizações
 * @returns {Promise<{success: boolean, document: Object|null, error?: string}>}
 */
async function updateDocument(documentId, updates) {
  try {
    const document = documents.get(documentId);
    if (!document) {
      return {
        success: false,
        document: null,
        error: 'Documento não encontrado',
      };
    }

    // Atualiza campos permitidos
    if (updates.title !== undefined) {
      document.title = updates.title;
    }
    if (updates.content !== undefined) {
      document.content = updates.content;
    }
    if (updates.status !== undefined) {
      document.status = updates.status;
    }
    if (updates.metadata) {
      document.metadata = {
        ...document.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
      };
    }
    if (updates.permissions) {
      document.permissions = {
        ...document.permissions,
        ...updates.permissions,
      };
    }

    // Incrementa versão se conteúdo mudou
    if (updates.content !== undefined) {
      document.metadata.version = (document.metadata.version || 1) + 1;
    }

    document.metadata.updatedAt = new Date().toISOString();
    documents.set(documentId, document);
    saveDocuments();

    // Reindexa se solicitado e conteúdo mudou
    if (updates.reindex && updates.content !== undefined) {
      try {
        const indexResult = await ragService.indexDocument(document, document.tenantId);
        if (indexResult.success) {
          document.indexed = true;
          document.indexedAt = new Date().toISOString();
          document.chunksCount = indexResult.chunksCreated || 0;
          saveDocuments();
        }
      } catch (indexError) {
        logger.warn('[RAGDocuments] Erro ao reindexar documento:', indexError.message);
      }
    }

    return {
      success: true,
      document,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao atualizar documento:', error);
    return {
      success: false,
      document: null,
      error: error.message,
    };
  }
}

/**
 * Deleta um documento.
 * 
 * @param {string} documentId - ID do documento
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteDocument(documentId) {
  try {
    const document = documents.get(documentId);
    if (!document) {
      return {
        success: false,
        error: 'Documento não encontrado',
      };
    }

    documents.delete(documentId);
    saveDocuments();

    // TODO: Deletar do vector store também (quando implementado no Python)

    return {
      success: true,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao deletar documento:', error);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Reindexa um documento.
 * 
 * @param {string} documentId - ID do documento
 * @returns {Promise<{success: boolean, chunksCreated: number, error?: string}>}
 */
async function reindexDocument(documentId) {
  try {
    const document = documents.get(documentId);
    if (!document) {
      return {
        success: false,
        chunksCreated: 0,
        error: 'Documento não encontrado',
      };
    }

    if (!document.content) {
      return {
        success: false,
        chunksCreated: 0,
        error: 'Documento não tem conteúdo',
      };
    }

    const indexResult = await ragService.indexDocument(document, document.tenantId);
    
    if (indexResult.success) {
      document.indexed = true;
      document.indexedAt = new Date().toISOString();
      document.chunksCount = indexResult.chunksCreated || 0;
      saveDocuments();
    }

    return {
      success: indexResult.success,
      chunksCreated: indexResult.chunksCreated || 0,
      error: indexResult.error || null,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao reindexar documento:', error);
    return {
      success: false,
      chunksCreated: 0,
      error: error.message,
    };
  }
}

/**
 * Reindexa todos os documentos não indexados.
 * 
 * @param {string} [tenantId] - ID do tenant (opcional)
 * @returns {Promise<{success: boolean, total: number, indexed: number, failed: number, errors: Array}>}
 */
async function reindexAllNotIndexed(tenantId = null) {
  try {
    let docs = Array.from(documents.values());
    
    // Filtra por tenant se fornecido
    if (tenantId) {
      docs = docs.filter(doc => doc.tenantId === tenantId);
    }
    
    // Filtra apenas documentos não indexados
    const notIndexedDocs = docs.filter(doc => !doc.indexed && doc.status === 'active' && doc.content);
    
    if (notIndexedDocs.length === 0) {
      return {
        success: true,
        total: 0,
        indexed: 0,
        failed: 0,
        errors: [],
      };
    }
    
    let indexed = 0;
    let failed = 0;
    const errors = [];
    
    logger.info(`[RAGDocuments] Iniciando reindexação em lote de ${notIndexedDocs.length} documentos`);
    
    // Verifica se o serviço RAG está disponível antes de começar
    const ragService = require('./ragService');
    const serviceUrl = ragService.getRagServiceUrl(tenantId);
    const isAvailable = await ragService.isRagAvailable(tenantId);
    if (!isAvailable) {
      logger.error('[RAGDocuments] Serviço RAG não está disponível', { tenantId, serviceUrl });
      return {
        success: false,
        total: notIndexedDocs.length,
        indexed: 0,
        failed: notIndexedDocs.length,
        errors: [{
          documentId: 'all',
          title: 'Serviço RAG indisponível',
          error: `O serviço RAG não está respondendo. Verifique se está rodando em ${serviceUrl}`,
        }],
      };
    }
    
    // Reindexa cada documento
    for (const doc of notIndexedDocs) {
      try {
        const result = await reindexDocument(doc.id);
        if (result.success) {
          indexed++;
          logger.debug(`[RAGDocuments] Documento ${doc.id} reindexado com sucesso`);
        } else {
          failed++;
          errors.push({
            documentId: doc.id,
            title: doc.title,
            error: result.error || 'Erro desconhecido',
          });
          logger.warn(`[RAGDocuments] Falha ao reindexar documento ${doc.id}: ${result.error}`);
        }
      } catch (error) {
        failed++;
        errors.push({
          documentId: doc.id,
          title: doc.title,
          error: error.message || 'Erro desconhecido',
        });
        logger.error(`[RAGDocuments] Erro ao reindexar documento ${doc.id}:`, error);
      }
    }
    
    logger.info(`[RAGDocuments] Reindexação em lote concluída: ${indexed} indexados, ${failed} falharam`);
    
    return {
      success: true,
      total: notIndexedDocs.length,
      indexed,
      failed,
      errors,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao reindexar documentos em lote:', error);
    return {
      success: false,
      total: 0,
      indexed: 0,
      failed: 0,
      errors: [{ error: error.message }],
    };
  }
}

/**
 * Obtém estatísticas de documentos.
 * 
 * @param {string} tenantId - ID do tenant (opcional)
 * @returns {Object} Estatísticas
 */
function getDocumentsStats(tenantId = null) {
  let docs = Array.from(documents.values());
  
  if (tenantId) {
    docs = docs.filter(doc => doc.tenantId === tenantId);
  }

  const stats = {
    total: docs.length,
    indexed: docs.filter(doc => doc.indexed).length,
    notIndexed: docs.filter(doc => !doc.indexed).length,
    bySource: {},
    byCategory: {},
    byStatus: {},
    totalChunks: 0,
  };

  docs.forEach(doc => {
    const source = doc.metadata?.source || 'unknown';
    const category = doc.metadata?.category || 'uncategorized';
    const status = doc.status || 'active';

    stats.bySource[source] = (stats.bySource[source] || 0) + 1;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
    stats.totalChunks += doc.chunksCount || 0;
  });

  return stats;
}

// Carrega documentos na inicialização
loadDocuments();

module.exports = {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  reindexDocument,
  reindexAllNotIndexed,
  getDocumentsStats,
  loadDocuments,
};

