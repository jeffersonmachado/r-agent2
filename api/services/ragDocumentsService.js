/**
 * Serviço de gerenciamento de documentos RAG.
 * 
 * Responsabilidades:
 * - CRUD de documentos
 * - Persistência em PostgreSQL
 * - Integração com ragService para indexação
 * 
 * NOTA: Arquivos JSON removidos - todos os dados agora estão no banco de dados PostgreSQL
 */

const logger = require('../utils/logger');
const config = require('../utils/config');
const ragDeduplicationService = require('./ragDeduplicationService');
const ragService = require('./ragService');
const { getSequelize } = require('../db/sequelize');
const { RagDocument: RagDocumentGetter, RagDocumentFile: RagDocumentFileGetter } = require('../db/models');
const postgresVectorStore = require('./vectorStore/postgresVectorStore');
const { toDbPayload, fromDbRow, setIndexState } = require('./rag/ragDocumentsState');
const ragDocumentsIndexing = require('./rag/ragDocumentsIndexing');
const ragDocumentsDeduplication = require('./rag/ragDocumentsDeduplication');
const ragDocumentsHealth = require('./rag/ragDocumentsHealth');
const ragDocumentsStats = require('./rag/ragDocumentsStats');
const ragDocumentsLifecycle = require('./rag/ragDocumentsLifecycle');
const {
  safeToString,
  safeTrim,
  safeTrimLower,
  safeErrorMessage,
} = require('../utils/defensiveCoercion');

// Cache em memória
let documents = new Map();

// Funções deprecated removidas - dados agora estão no banco de dados PostgreSQL
// Dados são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo

function dbAvailable() {
  return !!getSequelize();
}

async function getDbIndexedCount(tenantId) {
  if (!dbAvailable()) return 0;
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  return await RagDocumentModel.count({
    where: { tenant_key: tenantId || null, index_status: 'indexed' },
  });
}

async function markInconsistentDocuments(tenantId, reason, docIds = []) {
  if (!dbAvailable()) return;
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const where = docIds.length
    ? { tenant_key: tenantId || null, id: docIds }
    : { tenant_key: tenantId || null, index_status: 'indexed' };
  await RagDocumentModel.update(
    { inconsistent: true, inconsistent_reason: reason, updated_at: new Date() },
    { where }
  );
}

async function markConsistentForTenant(tenantId) {
  if (!dbAvailable()) return;
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  await RagDocumentModel.update(
    { inconsistent: false, inconsistent_reason: null, updated_at: new Date() },
    { where: { tenant_key: tenantId || null } }
  );
}

async function getDbDocumentIdsForTenant(tenantId) {
  if (!dbAvailable()) return [];
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const rows = await RagDocumentModel.findAll({
    attributes: ['id'],
    where: { tenant_key: tenantId || null },
  });
  return rows.map((r) => (r?.id ? safeToString(r.id, null) : null)).filter(Boolean);
}

/**
 * Detecta e remove documentos órfãos do vector store (vector_ahead).
 *
 * @param {string} tenantId
 * @returns {Promise<{success: boolean, tenantId: string, orphanedDocumentIds: string[], removedDocuments: number, removedChunks: number, error?: string}>}
 */
async function detectAndCleanOrphanedVectorDocuments(tenantId) {
  const finalTenantId = tenantId || null;
  if (!finalTenantId) {
    return { success: false, tenantId: finalTenantId, orphanedDocumentIds: [], removedDocuments: 0, removedChunks: 0, error: 'tenantId é obrigatório' };
  }

  // Fonte única: Postgres (rag_chunks).
  // Orphans = chunks que apontam para document_id inexistente em rag_documents.
  const orphaned = await postgresVectorStore.listOrphanedDocumentIdsForTenant(finalTenantId, 50000);
  if (orphaned.length === 0) {
    return { success: true, tenantId: finalTenantId, orphanedDocumentIds: [], removedDocuments: 0, removedChunks: 0 };
  }

  const sequelize = getSequelize();
  let removedChunks = 0;
  if (sequelize) {
    const [[row]] = await sequelize.query(
      `SELECT COUNT(*)::int AS chunks FROM rag_chunks WHERE tenant_key = :tenantKey AND document_id = ANY(:docIds)`,
      { replacements: { tenantKey: finalTenantId, docIds: orphaned } }
    );
    removedChunks = Number(row?.chunks || 0);
  }

  await postgresVectorStore.deleteOrphanedChunksForTenant(finalTenantId);

  return {
    success: true,
    tenantId: finalTenantId,
    orphanedDocumentIds: orphaned,
    removedDocuments: orphaned.length,
    removedChunks,
  };
}

