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
const ragResponseCache = require('./rag/ragResponseCache');
const {
  safeToString,
  safeTrim,
  safeTrimLower,
  safeErrorMessage,
} = require('../utils/defensiveCoercion');

// Cache leve de leitura. PostgreSQL continua sendo a fonte autoritativa e
// toda operação pública recarrega/valida o tenant antes de usar este mapa.
let documents = new Map();

// Funções deprecated removidas - dados agora estão no banco de dados PostgreSQL
// Dados são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo

function dbAvailable() {
  try {
    return !!getSequelize();
  } catch (_) {
    return false;
  }
}

function makePersistenceRequired(cause = null) {
  const error = new Error('persistence_required');
  error.code = 'PERSISTENCE_REQUIRED';
  if (cause) error.cause = cause;
  return error;
}

function requireDbAvailable() {
  if (!dbAvailable()) throw makePersistenceRequired();
}

function requireTenantScope(tenantId) {
  const scopedTenantId = safeTrim(tenantId);
  if (!scopedTenantId) {
    const error = new Error('tenant_required');
    error.code = 'TENANT_REQUIRED';
    throw error;
  }
  return scopedTenantId;
}

async function runPersistence(operation) {
  requireDbAvailable();
  try {
    return await operation();
  } catch (error) {
    if (error?.code === 'PERSISTENCE_REQUIRED' || error?.code === 'document_tenant_conflict') throw error;
    throw makePersistenceRequired(error);
  }
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
  requireDbAvailable();
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const payload = toDbPayload(doc);
  const now = new Date();

  const existing = await RagDocumentModel.findByPk(doc.id);
  if (existing) {
    const existingTenantId = existing.tenant_key || existing.dataValues?.tenant_key || null;
    if (existingTenantId && payload.tenant_key && existingTenantId !== payload.tenant_key) {
      const ownershipError = new Error('document_id pertence a outro tenant');
      ownershipError.code = 'document_tenant_conflict';
      throw ownershipError;
    }
    await existing.update({ ...payload, updated_at: now });
    return;
  }
  try {
    await RagDocumentModel.create({ ...payload, created_at: now, updated_at: now });
  } catch (error) {
    const isUnique = error?.name === 'SequelizeUniqueConstraintError'
      || error?.original?.code === '23505'
      || error?.parent?.code === '23505';
    if (!isUnique) throw error;
    // Corrida de idempotência: insert concorrente do mesmo id. Re-fetch + update.
    const raced = await RagDocumentModel.findByPk(doc.id);
    if (raced) {
      const racedTenantId = raced.tenant_key || raced.dataValues?.tenant_key || null;
      if (racedTenantId && payload.tenant_key && racedTenantId !== payload.tenant_key) {
        const ownershipError = new Error('document_id pertence a outro tenant');
        ownershipError.code = 'document_tenant_conflict';
        throw ownershipError;
      }
      await raced.update({ ...payload, updated_at: now });
      return;
    }
    throw makePersistenceRequired(error);
  }
}

async function deleteDocumentFromDb(id, tenantId = null) {
  requireDbAvailable();
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const where = tenantId ? { id, tenant_key: tenantId } : { id };
  await RagDocumentModel.destroy({ where });
}

