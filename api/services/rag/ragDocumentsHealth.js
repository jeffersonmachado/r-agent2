const logger = require('../../utils/logger');
const { safeErrorMessage } = require('../../utils/defensiveCoercion');
const { setIndexState } = require('./ragDocumentsState');

const postgresVectorStore = require('../vectorStore/postgresVectorStore');
const ragService = require('../ragService');

async function getRagHealth(tenantId, options = {}, documentsCache, persistFn, markInconsistentFn, markConsistentFn) {
  const finalTenantId = tenantId || null;
  if (!finalTenantId) {
    return { ok: false, error: { code: 'TENANT_REQUIRED', message: 'tenantId é obrigatório' } };
  }

  try {
    const docs = Array.from(documentsCache.values()).filter((document) => document.tenantId === finalTenantId);
    const total = docs.length;
    const indexed = docs.filter((document) => document.indexStatus === 'indexed').length;
    const failed = docs.filter((document) => document.indexStatus === 'failed').length;

    const vectorCounts = await postgresVectorStore.countVectorDocs({ tenantId: finalTenantId });
    const chunksByDoc = await postgresVectorStore.countChunksByDocument({ tenantId: finalTenantId });

    const warnings = [];
    const inconsistentDocIds = docs
      .filter((document) => document.indexStatus === 'indexed' && (Number(chunksByDoc[document.id] || 0) === 0))
      .map((document) => document.id);

    if (inconsistentDocIds.length > 0) {
      const reason = `Documento marcado como indexed mas chunks=0 no Postgres (${inconsistentDocIds.length} doc(s))`;
      warnings.push({
        code: 'RAG_INCONSISTENT_INDEXED_WITHOUT_CHUNKS',
        message: reason,
        details: { tenantId: finalTenantId, documentIds: inconsistentDocIds },
      });

      for (const documentId of inconsistentDocIds) {
        const document = documentsCache.get(documentId);
        if (!document) continue;
        setIndexState(document, 'failed', {
          errorCode: 'RAG_INCONSISTENT',
          errorMessage: 'Marcado como indexed, mas não há chunks gravados no Postgres (pgvector)',
        });
        documentsCache.set(documentId, document);
        await persistFn(document);
      }
      await markInconsistentFn(finalTenantId, reason, inconsistentDocIds);
    } else {
      await markConsistentFn(finalTenantId);
    }

    // Direção inversa (auto-reparo): documento com index_status != 'indexed' mas
    // que já possui chunks vetorizados no pgvector fica invisível para retrieval,
    // pois a busca vetorial exige index_status='indexed' (cláusula EXISTS em
    // vector_store.search). Corrige o estado para 'indexed' com base nos chunks
    // realmente vetorizados (embedding não-nulo).
    const embeddedChunksByDoc = await postgresVectorStore.countChunksWithEmbeddingByDocument({ tenantId: finalTenantId });
    const staleNotIndexedDocIds = docs
      .filter((document) => document.indexStatus !== 'indexed' && Number(embeddedChunksByDoc[document.id] || 0) > 0)
      .map((document) => document.id);

    if (staleNotIndexedDocIds.length > 0) {
      const reason = `Documento com chunks vetorizados mas index_status != indexed (${staleNotIndexedDocIds.length} doc(s)); corrigido para indexed`;
      warnings.push({
        code: 'RAG_STALE_INDEX_STATUS_WITH_CHUNKS',
        message: reason,
        details: { tenantId: finalTenantId, documentIds: staleNotIndexedDocIds },
      });

      for (const documentId of staleNotIndexedDocIds) {
        const document = documentsCache.get(documentId);
        if (!document) continue;
        setIndexState(document, 'indexed', { chunksCount: Number(embeddedChunksByDoc[documentId] || 1) });
        documentsCache.set(documentId, document);
        await persistFn(document);
      }
    }

    if ((vectorCounts.documents || 0) > total) {
      warnings.push({
        code: 'RAG_VECTOR_AHEAD',
        message: 'Vector store contém documentos/chunks além do que existe em rag_documents',
        details: { tenantId: finalTenantId, vectorDocuments: vectorCounts.documents, dbDocuments: total },
      });
    }

    return {
      ok: true,
      tenantId: finalTenantId,
      docs: { total, indexed, failed },
      chunks: { total: vectorCounts.chunks || 0 },
      warnings,
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'RAG_HEALTH_FAILED',
        message: 'Falha ao calcular health do RAG',
        details: { tenantId: finalTenantId, message: safeErrorMessage(error) },
      },
    };
  }
}

async function cleanOrphanedDocuments(tenantId = null, orphanedDocumentIds = []) {
  try {
    logger.info('[RAGDocuments] Iniciando limpeza de documentos órfãos', {
      tenantId,
      orphanedDocumentIdsCount: orphanedDocumentIds.length,
    });

    if (!orphanedDocumentIds || orphanedDocumentIds.length === 0) {
      logger.warn('[RAGDocuments] Nenhum documento órfão fornecido para remover', { tenantId });
      return {
        success: false,
        removedDocuments: 0,
        removedChunks: 0,
        orphanedDocuments: [],
        error: 'Nenhum documento órfão fornecido',
      };
    }

    const result = await ragService.cleanOrphanedDocuments(tenantId, orphanedDocumentIds);

    logger.info('[RAGDocuments] Limpeza de documentos órfãos concluída', {
      tenantId,
      success: result.success,
      removedDocuments: result.removedDocuments,
      removedChunks: result.removedChunks,
    });

    return result;
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao limpar documentos órfãos', {
      error: safeErrorMessage(error),
      tenantId,
    });
    throw error;
  }
}

module.exports = {
  getRagHealth,
  cleanOrphanedDocuments,
};