async function upsertDocumentToDb(doc) {
  if (!dbAvailable()) return;
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const payload = toDbPayload(doc);
  const now = new Date();

  const existing = await RagDocumentModel.findByPk(doc.id);
  if (existing) {
    await existing.update({ ...payload, updated_at: now });
  } else {
    await RagDocumentModel.create({ ...payload, created_at: now, updated_at: now });
  }
}

async function deleteDocumentFromDb(id) {
  if (!dbAvailable()) return;
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  await RagDocumentModel.destroy({ where: { id } });
}

async function upsertDocumentFileToDb({ documentId, tenantId, filename, mimeType, sizeBytes, data }) {
  if (!dbAvailable()) return;
  const RagDocumentFileModel = typeof RagDocumentFileGetter === 'function' ? RagDocumentFileGetter() : RagDocumentFileGetter;
  const now = new Date();
  const safeDocumentId = safeToString(documentId);
  const payload = {
    document_id: safeDocumentId,
    tenant_key: tenantId || null,
    filename: filename || null,
    mime_type: mimeType || null,
    size_bytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    data,
    updated_at: now,
  };
  const existing = await RagDocumentFileModel.findByPk(safeDocumentId);
  if (existing) {
    await existing.update(payload);
  } else {
    await RagDocumentFileModel.create({ ...payload, created_at: now });
  }
}

async function getDocumentFileFromDb(documentId, tenantId) {
  if (!dbAvailable()) return null;
  const RagDocumentFileModel = typeof RagDocumentFileGetter === 'function' ? RagDocumentFileGetter() : RagDocumentFileGetter;
  const safeDocumentId = safeToString(documentId);
  const row = await RagDocumentFileModel.findOne({
    where: { document_id: safeDocumentId, tenant_key: tenantId || null },
  });
  if (!row) return null;
  const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
  return {
    documentId: base.document_id,
    tenantId: base.tenant_key || null,
    filename: base.filename || null,
    mimeType: base.mime_type || null,
    sizeBytes: Number.isFinite(base.size_bytes) ? base.size_bytes : null,
    data: base.data, // Buffer
  };
}

async function deleteDocumentFileFromDb(documentId, tenantId) {
  if (!dbAvailable()) return;
  const RagDocumentFileModel = typeof RagDocumentFileGetter === 'function' ? RagDocumentFileGetter() : RagDocumentFileGetter;
  await RagDocumentFileModel.destroy({
    where: { document_id: safeToString(documentId), tenant_key: tenantId || null },
  });
}

function persistDocumentBestEffort(doc) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    upsertDocumentToDb(doc).catch((err) => {
      logger.warn('[RAGDocuments] Falha ao persistir documento no PostgreSQL', { documentId: doc.id, error: safeErrorMessage(err) });
    });
  });
}