async function upsertDocumentFileToDb({ documentId, tenantId, filename, mimeType, sizeBytes, data }) {
  requireDbAvailable();
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
  const existing = await runPersistence(() => RagDocumentFileModel.findByPk(safeDocumentId));
  if (existing) {
    const existingTenantId = existing.tenant_key || existing.dataValues?.tenant_key || null;
    if (String(existingTenantId || '') !== String(payload.tenant_key || '')) {
      const ownershipError = new Error('document_file pertence a outro tenant');
      ownershipError.code = 'document_tenant_conflict';
      throw ownershipError;
    }
    await runPersistence(() => existing.update(payload));
    return;
  }
  try {
    await RagDocumentFileModel.create({ ...payload, created_at: now });
  } catch (error) {
    const isUnique = error?.name === 'SequelizeUniqueConstraintError'
      || error?.original?.code === '23505'
      || error?.parent?.code === '23505';
    if (!isUnique) throw makePersistenceRequired(error);
    const raced = await runPersistence(() => RagDocumentFileModel.findByPk(safeDocumentId));
    if (raced) {
      const racedTenantId = raced.tenant_key || raced.dataValues?.tenant_key || null;
      if (String(racedTenantId || '') !== String(payload.tenant_key || '')) {
        const ownershipError = new Error('document_file pertence a outro tenant');
        ownershipError.code = 'document_tenant_conflict';
        throw ownershipError;
      }
      await runPersistence(() => raced.update(payload));
      return;
    }
    throw makePersistenceRequired(error);
  }
}

async function getDocumentFileFromDb(documentId, tenantId) {
  requireDbAvailable();
  const RagDocumentFileModel = typeof RagDocumentFileGetter === 'function' ? RagDocumentFileGetter() : RagDocumentFileGetter;
  const safeDocumentId = safeToString(documentId);
  const row = await runPersistence(() => RagDocumentFileModel.findOne({
    where: { document_id: safeDocumentId, tenant_key: tenantId || null },
  }));
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
  requireDbAvailable();
  const RagDocumentFileModel = typeof RagDocumentFileGetter === 'function' ? RagDocumentFileGetter() : RagDocumentFileGetter;
  await runPersistence(() => RagDocumentFileModel.destroy({
    where: { document_id: safeToString(documentId), tenant_key: tenantId || null },
  }));
}

async function persistDocumentRequired(doc) {
  try {
    await upsertDocumentToDb(doc);
  } catch (error) {
    if (error?.code === 'document_tenant_conflict') throw error;
    throw error?.code === 'PERSISTENCE_REQUIRED' ? error : makePersistenceRequired(error);
  }
}

async function deleteDocumentRequired(id, tenantId = null) {
  try {
    await deleteDocumentFromDb(id, tenantId);
  } catch (error) {
    throw error?.code === 'PERSISTENCE_REQUIRED' ? error : makePersistenceRequired(error);
  }
}

/**
 * Inicializa cache em memória a partir do PostgreSQL (best-effort).
 *
 * Cache leve: carrega apenas metadados (sem a coluna `content`), mantendo a
 * memória proporcional aos metadados e não ao corpus. Consumidores que
 * precisam do content fazem query pontual por id (findByPk).
 */
async function initialize() {
  if (!dbAvailable()) return;
  try {
    const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
    const rows = await RagDocumentModel.findAll({ attributes: { exclude: ['content'] } });
    documents = new Map();
    for (const row of rows) {
      const doc = fromDbRow(row);
      documents.set(doc.id, doc);
    }
    logger.info('[RAGDocuments] Cache inicializado do PostgreSQL (metadados, sem content)', { count: documents.size });
  } catch (err) {
    logger.warn('[RAGDocuments] Falha ao inicializar cache do PostgreSQL', { error: safeErrorMessage(err) });
  }
}

async function refreshTenantDocuments(tenantId) {
  requireDbAvailable();
  const scopedTenantId = safeTrim(tenantId);
  if (!scopedTenantId) {
    const error = new Error('tenant_required');
    error.code = 'TENANT_REQUIRED';
    throw error;
  }
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const rows = await runPersistence(() => RagDocumentModel.findAll({
    attributes: { exclude: ['content'] },
    where: { tenant_key: scopedTenantId },
  }));
  for (const [id, document] of documents.entries()) {
    if (document?.tenantId === scopedTenantId) documents.delete(id);
  }
  const refreshed = (rows || []).map(fromDbRow);
  for (const document of refreshed) documents.set(document.id, document);
  return refreshed;
}

/**
 * Escapa curingas de LIKE/ILIKE (\, %, _) para busca substring segura.
 */
