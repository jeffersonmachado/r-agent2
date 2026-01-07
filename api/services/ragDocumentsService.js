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

// Valida que o ragService foi carregado corretamente
if (!ragService || typeof ragService.indexDocument !== 'function') {
  logger.error('[RAGDocuments] ERRO CRÍTICO: ragService não foi carregado corretamente', {
    ragServiceType: typeof ragService,
    ragServiceKeys: ragService ? Object.keys(ragService) : 'null',
    hasIndexDocument: ragService && 'indexDocument' in ragService,
    indexDocumentType: ragService && typeof ragService.indexDocument
  });
  throw new Error('ragService não foi carregado corretamente. Verifique se o módulo api/services/ragService.js existe e exporta indexDocument.');
}

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

    // Valida que a função existe
    if (typeof ragService.indexDocument !== 'function') {
      logger.error('[RAGDocuments] ragService.indexDocument não é uma função', {
        documentId,
        ragServiceType: typeof ragService,
        ragServiceKeys: Object.keys(ragService || {}),
        hasIndexDocument: 'indexDocument' in (ragService || {})
      });
      return {
        success: false,
        chunksCreated: 0,
        error: 'ragService.indexDocument não está disponível. Verifique se o módulo foi carregado corretamente.',
      };
    }

    logger.info('[RAGDocuments] Reindexando documento', {
      documentId: document.id,
      tenantId: document.tenantId,
      title: document.title,
      contentLength: document.content?.length || 0,
      currentlyIndexed: document.indexed
    });

    const indexResult = await ragService.indexDocument(document, document.tenantId);
    
    logger.info('[RAGDocuments] Resultado da indexação', {
      documentId: document.id,
      success: indexResult.success,
      chunksCreated: indexResult.chunksCreated,
      error: indexResult.error,
      tenantId: document.tenantId
    });
    
    if (indexResult.success) {
      document.indexed = true;
      document.indexedAt = new Date().toISOString();
      document.chunksCount = indexResult.chunksCreated || 0;
      saveDocuments();
      
      logger.info('[RAGDocuments] Documento marcado como indexado no BD', {
        documentId: document.id,
        chunksCount: document.chunksCount,
        indexedAt: document.indexedAt
      });
    } else {
      logger.error('[RAGDocuments] Falha ao indexar documento', {
        documentId: document.id,
        error: indexResult.error,
        tenantId: document.tenantId
      });
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
 * Reindexa todos os documentos não indexados ou inconsistentes.
 * 
 * @param {string} [tenantId] - ID do tenant (opcional)
 * @param {boolean} [includeInconsistent=false] - Se true, também reindexa documentos marcados como indexados mas que podem não estar no vector store
 * @returns {Promise<{success: boolean, total: number, indexed: number, failed: number, errors: Array}>}
 */
async function reindexAllNotIndexed(tenantId = null, includeInconsistent = false) {
  try {
    let docs = Array.from(documents.values());
    
    // Filtra por tenant se fornecido
    if (tenantId) {
      docs = docs.filter(doc => doc.tenantId === tenantId);
    }
    
    // Filtra documentos não indexados
    let notIndexedDocs = docs.filter(doc => !doc.indexed && doc.status === 'active' && doc.content);
    
    // Se includeInconsistent for true, também inclui documentos marcados como indexados
    // (para sincronizar com o vector store)
    if (includeInconsistent) {
      const indexedDocs = docs.filter(doc => doc.indexed && doc.status === 'active' && doc.content);
      notIndexedDocs = [...notIndexedDocs, ...indexedDocs];
    }
    
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
    // Usa o ragService já importado no topo do arquivo
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
    
    // Verifica vector store antes de começar
    try {
      const healthUrlBefore = tenantId 
        ? `${serviceUrl}/rag/health?tenant_id=${encodeURIComponent(tenantId)}`
        : `${serviceUrl}/rag/health`;
      let fetchFn = typeof global.fetch === 'function' ? global.fetch : require('node-fetch');
      const beforeResponse = await fetchFn(healthUrlBefore, { method: 'GET' });
      if (beforeResponse.ok) {
        const beforeData = await beforeResponse.json();
        logger.info('[RAGDocuments] Vector store ANTES da reindexação', {
          tenantId,
          indexedDocuments: beforeData.indexedDocuments,
          indexedChunks: beforeData.indexedChunks,
          vectorStore: beforeData.vectorStore,
          embeddingModel: beforeData.embeddingModel
        });
      }
    } catch (beforeErr) {
      logger.warn('[RAGDocuments] Não foi possível verificar vector store antes da reindexação', {
        error: beforeErr.message,
        tenantId
      });
    }
    
    // Reindexa cada documento
    for (let i = 0; i < notIndexedDocs.length; i++) {
      const doc = notIndexedDocs[i];
      logger.info(`[RAGDocuments] Processando documento ${i + 1}/${notIndexedDocs.length}`, {
        documentId: doc.id,
        title: doc.title,
        tenantId: doc.tenantId
      });
      
      try {
        const result = await reindexDocument(doc.id);
        if (result.success) {
          indexed++;
          logger.info(`[RAGDocuments] Documento ${doc.id} reindexado com sucesso`, {
            documentId: doc.id,
            chunksCreated: result.chunksCreated,
            indexed: indexed,
            total: notIndexedDocs.length
          });
          
          // Verifica vector store após cada indexação bem-sucedida
          try {
            const healthUrlAfter = tenantId 
              ? `${serviceUrl}/rag/health?tenant_id=${encodeURIComponent(tenantId)}`
              : `${serviceUrl}/rag/health`;
            let fetchFn = typeof global.fetch === 'function' ? global.fetch : require('node-fetch');
            const afterResponse = await fetchFn(healthUrlAfter, { method: 'GET' });
            if (afterResponse.ok) {
              const afterData = await afterResponse.json();
              logger.info(`[RAGDocuments] Vector store APÓS indexar documento ${doc.id}`, {
                documentId: doc.id,
                tenantId,
                indexedDocuments: afterData.indexedDocuments,
                indexedChunks: afterData.indexedChunks,
                progress: `${indexed}/${notIndexedDocs.length}`
              });
            }
          } catch (afterErr) {
            logger.warn(`[RAGDocuments] Erro ao verificar vector store após indexar ${doc.id}`, {
              error: afterErr.message,
              documentId: doc.id
            });
          }
        } else {
          failed++;
          errors.push({
            documentId: doc.id,
            title: doc.title,
            error: result.error || 'Erro desconhecido',
          });
          logger.error(`[RAGDocuments] Falha ao reindexar documento ${doc.id}`, {
            documentId: doc.id,
            error: result.error,
            indexed: indexed,
            failed: failed
          });
        }
      } catch (error) {
        failed++;
        errors.push({
          documentId: doc.id,
          title: doc.title,
          error: error.message || 'Erro desconhecido',
        });
        logger.error(`[RAGDocuments] Erro ao reindexar documento ${doc.id}`, {
          documentId: doc.id,
          error: error.message,
          stack: error.stack,
          indexed: indexed,
          failed: failed
        });
      }
    }
    
    // Verifica vector store após TODA a reindexação
    try {
      const healthUrlFinal = tenantId 
        ? `${serviceUrl}/rag/health?tenant_id=${encodeURIComponent(tenantId)}`
        : `${serviceUrl}/rag/health`;
      let fetchFn = typeof global.fetch === 'function' ? global.fetch : require('node-fetch');
      const finalResponse = await fetchFn(healthUrlFinal, { method: 'GET' });
      if (finalResponse.ok) {
        const finalData = await finalResponse.json();
        logger.info('[RAGDocuments] Vector store APÓS reindexação completa', {
          tenantId,
          indexedDocuments: finalData.indexedDocuments,
          indexedChunks: finalData.indexedChunks,
          vectorStore: finalData.vectorStore,
          embeddingModel: finalData.embeddingModel,
          totalIndexed: indexed,
          totalFailed: failed,
          totalProcessed: notIndexedDocs.length
        });
      }
    } catch (finalErr) {
      logger.warn('[RAGDocuments] Não foi possível verificar vector store após reindexação completa', {
        error: finalErr.message,
        tenantId
      });
    }
    
    logger.info(`[RAGDocuments] Reindexação em lote concluída: ${indexed} indexados, ${failed} falharam`);
    
    // Verifica consistência após reindexação
    // Usa uma função auxiliar para evitar recursão (getDocumentsStats chama loadDocuments que pode causar problemas)
    let consistencyCheck = null;
    try {
      logger.info('[RAGDocuments] Verificando consistência após reindexação', { tenantId });
      
      // Busca stats do vector store diretamente sem passar por getDocumentsStats completo
      // para evitar problemas de recursão
      const isAvailable = await ragService.isRagAvailable(tenantId);
      if (isAvailable) {
        const serviceUrl = ragService.getRagServiceUrl(tenantId);
        let fetchFn;
        try {
          if (typeof global.fetch === 'function') {
            fetchFn = global.fetch;
          } else {
            fetchFn = require('node-fetch');
          }
          
          const healthUrl = tenantId 
            ? `${serviceUrl}/rag/health?tenant_id=${encodeURIComponent(tenantId)}`
            : `${serviceUrl}/rag/health`;
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // Timeout maior para verificação
          
          const response = await fetchFn(healthUrl, {
            method: 'GET',
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            const vectorData = await response.json();
            
            logger.info('[RAGDocuments] Dados do vector store recebidos na verificação de consistência', {
              tenantId,
              vectorData,
              healthUrl,
              indexedDocuments: vectorData.indexedDocuments,
              indexedChunks: vectorData.indexedChunks,
              vectorStore: vectorData.vectorStore,
              embeddingModel: vectorData.embeddingModel,
              aggregated: vectorData.aggregated,
              tenantsCount: vectorData.tenantsCount
            });
            
            // Recarrega documentos para obter contagem atualizada do BD
            loadDocuments();
            let docs = Array.from(documents.values());
            if (tenantId) {
              docs = docs.filter(doc => doc.tenantId === tenantId);
            }
            const dbIndexed = docs.filter(doc => doc.indexed).length;
            const vectorIndexed = vectorData.indexedDocuments || 0;
            const isConsistent = dbIndexed === vectorIndexed;
            
            logger.info('[RAGDocuments] Comparação BD vs Vector Store na verificação de consistência', {
              tenantId,
              dbIndexed,
              vectorIndexed,
              difference: dbIndexed - vectorIndexed,
              isConsistent,
              totalDocs: docs.length,
              docsIndexedInBD: docs.filter(doc => doc.indexed).map(doc => ({
                id: doc.id,
                title: doc.title,
                indexed: doc.indexed,
                indexedAt: doc.indexedAt
              }))
            });
            
            consistencyCheck = {
              isConsistent,
              dbIndexed,
              vectorIndexed,
              difference: dbIndexed - vectorIndexed,
              message: isConsistent 
                ? `✅ Consistência verificada: ${dbIndexed} documentos no BD e ${vectorIndexed} no vector store`
                : `⚠️ Inconsistência detectada: ${dbIndexed} documentos no BD mas apenas ${vectorIndexed} no vector store (diferença: ${dbIndexed - vectorIndexed})`
            };
            
            logger.info('[RAGDocuments] Verificação de consistência concluída', {
              ...consistencyCheck,
              tenantId,
              totalDocs: docs.length,
              vectorStoreDetails: {
                indexedDocuments: vectorData.indexedDocuments,
                indexedChunks: vectorData.indexedChunks,
                vectorStore: vectorData.vectorStore,
                embeddingModel: vectorData.embeddingModel
              }
            });
          } else {
            logger.warn('[RAGDocuments] Não foi possível verificar consistência - resposta não OK', {
              status: response.status,
              tenantId
            });
            consistencyCheck = {
              isConsistent: null,
              error: `Resposta do vector store não OK: ${response.status}`,
              message: 'Não foi possível verificar consistência - vector store não respondeu corretamente'
            };
          }
        } catch (fetchErr) {
          logger.warn('[RAGDocuments] Erro ao verificar consistência', {
            error: fetchErr.message,
            tenantId
          });
          consistencyCheck = {
            isConsistent: null,
            error: fetchErr.message,
            message: 'Não foi possível verificar consistência - erro ao consultar vector store'
          };
        }
      } else {
        logger.warn('[RAGDocuments] RAG Service não disponível para verificação de consistência', { tenantId });
        consistencyCheck = {
          isConsistent: null,
          error: 'RAG Service não disponível',
          message: 'Não foi possível verificar consistência - RAG Service não está disponível'
        };
      }
    } catch (consistencyError) {
      logger.warn('[RAGDocuments] Erro ao verificar consistência após reindexação', {
        error: consistencyError.message,
        tenantId
      });
      consistencyCheck = {
        isConsistent: null,
        error: consistencyError.message,
        message: 'Não foi possível verificar consistência após reindexação'
      };
    }
    
    return {
      success: true,
      total: notIndexedDocs.length,
      indexed,
      failed,
      errors,
      consistencyCheck,
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
async function getDocumentsStats(tenantId = null) {
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
    // Adiciona informações do vector store para comparação
    vectorStoreStats: null,
    syncStatus: null,
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

  // Tenta obter estatísticas do vector store para comparação
  logger.info('[RAGDocuments] Verificando disponibilidade do RAG Service', { tenantId });
  try {
    const isAvailable = await ragService.isRagAvailable(tenantId);
    logger.info('[RAGDocuments] RAG Service disponível', { isAvailable, tenantId });
    
    if (isAvailable) {
      const serviceUrl = ragService.getRagServiceUrl(tenantId);
      logger.info('[RAGDocuments] URL do RAG Service', { serviceUrl, tenantId });
      
      // Usa fetch nativo do Node.js 18+ ou fallback
      let fetchFn;
      try {
        if (typeof global.fetch === 'function') {
          fetchFn = global.fetch;
        } else {
          fetchFn = require('node-fetch');
        }
        
        // Se há tenantId, busca estatísticas desse tenant específico
        // Caso contrário, busca estatísticas agregadas de todos os tenants
        const healthUrl = tenantId 
          ? `${serviceUrl}/rag/health?tenant_id=${encodeURIComponent(tenantId)}`
          : `${serviceUrl}/rag/health`;
        
        logger.info('[RAGDocuments] Buscando estatísticas do vector store', { 
          healthUrl, 
          tenantId,
          dbIndexed: stats.indexed,
          dbTotal: stats.total
        });
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const response = await fetchFn(healthUrl, {
          method: 'GET',
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        logger.info('[RAGDocuments] Resposta do vector store', { 
          status: response.status,
          ok: response.ok,
          tenantId 
        });
        
        if (response.ok) {
          const vectorData = await response.json();
          logger.info('[RAGDocuments] Dados do vector store recebidos', { 
            vectorData,
            tenantId 
          });
          
          stats.vectorStoreStats = {
            indexedDocuments: vectorData.indexedDocuments || 0,
            indexedChunks: vectorData.indexedChunks || 0,
            aggregated: vectorData.aggregated || false,
            tenantsCount: vectorData.tenantsCount || 1,
            tenantId: vectorData.tenantId || tenantId || null,
          };
          
          // Calcula status de sincronização
          const dbIndexed = stats.indexed;
          const vectorIndexed = stats.vectorStoreStats.indexedDocuments;
          
          logger.info('[RAGDocuments] Comparando BD vs Vector Store', {
            tenantId,
            dbIndexed,
            vectorIndexed,
            difference: dbIndexed - vectorIndexed
          });
          
          if (dbIndexed === vectorIndexed) {
            stats.syncStatus = 'synced';
            logger.info('[RAGDocuments] Status: Sincronizado', { tenantId });
          } else if (dbIndexed > vectorIndexed) {
            stats.syncStatus = 'db_ahead';
            stats.syncDifference = dbIndexed - vectorIndexed;
            logger.warn('[RAGDocuments] INCONSISTÊNCIA DETECTADA: BD à frente', {
              tenantId,
              dbIndexed,
              vectorIndexed,
              syncDifference: stats.syncDifference
            });
          } else {
            stats.syncStatus = 'vector_ahead';
            stats.syncDifference = vectorIndexed - dbIndexed;
            logger.warn('[RAGDocuments] INCONSISTÊNCIA DETECTADA: Vector Store à frente', {
              tenantId,
              dbIndexed,
              vectorIndexed,
              syncDifference: stats.syncDifference
            });
          }
        } else {
          logger.warn('[RAGDocuments] Resposta do vector store não OK', {
            status: response.status,
            statusText: response.statusText,
            tenantId
          });
        }
      } catch (fetchErr) {
        logger.error('[RAGDocuments] Erro ao buscar stats do vector store', { 
          error: fetchErr.message,
          stack: fetchErr.stack,
          tenantId,
          healthUrl
        });
        
        // Se falhou mas há docs indexados, marca como possível inconsistência
        if (stats.indexed > 0) {
          stats.vectorStoreStats = {
            indexedDocuments: 0,
            indexedChunks: 0,
            aggregated: false,
            tenantsCount: 0,
            tenantId: tenantId || null,
            error: fetchErr.message
          };
          stats.syncStatus = 'db_ahead';
          stats.syncDifference = stats.indexed;
          logger.warn('[RAGDocuments] Assumindo inconsistência devido a erro na conexão', {
            tenantId,
            dbIndexed: stats.indexed,
            error: fetchErr.message
          });
        }
      }
    } else {
      logger.warn('[RAGDocuments] RAG Service não disponível', { tenantId });
      
      // Se RAG não está disponível mas há docs indexados, marca como possível inconsistência
      if (stats.indexed > 0) {
        stats.vectorStoreStats = {
          indexedDocuments: 0,
          indexedChunks: 0,
          aggregated: false,
          tenantsCount: 0,
          tenantId: tenantId || null,
          error: 'RAG Service não disponível'
        };
        stats.syncStatus = 'db_ahead';
        stats.syncDifference = stats.indexed;
        logger.warn('[RAGDocuments] Assumindo inconsistência - RAG Service não disponível', {
          tenantId,
          dbIndexed: stats.indexed
        });
      }
    }
  } catch (err) {
    logger.error('[RAGDocuments] Erro ao verificar vector store stats', { 
      error: err.message,
      stack: err.stack,
      tenantId 
    });
    
    // Se houve erro mas há docs indexados, marca como possível inconsistência
    if (stats.indexed > 0) {
      stats.vectorStoreStats = {
        indexedDocuments: 0,
        indexedChunks: 0,
        aggregated: false,
        tenantsCount: 0,
        tenantId: tenantId || null,
        error: err.message
      };
      stats.syncStatus = 'db_ahead';
      stats.syncDifference = stats.indexed;
      logger.warn('[RAGDocuments] Assumindo inconsistência devido a erro', {
        tenantId,
        dbIndexed: stats.indexed,
        error: err.message
      });
    }
  }
  
  logger.info('[RAGDocuments] Estatísticas finais retornadas', {
    tenantId,
    total: stats.total,
    indexed: stats.indexed,
    notIndexed: stats.notIndexed,
    syncStatus: stats.syncStatus,
    syncDifference: stats.syncDifference,
    hasVectorStoreStats: !!stats.vectorStoreStats,
    vectorStoreIndexed: stats.vectorStoreStats?.indexedDocuments || 0,
    vectorStoreError: stats.vectorStoreStats?.error || null
  });

  return stats;
}

// Carrega documentos na inicialização
loadDocuments();

/**
 * Limpa documentos órfãos do vector store (documentos que estão no vector store mas não no BD).
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string[]} orphanedDocumentIds - Lista de IDs de documentos órfãos para remover
 * @returns {Promise<{success: boolean, removedDocuments: number, removedChunks: number, orphanedDocuments: string[]}>}
 */
async function cleanOrphanedDocuments(tenantId = null, orphanedDocumentIds = []) {
  try {
    logger.info('[RAGDocuments] Iniciando limpeza de documentos órfãos', { 
      tenantId,
      orphanedDocumentIdsCount: orphanedDocumentIds.length 
    });
    
    if (!orphanedDocumentIds || orphanedDocumentIds.length === 0) {
      logger.warn('[RAGDocuments] Nenhum documento órfão fornecido para remover', { tenantId });
      return {
        success: false,
        removedDocuments: 0,
        removedChunks: 0,
        orphanedDocuments: [],
        error: 'Nenhum documento órfão fornecido'
      };
    }
    
    // Chama o RAG Service para remover os documentos órfãos
    const result = await ragService.cleanOrphanedDocuments(tenantId, orphanedDocumentIds);
    
    logger.info('[RAGDocuments] Limpeza de documentos órfãos concluída', {
      tenantId,
      success: result.success,
      removedDocuments: result.removedDocuments,
      removedChunks: result.removedChunks
    });
    
    return result;
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao limpar documentos órfãos', {
      error: error.message,
      tenantId
    });
    throw error;
  }
}

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
  cleanOrphanedDocuments,
};

