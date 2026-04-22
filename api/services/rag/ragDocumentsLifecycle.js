const ragService = require('../ragService');
const ragDeduplicationService = require('../ragDeduplicationService');
const { setIndexState } = require('./ragDocumentsState');
const { safeErrorMessage } = require('../../utils/defensiveCoercion');
const logger = require('../../utils/logger');

async function buildDocumentForCreate(documentData, tenantId) {
  const now = new Date().toISOString();
  const documentId = documentData.id || `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const sourceId = documentData.metadata?.source_id
    || (documentData.metadata?.fileName ? `file:${documentData.metadata.fileName}` : documentId);
  const currentVersion = ragDeduplicationService.getCurrentSourceVersion(tenantId, sourceId);
  const sourceVersion = documentData.metadata?.source_version || (currentVersion + 1);

  let contentHash = documentData.metadata?.content_hash;
  if (!contentHash && documentData.content) {
    contentHash = await ragDeduplicationService.generateContentHash(documentData.content);
  }

  return {
    id: documentId,
    tenantId,
    title: documentData.title || 'Sem título',
    content: documentData.content || '',
    metadata: {
      ...(documentData.metadata && typeof documentData.metadata === 'object' ? documentData.metadata : {}),
      source: documentData.metadata?.source || 'manual',
      category: documentData.metadata?.category || null,
      productId: documentData.metadata?.productId || null,
      clientId: documentData.metadata?.clientId || null,
      tags: documentData.metadata?.tags || [],
      author: documentData.metadata?.author || null,
      url: documentData.metadata?.url || null,
      fileName: documentData.metadata?.fileName || null,
      fileSize: documentData.metadata?.fileSize || null,
      source_id: sourceId,
      source_version: sourceVersion,
      content_hash: contentHash,
      tenant_id: tenantId,
      createdAt: now,
      updatedAt: now,
      version: sourceVersion,
    },
    permissions: {
      roles: documentData.permissions?.roles || null,
      agents: documentData.permissions?.agents || null,
    },
    status: documentData.status || 'active',
    indexed: false,
    indexedAt: null,
    chunksCount: 0,
    indexStatus: 'pending',
    indexErrorCode: null,
    indexErrorMessage: null,
    lastIndexAttemptAt: null,
    inconsistent: false,
    inconsistentReason: null,
  };
}

async function autoIndexDocument(document, persistDocumentBestEffort) {
  try {
    logger.info('[RAGDocuments] Indexando documento automaticamente', {
      documentId: document.id,
      tenantId: document.tenantId,
      title: document.title,
      contentLength: document.content?.length || 0,
      url: document.metadata?.url,
      fileName: document.metadata?.fileName,
      sourceId: document.metadata?.source_id,
      sourceVersion: document.metadata?.source_version,
      contentHash: document.metadata?.content_hash ? `${document.metadata.content_hash.substring(0, 16)}...` : null,
    });

    setIndexState(document, 'indexing');
    persistDocumentBestEffort(document);

    const indexResult = await ragService.indexDocument(document, document.tenantId);
    const chunksCreated = indexResult.chunksCreated || 0;

    if (indexResult.success && chunksCreated > 0) {
      setIndexState(document, 'indexed', { chunksCount: chunksCreated });
      persistDocumentBestEffort(document);

      logger.info('[RAGDocuments] Documento indexado com sucesso', {
        documentId: document.id,
        tenantId: document.tenantId,
        chunksCreated,
        isDuplicate: indexResult.isDuplicate || false,
        sourceId: document.metadata?.source_id,
        sourceVersion: document.metadata?.source_version,
      });
      return;
    }

    setIndexState(document, 'failed', {
      errorCode: 'RAG_INDEX_FAILED',
      errorMessage: chunksCreated === 0
        ? (indexResult.isDuplicate
          ? 'Indexação retornou 0 chunks (duplicado/sem ingestão)'
          : 'Indexação retornou 0 chunks (não persistido no vector store)')
        : (indexResult.error || 'Indexação retornou success=false'),
    });
    persistDocumentBestEffort(document);

    logger.warn('[RAGDocuments] Indexação retornou success=false', {
      documentId: document.id,
      tenantId: document.tenantId,
      error: indexResult.error,
      isDuplicate: indexResult.isDuplicate || false,
      chunksCreated,
    });
  } catch (indexError) {
    setIndexState(document, 'failed', {
      errorCode: 'RAG_INDEX_FAILED',
      errorMessage: indexError.message,
    });
    persistDocumentBestEffort(document);

    logger.error('[RAGDocuments] Erro ao indexar documento automaticamente', {
      error: safeErrorMessage(indexError),
      stack: indexError.stack,
      documentId: document.id,
      tenantId: document.tenantId,
      title: document.title,
      contentLength: document.content?.length || 0,
    });
  }
}

function buildCreateIndexingResponse(document, autoIndexEnabled) {
  if (!autoIndexEnabled) {
    return { attempted: false, success: null, errorCode: null, errorMessage: null };
  }

  const success = document.indexStatus === 'indexed' && (document.chunksCount || 0) > 0;
  return {
    attempted: true,
    success,
    errorCode: success ? null : (document.indexErrorCode || 'RAG_INDEX_FAILED'),
    errorMessage: success ? null : (document.indexErrorMessage || 'Falha ao indexar'),
  };
}

function applyDocumentUpdates(document, updates) {
  if (updates.title !== undefined) document.title = updates.title;
  if (updates.content !== undefined) document.content = updates.content;
  if (updates.status !== undefined) document.status = updates.status;

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

  if (updates.content !== undefined) {
    document.metadata.version = (document.metadata.version || 1) + 1;
  }

  document.metadata.updatedAt = new Date().toISOString();
}

async function reindexUpdatedDocument(document, persistDocumentBestEffort) {
  try {
    setIndexState(document, 'indexing');
    persistDocumentBestEffort(document);

    const indexResult = await ragService.indexDocument(document, document.tenantId);
    const chunksCreated = indexResult.chunksCreated || 0;

    if (indexResult.success && chunksCreated > 0) {
      setIndexState(document, 'indexed', { chunksCount: chunksCreated });
      persistDocumentBestEffort(document);
      return;
    }

    setIndexState(document, 'failed', {
      errorCode: 'RAG_INDEX_FAILED',
      errorMessage: chunksCreated === 0
        ? 'Indexação retornou 0 chunks (não persistido no vector store)'
        : (indexResult.error || 'Indexação retornou success=false'),
    });
    persistDocumentBestEffort(document);
  } catch (indexError) {
    setIndexState(document, 'failed', {
      errorCode: 'RAG_INDEX_FAILED',
      errorMessage: safeErrorMessage(indexError),
    });
    persistDocumentBestEffort(document);
    logger.warn('[RAGDocuments] Erro ao reindexar documento:', safeErrorMessage(indexError));
  }
}

module.exports = {
  buildDocumentForCreate,
  autoIndexDocument,
  buildCreateIndexingResponse,
  applyDocumentUpdates,
  reindexUpdatedDocument,
};