function escapeLikePattern(term) {
  return safeToString(term, '').replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Busca no DB os ids de documentos cujo título ou content casam (substring,
 * case-insensitive) com o termo — equivalente ao filtro em memória anterior.
 *
 * @param {string} searchLower - Termo já normalizado (trim/lower)
 * @param {string|null} tenantId - Escopo de tenant (opcional)
 * @returns {Promise<Set<string>>} Ids que casam com o termo
 */
async function findDocumentIdsMatchingSearch(searchLower, tenantId = null) {
  requireDbAvailable();
  const sequelize = getSequelize();
  const replacements = { pattern: `%${escapeLikePattern(searchLower)}%` };
  let sql = "SELECT id FROM rag_documents WHERE (title ILIKE :pattern ESCAPE '\\' OR content ILIKE :pattern ESCAPE '\\')";
  if (tenantId) {
    sql += ' AND tenant_key = :tenantId';
    replacements.tenantId = tenantId;
  }
  const [rows] = await runPersistence(() => sequelize.query(sql, { replacements }));
  return new Set((rows || []).map((r) => r && r.id).filter(Boolean));
}

/**
 * Carrega o content de um documento via query pontual (findByPk).
 *
 * @param {string} documentId
 * @returns {Promise<string|null>} Content, '' se vazio, null se não encontrado/DB indisponível
 */
async function loadDocumentContent(documentId) {
  requireDbAvailable();
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const row = await runPersistence(() => RagDocumentModel.findByPk(
    safeToString(documentId),
    { attributes: ['id', 'content'] },
  ));
  if (!row) return null;
  const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
  return base.content || '';
}

/**
 * Retorna (uma única query) os ids, dentre os informados, que têm content
 * não vazio no DB. Falha explicitamente quando o DB está indisponível; não
 * existe fallback para estado transitório em memória.
 *
 * @param {string[]} ids
 * @returns {Promise<Set<string>|null>}
 */
async function loadContentfulDocumentIds(ids) {
  requireDbAvailable();
  if (!Array.isArray(ids) || ids.length === 0) return new Set();
  const sequelize = getSequelize();
  const [rows] = await runPersistence(() => sequelize.query(
    "SELECT id FROM rag_documents WHERE id IN (:ids) AND content IS NOT NULL AND btrim(content) <> ''",
    { replacements: { ids } }
  ));
  return new Set((rows || []).map((r) => r && r.id).filter(Boolean));
}

/**
 * Hidrata o content de documentos leves (content === undefined) via uma única
 * query em lote. Retorna cópias — nunca muta as entradas do cache leve.
 * Sem DB disponível, falha com PERSISTENCE_REQUIRED.
 *
 * @param {Array} docs
 * @returns {Promise<Array>}
 */
async function hydrateDocumentsWithContent(docs) {
  if (!Array.isArray(docs) || docs.length === 0) return docs;
  requireDbAvailable();
  const missing = docs.filter((d) => d && d.content === undefined && d.id);
  if (missing.length === 0) return docs;
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const rows = await runPersistence(() => RagDocumentModel.findAll({
    attributes: ['id', 'content'],
    where: { id: missing.map((d) => d.id) },
  }));
  const contentById = new Map(rows.map((r) => {
    const base = r.toJSON ? r.toJSON() : (r.dataValues || r);
    return [base.id, base.content];
  }));
  return docs.map((d) => (
    d && d.content === undefined
      ? { ...d, content: contentById.get(d.id) || '' }
      : d
  ));
}

function coerceOffset(raw) {
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function coerceLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return null; // sem limite (comportamento legado)
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/**
 * Lista documentos com filtros opcionais.
 *
 * O filtro `search` consulta o DB com ILIKE (título/content). PostgreSQL é
 * obrigatório; o cache nunca autoriza resposta degradada.
 * Paginação opcional via limit/offset — sem limit informado, retorna tudo
 * (comportamento legado). Documentos leves têm o content hidratado na resposta
 * (uma query em lote), preservando os campos de antes.
 *
 * @param {Object} filters - Filtros (tenantId, source, category, productId, clientId, status, search, limit, offset)
 * @returns {Promise<Array>} Lista de documentos
 */
async function listDocuments(filters = {}) {
  requireDbAvailable();
  const tenantId = safeTrim(filters.tenantId);
  if (!tenantId) {
    const error = new Error('tenant_required');
    error.code = 'TENANT_REQUIRED';
    throw error;
  }
  let result = await refreshTenantDocuments(tenantId);

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
      if (dbAvailable()) {
        const matchingIds = await findDocumentIdsMatchingSearch(searchLower, filters.tenantId || null);
        result = result.filter(doc => matchingIds.has(doc.id));
      } else {
        result = result.filter(doc => {
          const titleLower = safeTrimLower(doc.title);
          const contentLower = safeTrimLower(doc.content);
          return titleLower.includes(searchLower) || contentLower.includes(searchLower);
        });
      }
    }
  }

  // Ordena por data de atualização (mais recente primeiro)
  result.sort((a, b) => {
    const dateA = new Date(a.metadata?.updatedAt || a.metadata?.createdAt || 0);
    const dateB = new Date(b.metadata?.updatedAt || b.metadata?.createdAt || 0);
    return dateB - dateA;
  });

  // Paginação opcional (preserva comportamento atual quando não informada)
  const offset = coerceOffset(filters.offset);
  const limit = coerceLimit(filters.limit);
  if (offset > 0) {
    result = result.slice(offset);
  }
  if (limit !== null) {
    result = result.slice(0, limit);
  }

  return await hydrateDocumentsWithContent(result);
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
 * Obtém um documento por ID com o content hidratado (query pontual por id).
 * Usado por consumidores que precisam do content integral; o cache leve
 * continua sem content.
 *
 * @param {string} documentId - ID do documento
 * @returns {Promise<Object|null>} Documento (cópia, com content quando o DB está disponível) ou null
 */
async function getDocumentWithContent(documentId, expectedTenantId = null) {
  requireDbAvailable();
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  const row = await runPersistence(() => (expectedTenantId
    ? RagDocumentModel.findOne({
      where: { id: safeToString(documentId), tenant_key: expectedTenantId },
    })
    : RagDocumentModel.findByPk(safeToString(documentId))));
  if (!row) return null;
  const document = fromDbRow(row);
  documents.set(document.id, { ...document, content: undefined });
  return document;
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
    if (!finalTenantId || !safeTrim(finalTenantId)) {
      const tenantError = new Error('tenant_required');
      tenantError.code = 'TENANT_REQUIRED';
      throw tenantError;
    }
    requireDbAvailable();
    const requestedId = documentData?.id ? safeToString(documentData.id) : null;
    if (requestedId) {
      const cachedOwner = documents.get(requestedId)?.tenantId || null;
      if (cachedOwner && cachedOwner !== finalTenantId) {
        return { success: false, document: null, errorCode: 'document_tenant_conflict', error: 'ID de documento já pertence a outro tenant' };
      }
      const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
      const row = await runPersistence(() => RagDocumentModel.findByPk(
        requestedId,
        { attributes: ['tenant_key'] },
      ));
      const dbOwner = row?.tenant_key || row?.dataValues?.tenant_key || null;
      if (dbOwner && dbOwner !== finalTenantId) {
        return { success: false, document: null, errorCode: 'document_tenant_conflict', error: 'ID de documento já pertence a outro tenant' };
      }
    }
    
    // Verifica duplicação se não foi desabilitado
    if (!options.skipDuplicateCheck) {
      const duplicateResult = await ragDocumentsDeduplication.handleDuplicateDocument({
        documentData,
        finalTenantId,
        documentsCache: documents,
        persistFn: persistDocumentRequired,
        generateContentHash: ragDeduplicationService.generateContentHash,
        reindexDocumentFn: reindexDocument,
        loadContentFn: loadDocumentContent,
      });
      if (duplicateResult) {
        // Cache leve: hidrata content na resposta (query pontual), sem regravar no cache
        if (duplicateResult.document) {
          const [hydratedDoc] = await hydrateDocumentsWithContent([duplicateResult.document]);
          duplicateResult.document = hydratedDoc;
          if (duplicateResult.existingDocument) {
            duplicateResult.existingDocument = hydratedDoc;
          }
        }
        return duplicateResult;
      }
    }
    
    const document = await ragDocumentsLifecycle.buildDocumentForCreate(documentData, finalTenantId);

    await persistDocumentRequired(document);
    documents.set(document.id, document);
    ragResponseCache.invalidateTenant(document.tenantId);

    // Indexa automaticamente se solicitado
    if (documentData.autoIndex !== false) {
      await ragDocumentsLifecycle.autoIndexDocument(document, persistDocumentRequired);
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
      errorCode: error?.code || null,
      error: safeErrorMessage(error),
    };
  }
}