function deleteDocumentBestEffort(id) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteDocumentFromDb(id).catch((err) => {
      logger.warn('[RAGDocuments] Falha ao remover documento no PostgreSQL', { documentId: id, error: safeErrorMessage(err) });
    });
  });
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 */
async function initialize() {
  if (!dbAvailable()) return;
  try {
    const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
    const rows = await RagDocumentModel.findAll();
    documents = new Map();
    for (const row of rows) {
      const doc = fromDbRow(row);
      documents.set(doc.id, doc);
    }
    logger.info('[RAGDocuments] Cache inicializado do PostgreSQL', { count: documents.size });
  } catch (err) {
    logger.warn('[RAGDocuments] Falha ao inicializar cache do PostgreSQL', { error: safeErrorMessage(err) });
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

  if (filters.search != null) {
    const searchLower = safeTrimLower(filters.search);
    if (searchLower) {
      result = result.filter(doc => {
        const titleLower = safeTrimLower(doc.title);
        const contentLower = safeTrimLower(doc.content);
        return titleLower.includes(searchLower) || contentLower.includes(searchLower);
      });
    }
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
 * Encontra um documento por URL (para evitar duplicação).
 * 
 * @param {string} url - URL do documento
 * @param {string} tenantId - ID do tenant
 * @returns {Object|null} Documento existente ou null
 */
function findDocumentByUrl(url, tenantId) {
  return ragDocumentsDeduplication.findDocumentByUrl(url, tenantId, documents);
}

/**
 * Encontra um documento por nome de arquivo (para evitar duplicação de uploads).
 * 
 * @param {string} fileName - Nome do arquivo
 * @param {string} tenantId - ID do tenant
 * @param {number} fileSize - Tamanho do arquivo em bytes (opcional, para verificação adicional)
 * @returns {Object|null} Documento existente ou null
 */
function findDocumentByFileName(fileName, tenantId, fileSize = null) {
  return ragDocumentsDeduplication.findDocumentByFileName(fileName, tenantId, documents, fileSize);
}

/**
 * Cria um novo documento.
 * 
 * @param {Object} documentData - Dados do documento
 * @param {string} tenantId - ID do tenant
 * @param {Object} options - Opções (skipDuplicateCheck: boolean)
 * @returns {Promise<{success: boolean, document: Object, error?: string, isDuplicate?: boolean, existingDocument?: Object}>}
 */
async function createDocument(documentData, tenantId, options = {}) {
  try {
    const finalTenantId = tenantId || documentData.tenantId || null;
    
    // Verifica duplicação se não foi desabilitado
    if (!options.skipDuplicateCheck) {
      const duplicateResult = await ragDocumentsDeduplication.handleDuplicateDocument({
        documentData,
        finalTenantId,
        documentsCache: documents,
        persistFn: persistDocumentBestEffort,
        generateContentHash: ragDeduplicationService.generateContentHash,
        reindexDocumentFn: reindexDocument,
      });
      if (duplicateResult) {
        return duplicateResult;
      }
    }
    
    const document = await ragDocumentsLifecycle.buildDocumentForCreate(documentData, finalTenantId);

    documents.set(document.id, document);
    persistDocumentBestEffort(document);

    // Indexa automaticamente se solicitado
    if (documentData.autoIndex !== false) {
      await ragDocumentsLifecycle.autoIndexDocument(document, persistDocumentBestEffort);
      documents.set(document.id, document);
    } else {
      logger.debug('[RAGDocuments] Auto-indexação desabilitada para documento', {
        documentId: document.id,
        tenantId: document.tenantId,
        autoIndex: documentData.autoIndex
      });
    }

    const indexing = ragDocumentsLifecycle.buildCreateIndexingResponse(document, documentData.autoIndex !== false);

    return {
      success: true,
      document,
      indexing,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao criar documento:', error);
    return {
      success: false,
      document: null,
      error: safeErrorMessage(error),
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

    ragDocumentsLifecycle.applyDocumentUpdates(document, updates);
    documents.set(documentId, document);
    persistDocumentBestEffort(document);

    // Reindexa se solicitado e conteúdo mudou
    if (updates.reindex && updates.content !== undefined) {
      await ragDocumentsLifecycle.reindexUpdatedDocument(document, persistDocumentBestEffort);
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
      error: safeErrorMessage(error),
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
    const safeDocumentId = safeToString(documentId);
    let document = documents.get(documentId);
    if (!document && safeDocumentId) {
      document = documents.get(safeDocumentId);
    }
    let tenantId = document?.tenantId || null;

    // DELETE deve ser idempotente: se o documento já não existir, não deve falhar.
    // Além disso, em cenários raros onde o cache em memória não tem o doc mas o DB tem,
    // garantimos remoção do DB + cleanup best-effort do vector store e binário.
    if (!document) {
      if (dbAvailable()) {
        const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
        const row = await RagDocumentModel.findByPk(safeDocumentId);
        if (row) {
          const dbDoc = fromDbRow(row);
          tenantId = dbDoc?.tenantId || null;
          // Remove do banco imediatamente (idempotente)
          await deleteDocumentFromDb(safeDocumentId);
        } else {
          return { success: true, alreadyDeleted: true };
        }
      } else {
        return { success: true, alreadyDeleted: true };
      }
    } else {
      documents.delete(documentId);
      if (safeDocumentId && safeDocumentId !== documentId) {
        documents.delete(safeDocumentId);
      }
      deleteDocumentBestEffort(documentId);
    }

    // Best-effort: remove também do vector store (Postgres) para evitar órfãos.
    try {
      if (tenantId) {
        await postgresVectorStore.deleteDocumentVectors({ tenantId, documentId: safeDocumentId });
      }
    } catch (e) {
      logger.warn('[RAGDocuments] Falha ao remover documento do vector store (best-effort)', {
        documentId,
        tenantId: tenantId || null,
        error: e.message,
      });
      // Não falha o delete do BD/cache se o vector store falhar
    }

    // Best-effort: remove binário do documento (se existir)
    try {
      await deleteDocumentFileFromDb(safeDocumentId, tenantId || null);
    } catch (e) {
      logger.warn('[RAGDocuments] Falha ao remover binário do documento (best-effort)', {
        documentId,
        tenantId: tenantId || null,
        error: e.message,
      });
    }

    return {
      success: true,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao deletar documento:', error);
    return {
      success: false,
      error: safeErrorMessage(error),
    };
  }
}

/**
 * Reindexa um documento (delegado para ragDocumentsIndexing).
 * 
 * @param {string} documentId - ID do documento
 * @returns {Promise<{success: boolean, chunksCreated: number, error?: string}>}
 */
async function reindexDocument(documentId) {
  return await ragDocumentsIndexing.reindexDocument(documentId, documents, persistDocumentBestEffort);
}

/**
 * Reindexa todos os documentos não indexados ou inconsistentes (delegado para ragDocumentsIndexing).
 * 
 * @param {string} tenantId - ID do tenant (opcional)
 * @param {boolean} includeInconsistent - Incluir documentos já marcados como indexed
 * @returns {Promise<{success: boolean, total: number, indexed: number, failed: number, errors: Array}>}
 */
async function reindexAllNotIndexed(tenantId = null, includeInconsistent = false) {
  return await ragDocumentsIndexing.reindexAllNotIndexed(
    tenantId,
    includeInconsistent,
    documents,
    persistDocumentBestEffort,
    reindexDocument
  );
}

/**
 * Reindex completo de um tenant (single source of truth = Postgres).
 * 1) marca todos docs como pending
 * 2) apaga todos os rag_chunks do tenant
 * 3) reprocessa indexação
 */
async function reindexAllTenant(tenantId) {
  return await ragDocumentsIndexing.reindexAllTenant(
    tenantId,
    documents,
    persistDocumentBestEffort,
    reindexAllNotIndexed
  );
}

/**
 * Obtém estatísticas de documentos.
 * 
 * @param {string} tenantId - ID do tenant (opcional)
 * @returns {Object} Estatísticas
 */
async function getDocumentsStats(tenantId = null) {
  return await ragDocumentsStats.getDocumentsStats(tenantId, documents);
}

/**
 * Health do RAG (Node) usando Postgres como fonte única.
 *
 * @param {string} tenantId
 * @param {{ autoRepair?: boolean }} options
 * @returns {Promise<{ok: boolean, tenantId?: string, docs?: any, chunks?: any, warnings?: any[], error?: any}>}
 */
async function getRagHealth(tenantId, options = {}) {
  return await ragDocumentsHealth.getRagHealth(
    tenantId,
    options,
    documents,
    persistDocumentBestEffort,
    markInconsistentDocuments,
    markConsistentForTenant
  );
}

// Dados são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo

/**
 * Limpa documentos órfãos do vector store (documentos que estão no vector store mas não no BD).
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string[]} orphanedDocumentIds - Lista de IDs de documentos órfãos para remover
 * @returns {Promise<{success: boolean, removedDocuments: number, removedChunks: number, orphanedDocuments: string[]}>}
 */
async function cleanOrphanedDocuments(tenantId = null, orphanedDocumentIds = []) {
  return await ragDocumentsHealth.cleanOrphanedDocuments(tenantId, orphanedDocumentIds);
}

module.exports = {
  initialize,
  listDocuments,
  getDocument,
  findDocumentByUrl,
  findDocumentByFileName,
  createDocument,
  updateDocument,
  deleteDocument,
  upsertDocumentFileToDb,
  getDocumentFileFromDb,
  reindexDocument,
  reindexAllNotIndexed,
  reindexAllTenant,
  getDocumentsStats,
  cleanOrphanedDocuments,
  getRagHealth,
  detectAndCleanOrphanedVectorDocuments,
};

