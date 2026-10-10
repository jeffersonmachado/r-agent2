const logger = require('../../utils/logger');
const { safeErrorMessage, safeToString } = require('../../utils/defensiveCoercion');
const { setIndexState } = require('./ragDocumentsState');
const { hasIndexableContent } = require('./indexableContent');

const ragService = require('../ragService');

/**
 * Reindexa um documento único.
 * 
 * @param {string} documentId - ID do documento
 * @param {Map} documentsCache - Cache de documentos (referência mutável)
 * @param {Function} persistFn - Persistência obrigatória do estado do documento
 * @param {Function} [loadContentFn] - Carrega content via query pontual quando o cache é leve
 * @returns {Promise<{success: boolean, chunksCreated: number, error?: string, errorCode?: string}>}
 */
async function reindexDocument(documentId, documentsCache, persistFn, loadContentFn = null) {
  try {
    const document = documentsCache.get(documentId);
    if (!document) {
      return {
        success: false,
        chunksCreated: 0,
        error: 'Documento não encontrado',
      };
    }

    // Cache leve: content não fica em memória; busca pontual no DB quando ausente
    let content = document.content;
    if (content === undefined && loadContentFn) {
      content = await loadContentFn(documentId);
    }

    if (!content) {
      return {
        success: false,
        chunksCreated: 0,
        error: 'Documento não tem conteúdo',
      };
    }

    // Conteúdo que é APENAS o placeholder de "sem texto extraído" não tem o que
    // embeddar. Indexá-lo cria um chunk fantasma que pontua alto e vira FONTE do
    // copiloto (medido em 2026-10-08: `.jpeg` sem OCR como 1ª fonte de "Como faço
    // uma matrícula?"). O documento continua existindo como asset; só sai do
    // índice — inclusive o chunk de versões anteriores, que é removido aqui.
    if (!hasIndexableContent(content)) {
      let chunksRemoved = 0;
      try {
        const deindex = await ragService.deindexDocument(document.id, document.tenantId);
        chunksRemoved = deindex?.chunksRemoved || 0;
      } catch (deindexError) {
        // A remoção é limpeza: o retrieval já é fail-closed pelo estado do pai
        // (`index_status` diferente de `indexed`). Falha aqui não autoriza
        // indexar o placeholder.
        logger.warn('[RAGDocuments] Falha ao remover chunks de documento sem texto', {
          documentId: document.id,
          tenantId: document.tenantId,
          error: safeErrorMessage(deindexError),
        });
      }
      setIndexState(document, 'not_applicable_no_text', {
        errorCode: 'NO_TEXT_EXTRACTED',
        errorMessage: 'Documento sem texto extraído: mantido fora do índice de busca.',
      });
      if (persistFn) await persistFn(document);
      logger.warn('[RAGDocuments] Documento sem texto extraído não é indexado', {
        documentId: document.id,
        tenantId: document.tenantId,
        chunksRemoved,
      });
      return {
        success: false,
        chunksCreated: 0,
        chunksRemoved,
        errorCode: 'NO_TEXT_EXTRACTED',
        error: 'Documento sem texto extraído: mantido fora do índice de busca.',
      };
    }

    logger.info('[RAGDocuments] Reindexando documento', {
      documentId: document.id,
      tenantId: document.tenantId,
      title: document.title,
      contentLength: content?.length || 0,
      currentlyIndexed: document.indexed
    });

    setIndexState(document, 'indexing');
    documentsCache.set(document.id, document);
    if (persistFn) await persistFn(document);

    // O serviço Python substitui os chunks dentro de uma única transação.
    // Nunca apagar a versão atual antes de a nova estar pronta: uma falha de
    // embedding ou persistência deve preservar os chunks anteriores. O pai fica
    // fora do estado `indexed`, portanto retrieval permanece fail-closed até o
    // refresh terminar com sucesso.

    const indexResult = await ragService.indexDocument({ ...document, content }, document.tenantId);
    
    logger.info('[RAGDocuments] Resultado da indexação', {
      documentId: document.id,
      success: indexResult.success,
      chunksCreated: indexResult.chunksCreated,
      error: indexResult.error,
      tenantId: document.tenantId
    });
    
    const chunksCreated = indexResult.chunksCreated || 0;
    if (indexResult.success && chunksCreated > 0) {
      setIndexState(document, 'indexed', { chunksCount: chunksCreated });
      if (persistFn) await persistFn(document);
      
      logger.info('[RAGDocuments] Documento marcado como indexado no BD', {
        documentId: document.id,
        chunksCount: document.chunksCount,
        indexedAt: document.indexedAt
      });
    } else {
      const rawErrMsg = safeToString(indexResult.error || '');
      const derivedCode = rawErrMsg.includes('EMBEDDING_DIM_MISMATCH') ? 'EMBEDDING_DIM_MISMATCH' : 'RAG_INDEX_FAILED';
      // DEDUPLICAÇÃO NÃO É FALHA (missão 2026-09-28): 0 chunks com `isDuplicate` é descarte
      // intencional do rag-service (similaridade > 0.97), não erro de indexação. Registrar como
      // `failed` fazia o operador caçar defeito inexistente e poluía a saúde do índice.
      if (chunksCreated === 0 && indexResult.isDuplicate) {
        setIndexState(document, 'not_indexed_duplicate');
        if (persistFn) await persistFn(document);
        logger.info('[RAGDocuments] Documento não ingerido por DEDUPLICAÇÃO (estado próprio)', {
          documentId: document.id,
          tenantId: document.tenantId,
        });
      } else {
        setIndexState(document, 'failed', {
          errorCode: derivedCode,
          errorMessage: chunksCreated === 0
            ? 'Indexação retornou 0 chunks (não persistido no vector store)'
            : (indexResult.error || 'Falha ao indexar documento'),
        });
        if (persistFn) await persistFn(document);
        logger.error('[RAGDocuments] Falha ao indexar documento', {
          documentId: document.id,
          error: indexResult.error,
          tenantId: document.tenantId
        });
      }
    }

    const finalChunks = indexResult.chunksCreated || 0;
    const finalSuccess = !!indexResult.success && finalChunks > 0;
    return {
      success: finalSuccess,
      chunksCreated: finalChunks,
      errorCode: finalSuccess ? null : (document.indexErrorCode || (safeToString(indexResult.error || '').includes('EMBEDDING_DIM_MISMATCH') ? 'EMBEDDING_DIM_MISMATCH' : 'RAG_INDEX_FAILED')),
      error: finalSuccess ? null : (indexResult.error || 'Indexação retornou 0 chunks'),
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao reindexar documento:', error);
    const safeError = safeErrorMessage(error);
    return {
      success: false,
      chunksCreated: 0,
      errorCode: error?.code
        || (safeToString(safeError).includes('EMBEDDING_DIM_MISMATCH') ? 'EMBEDDING_DIM_MISMATCH' : 'RAG_INDEX_FAILED'),
      error: safeError,
    };
  }
}

/**
 * Reindexa todos os documentos não indexados (ou inconsistentes).
 * 
 * @param {string|null} tenantId - ID do tenant (opcional)
 * @param {boolean} includeInconsistent - Incluir documentos indexados para sincronização
 * @param {Map} documentsCache - Cache de documentos
 * @param {Function} persistFn - Persistência obrigatória do estado do documento
 * @param {Function} reindexDocFn - Função de reindex individual
 * @param {Function} [loadContentfulIdsFn] - Retorna Set de ids com content no DB (cache leve)
 * @returns {Promise<{success: boolean, total: number, indexed: number, failed: number, errors: Array}>}
 */
async function reindexAllNotIndexed(tenantId = null, includeInconsistent = false, documentsCache, persistFn, reindexDocFn, loadContentfulIdsFn = null) {
  try {
    let docs = Array.from(documentsCache.values());
    
    // Filtra por tenant se fornecido
    if (tenantId) {
      docs = docs.filter(doc => doc.tenantId === tenantId);
    }
    
    // Cache leve: docs sem content em memória (undefined) têm a existência de
    // content verificada no DB em uma única query (paridade com o filtro legado)
    let contentfulIds = null;
    if (loadContentfulIdsFn) {
      const unknownContentIds = docs.filter((doc) => doc.content === undefined).map((doc) => doc.id);
      if (unknownContentIds.length > 0) {
        contentfulIds = await loadContentfulIdsFn(unknownContentIds);
      }
    }
    const hasContent = (doc) => {
      if (doc.content !== undefined) return !!doc.content;
      if (contentfulIds) return contentfulIds.has(doc.id);
      return true; // o caller DB-backed decide; o reindex individual valida o conteúdo
    };
    
    // Filtra documentos não indexados
    let notIndexedDocs = docs.filter(doc => !doc.indexed && doc.status === 'active' && hasContent(doc));
    
    // Se includeInconsistent for true, também inclui documentos marcados como indexados
    if (includeInconsistent) {
      const indexedDocs = docs.filter(doc => doc.indexed && doc.status === 'active' && hasContent(doc));
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
    const isAvailable = await ragService.isRagAvailable(tenantId);
    if (!isAvailable) {
      const serviceUrl = ragService.getRagServiceUrl(tenantId);
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
      const serviceUrl = ragService.getRagServiceUrl(tenantId);
      const healthUrlBefore = tenantId 
        ? `${serviceUrl}/rag/health?tenant_id=${encodeURIComponent(tenantId)}`
        : `${serviceUrl}/rag/health`;
      let fetchFn = typeof global.fetch === 'function' ? global.fetch : require('node-fetch');
      const beforeResponse = await fetchFn(healthUrlBefore, { method: 'GET', headers: ragService.getRagInternalHeaders ? ragService.getRagInternalHeaders() : {} });
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
    
    // Reindexa com concorrência limitada (pool de workers simples, sem
    // dependência nova). Cada worker consome o próximo índice disponível;
    // falhas de um doc não interrompem os demais.
    const REINDEX_CONCURRENCY = 4;
    const total = notIndexedDocs.length;
    let nextIndex = 0;

    const reindexWorker = async () => {
      while (nextIndex < total) {
        const i = nextIndex;
        nextIndex += 1;
        const doc = notIndexedDocs[i];
        logger.info(`[RAGDocuments] Processando documento ${i + 1}/${total}`, {
          documentId: doc.id,
          title: doc.title,
          tenantId: doc.tenantId
        });

        try {
          const result = await reindexDocFn(doc.id);
          if (result.success) {
            indexed++;
            logger.info(`[RAGDocuments] Documento ${doc.id} reindexado com sucesso`, {
              documentId: doc.id,
              chunksCreated: result.chunksCreated,
              indexed: indexed,
              total: total
            });
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
            error: safeErrorMessage(error, 'Erro desconhecido'),
          });
          logger.error(`[RAGDocuments] Erro ao reindexar documento ${doc.id}`, {
            documentId: doc.id,
            error: safeErrorMessage(error),
            stack: error.stack,
            indexed: indexed,
            failed: failed
          });
        }
      }
    };

    const workerCount = Math.min(REINDEX_CONCURRENCY, total);
    await Promise.all(Array.from({ length: workerCount }, () => reindexWorker()));
    
    logger.info(`[RAGDocuments] Reindexação em lote concluída: ${indexed} indexados, ${failed} falharam`);
    
    return {
      success: true,
      total: notIndexedDocs.length,
      indexed,
      failed,
      errors,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro geral em reindexAllNotIndexed', error);
    return {
      success: false,
      total: 0,
      indexed: 0,
      failed: 0,
      errors: [{ error: safeErrorMessage(error) }],
    };
  }
}

/**
 * Reindex completo de um tenant (single source of truth = Postgres):
 * 1) marca todos docs como pending
 * 2) reprocessa cada documento com substituição atômica no serviço RAG
 * 
 * @param {string} tenantId - ID do tenant (obrigatório)
 * @param {Map} documentsCache - Cache de documentos
 * @param {Function} persistFn - Função para persistir documento
 * @param {Function} reindexAllFn - Função de reindex em lote
 * @returns {Promise<{success: boolean, total: number, indexed: number, failed: number, errors: Array}>}
 */
async function reindexAllTenant(tenantId, documentsCache, persistFn, reindexAllFn) {
  const finalTenantId = tenantId || null;
  if (!finalTenantId) {
    return { success: false, total: 0, indexed: 0, failed: 0, errors: [{ error: 'tenantId é obrigatório' }] };
  }

  // Marca todos como pending no cache e na persistência autoritativa.
  for (const doc of documentsCache.values()) {
    if (doc.tenantId !== finalTenantId) continue;
    setIndexState(doc, 'pending');
    documentsCache.set(doc.id, doc);
    if (persistFn) await persistFn(doc);
  }

  // Não apaga o corpus antecipadamente. Cada documento é substituído em uma
  // transação própria pelo serviço RAG; assim uma falha preserva a versão
  // anterior em vez de deixar o tenant inteiro sem conhecimento.
  return await reindexAllFn(finalTenantId, true);
}

module.exports = {
  reindexDocument,
  reindexAllNotIndexed,
  reindexAllTenant,
};