/**
 * Atualiza um documento existente.
 * 
 * @param {string} documentId - ID do documento
 * @param {Object} updates - Atualizações
 * @param {string} expectedTenantId - Tenant autoritativo (obrigatório)
 * @returns {Promise<{success: boolean, document: Object|null, error?: string}>}
 */
async function updateDocument(documentId, updates, expectedTenantId = null) {
  try {
    requireDbAvailable();
    const scopedTenantId = requireTenantScope(expectedTenantId);
    const persisted = await getDocumentWithContent(documentId, scopedTenantId);
    const document = persisted ? {
      ...persisted,
      metadata: { ...(persisted.metadata || {}) },
      permissions: { ...(persisted.permissions || {}) },
    } : null;
    if (!document) {
      return {
        success: false,
        document: null,
        errorCode: 'document_not_found',
        error: 'Documento não encontrado',
      };
    }
    if (document.tenantId !== scopedTenantId) {
      return {
        success: false,
        document: null,
        errorCode: 'document_not_found',
        error: 'Documento não encontrado',
      };
    }

    const requiresVectorRefresh = [
      'content',
      'metadata',
      'permissions',
      'domain',
      'classification',
      'sensitivity',
      'status',
    ].some((field) => Object.prototype.hasOwnProperty.call(updates || {}, field));

    ragDocumentsLifecycle.applyDocumentUpdates(document, updates);
    if (requiresVectorRefresh && document.status === 'active') {
      // Bloqueia retrieval dos chunks antigos antes de persistir mudanças de
      // ACL/domínio/sensibilidade/conteúdo. A consulta só aceita documentos
      // com index_status=indexed.
      setIndexState(document, 'indexing');
    }
    await persistDocumentRequired(document);
    documents.set(documentId, document);
    ragResponseCache.invalidateTenant(document.tenantId);

    if (requiresVectorRefresh && document.status !== 'active') {
      // Revogação é imediata: documento inativo não pode permanecer no corpus.
      await postgresVectorStore.deleteDocumentVectors({ tenantId: document.tenantId, documentId: document.id });
      setIndexState(document, 'pending');
      await persistDocumentRequired(document);
    } else if (requiresVectorRefresh) {
      // Alterações de conteúdo, ACL, sensibilidade ou domínio exigem refresh do
      // vector store; não dependem de uma flag reindex controlada pelo cliente.
      const reindexResult = await ragDocumentsIndexing.reindexDocument(
        documentId,
        documents,
        persistDocumentRequired,
        loadDocumentContent
      );
      if (!reindexResult.success) {
        return {
          success: false,
          document: null,
          errorCode: reindexResult.errorCode || 'RAG_INDEX_FAILED',
          error: reindexResult.error || 'Falha ao atualizar índice vetorial',
        };
      }
    }

    // Cache leve: resposta preserva o campo content (query pontual, cópia)
    const [responseDocument] = await hydrateDocumentsWithContent([document]);

    return {
      success: true,
      document: responseDocument || document,
    };
  } catch (error) {
    logger.error('[RAGDocuments] Erro ao atualizar documento:', error);
    return {
      success: false,
      document: null,
      errorCode: error?.code || null,
      error: safeErrorMessage(error),
    };
  }
}

