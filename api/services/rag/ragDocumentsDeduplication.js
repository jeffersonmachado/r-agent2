const logger = require('../../utils/logger');
const { safeErrorMessage, safeTrimLower } = require('../../utils/defensiveCoercion');

/**
 * Encontra um documento por URL (para evitar duplicação).
 */
function findDocumentByUrl(url, tenantId, documentsCache) {
  if (!url) return null;

  const normalizedUrl = safeTrimLower(url);
  if (!normalizedUrl) return null;

  for (const doc of documentsCache.values()) {
    if (tenantId && doc.tenantId !== tenantId) continue;

    const docUrl = doc.metadata?.url;
    if (docUrl && safeTrimLower(docUrl) === normalizedUrl) {
      return doc;
    }
  }

  return null;
}

/**
 * Encontra um documento por nome de arquivo (para evitar duplicação de uploads).
 */
function findDocumentByFileName(fileName, tenantId, documentsCache, fileSize = null) {
  if (!fileName) return null;

  const normalizedFileName = safeTrimLower(fileName);
  if (!normalizedFileName) return null;

  for (const doc of documentsCache.values()) {
    if (tenantId && doc.tenantId !== tenantId) continue;

    const docFileName = doc.metadata?.fileName;
    if (docFileName && safeTrimLower(docFileName) === normalizedFileName) {
      if (fileSize !== null && doc.metadata?.fileSize) {
        if (doc.metadata.fileSize === fileSize) {
          return doc;
        }
        continue;
      }
      return doc;
    }
  }

  return null;
}

async function ensureContentHash(document, generateContentHash, documentsCache, persistFn, loadContentFn = null) {
  if (document.metadata?.content_hash) return;

  // Cache leve: content pode não estar em memória; busca pontual no DB
  let content = document.content;
  if (content === undefined && loadContentFn) {
    content = await loadContentFn(document.id);
  }
  if (!content) return;

  const contentHash = await generateContentHash(content);
  document.metadata = {
    ...document.metadata,
    content_hash: contentHash,
  };
  documentsCache.set(document.id, document);
  await persistFn(document);
}

async function maybeReindexDuplicate(documentData, existingDoc, finalTenantId, documentsCache, persistFn, generateContentHash, reindexDocumentFn, loadContentFn = null) {
  if (documentData.autoIndex === false || existingDoc.indexed) {
    return;
  }

  logger.info('[RAGDocuments] Documento duplicado nao esta indexado, indexando agora...', {
    documentId: existingDoc.id,
    tenantId: finalTenantId,
  });

  try {
    await ensureContentHash(existingDoc, generateContentHash, documentsCache, persistFn, loadContentFn);
    await reindexDocumentFn(existingDoc.id);
  } catch (indexError) {
    logger.error('[RAGDocuments] Erro ao indexar documento duplicado', {
      error: safeErrorMessage(indexError),
      stack: indexError?.stack,
      documentId: existingDoc.id,
      tenantId: finalTenantId,
    });
  }
}

/**
 * Verifica duplicidade por URL/arquivo e devolve resposta de duplicata quando aplicável.
 */
async function handleDuplicateDocument({
  documentData,
  finalTenantId,
  documentsCache,
  persistFn,
  generateContentHash,
  reindexDocumentFn,
  loadContentFn = null,
}) {
  if (!documentData?.metadata) return null;

  if (documentData.metadata.url) {
    const existingDoc = findDocumentByUrl(documentData.metadata.url, finalTenantId, documentsCache);
    if (existingDoc) {
      logger.info('[RAGDocuments] Documento duplicado encontrado (mesma URL)', {
        url: documentData.metadata.url,
        existingDocumentId: existingDoc.id,
        existingTitle: existingDoc.title,
        tenantId: finalTenantId,
        indexed: existingDoc.indexed || false,
      });

      await maybeReindexDuplicate(
        documentData,
        existingDoc,
        finalTenantId,
        documentsCache,
        persistFn,
        generateContentHash,
        reindexDocumentFn,
        loadContentFn
      );

      return {
        success: true,
        document: existingDoc,
        isDuplicate: true,
        existingDocument: existingDoc,
      };
    }
  }

  if (documentData.metadata.fileName) {
    const existingDoc = findDocumentByFileName(
      documentData.metadata.fileName,
      finalTenantId,
      documentsCache,
      documentData.metadata.fileSize
    );

    if (existingDoc) {
      logger.info('[RAGDocuments] Documento duplicado encontrado (mesmo arquivo)', {
        fileName: documentData.metadata.fileName,
        fileSize: documentData.metadata.fileSize,
        existingDocumentId: existingDoc.id,
        existingTitle: existingDoc.title,
        tenantId: finalTenantId,
        indexed: existingDoc.indexed || false,
      });

      await maybeReindexDuplicate(
        documentData,
        existingDoc,
        finalTenantId,
        documentsCache,
        persistFn,
        generateContentHash,
        reindexDocumentFn,
        loadContentFn
      );

      return {
        success: true,
        document: existingDoc,
        isDuplicate: true,
        existingDocument: existingDoc,
      };
    }
  }

  return null;
}

module.exports = {
  findDocumentByUrl,
  findDocumentByFileName,
  handleDuplicateDocument,
};