/**
 * Deleta um documento.
 * 
 * @param {string} documentId - ID do documento
 * @param {string} expectedTenantId - Tenant autoritativo (obrigatório)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteDocument(documentId, expectedTenantId = null) {
  try {
    requireDbAvailable();
    const scopedTenantId = requireTenantScope(expectedTenantId);
    const safeDocumentId = safeToString(documentId);
    const document = safeDocumentId ? await getDocumentWithContent(safeDocumentId, scopedTenantId) : null;
    let tenantId = document?.tenantId || null;
    if (document && tenantId !== scopedTenantId) {
      return { success: false, errorCode: 'document_not_found', error: 'Documento não encontrado' };
    }

    // DELETE é idempotente. A existência foi consultada no PostgreSQL com
    // tenant, e a linha autoritativa é removida antes das limpezas derivadas.
    if (!document) return { success: true, alreadyDeleted: true };

    await deleteDocumentRequired(safeDocumentId, scopedTenantId);
    documents.delete(safeDocumentId);

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

    ragResponseCache.invalidateTenant(tenantId);

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
      errorCode: error?.code || null,
      error: safeErrorMessage(error),
    };
  }
}

/**
 * Reindexa um documento (delegado para ragDocumentsIndexing).
 * 
 * @param {string} documentId - ID do documento
 * @param {string} expectedTenantId - Tenant autoritativo (obrigatório)
 * @returns {Promise<{success: boolean, chunksCreated: number, error?: string}>}
 */
async function reindexDocument(documentId, expectedTenantId = null) {
  requireDbAvailable();
  const scopedTenantId = requireTenantScope(expectedTenantId);
  const document = await getDocumentWithContent(documentId, scopedTenantId);
  if (!document || document.tenantId !== scopedTenantId) {
    return {
      success: false,
      chunksCreated: 0,
      errorCode: 'document_not_found',
      error: 'Documento não encontrado',
    };
  }
  documents.set(document.id, document);
  ragResponseCache.invalidateTenant(document.tenantId);
  return await ragDocumentsIndexing.reindexDocument(documentId, documents, persistDocumentRequired, loadDocumentContent);
}

/**
 * Reindexa todos os documentos não indexados ou inconsistentes (delegado para ragDocumentsIndexing).
 * 
 * @param {string} tenantId - ID do tenant (opcional)
 * @param {boolean} includeInconsistent - Incluir documentos já marcados como indexed
 * @returns {Promise<{success: boolean, total: number, indexed: number, failed: number, errors: Array}>}
 */
async function reindexAllNotIndexed(tenantId = null, includeInconsistent = false) {
  await refreshTenantDocuments(tenantId);
  return await ragDocumentsIndexing.reindexAllNotIndexed(
    tenantId,
    includeInconsistent,
    documents,
    persistDocumentRequired,
    (documentId) => reindexDocument(documentId, tenantId),
    loadContentfulDocumentIds
  );
}

/**
 * Reindex completo de um tenant (single source of truth = Postgres).
 * 1) marca todos docs como pending
 * 2) reprocessa cada documento por substituição transacional no serviço RAG
 *
 * O corpus do tenant nunca é apagado em bloco antes da nova indexação.
 */
async function reindexAllTenant(tenantId) {
  await refreshTenantDocuments(tenantId);
  return await ragDocumentsIndexing.reindexAllTenant(
    tenantId,
    documents,
    persistDocumentRequired,
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
  await refreshTenantDocuments(tenantId);
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
  await refreshTenantDocuments(tenantId);
  return await ragDocumentsHealth.getRagHealth(
    tenantId,
    options,
    documents,
    persistDocumentRequired,
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
  getDocumentWithContent,
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
