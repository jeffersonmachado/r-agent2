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
const { getSequelize } = require('../db/sequelize');
const { RagDocument: RagDocumentGetter, RagDocumentFile: RagDocumentFileGetter } = require('../db/models');
const postgresVectorStore = require('./vectorStore/postgresVectorStore');

// Lazy loading do ragService para evitar dependência circular
let ragService = null;
function getRagService() {
  if (!ragService) {
    try {
      ragService = require('./ragService');
      if (!ragService || typeof ragService.indexDocument !== 'function') {
        logger.error('[RAGDocuments] ERRO CRÍTICO: ragService não foi carregado corretamente', {
          ragServiceType: typeof ragService,
          ragServiceKeys: ragService ? Object.keys(ragService) : 'null',
          hasIndexDocument: ragService && 'indexDocument' in ragService,
          indexDocumentType: ragService && typeof ragService.indexDocument
        });
        throw new Error('ragService não foi carregado corretamente. Verifique se o módulo api/services/ragService.js existe e exporta indexDocument.');
      }
    } catch (error) {
      logger.error('[RAGDocuments] Erro ao carregar ragService:', error);
      throw error;
    }
  }
  return ragService;
}

// Cache em memória
let documents = new Map();

// Funções deprecated removidas - dados agora estão no banco de dados PostgreSQL
// Dados são carregados do banco de dados PostgreSQL - não precisa carregar de arquivo

function dbAvailable() {
  return !!getSequelize();
}

function safeToString(value, fallback = '') {
  if (value == null) return fallback;
  try { return String(value); } catch (_) { return fallback; }
}

function safeTrim(value, fallback = '') {
  const str = safeToString(value, fallback);
  try { return str.trim(); } catch (_) { return fallback; }
}

function safeTrimLower(value, fallback = '') {
  const str = safeTrim(value, fallback);
  try { return str.toLowerCase(); } catch (_) { return fallback; }
}

function toDbPayload(doc) {
  return {
    id: doc.id,
    tenant_key: doc.tenantId || null,
    title: doc.title || null,
    content: doc.content || null,
    metadata: doc.metadata && typeof doc.metadata === 'object' ? doc.metadata : {},
    permissions: doc.permissions && typeof doc.permissions === 'object' ? doc.permissions : {},
    status: doc.status || 'active',
    indexed: !!doc.indexed,
    indexed_at: doc.indexedAt ? new Date(doc.indexedAt) : null,
    chunks_count: Number.isFinite(doc.chunksCount) ? doc.chunksCount : 0,
    index_status: doc.indexStatus || (doc.indexed ? 'indexed' : 'pending'),
    index_error_code: doc.indexErrorCode || null,
    index_error_message: doc.indexErrorMessage || null,
    last_index_attempt_at: doc.lastIndexAttemptAt ? new Date(doc.lastIndexAttemptAt) : null,
    inconsistent: !!doc.inconsistent,
    inconsistent_reason: doc.inconsistentReason || null,
  };
}

function fromDbRow(row) {
  const base = row.toJSON ? row.toJSON() : (row.dataValues || row);
  return {
    id: base.id,
    tenantId: base.tenant_key || null,
    title: base.title || 'Sem título',
    content: base.content || '',
    metadata: base.metadata || {},
    permissions: base.permissions || {},
    status: base.status || 'active',
    indexed: !!base.indexed,
    indexedAt: base.indexed_at ? new Date(base.indexed_at).toISOString() : null,
    chunksCount: Number.isFinite(base.chunks_count) ? base.chunks_count : 0,
    indexStatus: base.index_status || (base.indexed ? 'indexed' : 'pending'),
    indexErrorCode: base.index_error_code || null,
    indexErrorMessage: base.index_error_message || null,
    lastIndexAttemptAt: base.last_index_attempt_at ? new Date(base.last_index_attempt_at).toISOString() : null,
    inconsistent: !!base.inconsistent,
    inconsistentReason: base.inconsistent_reason || null,
  };
}

function setIndexState(doc, state, opts = {}) {
  const nowIso = new Date().toISOString();
  doc.indexStatus = state;
  doc.lastIndexAttemptAt = opts.lastIndexAttemptAt || nowIso;

  if (state === 'pending') {
    doc.indexed = false;
    doc.indexedAt = null;
    doc.chunksCount = 0;
    doc.indexErrorCode = null;
    doc.indexErrorMessage = null;
    doc.inconsistent = false;
    doc.inconsistentReason = null;
    return;
  }

  if (state === 'indexed') {
    doc.indexed = true;
    doc.indexedAt = opts.indexedAt || nowIso;
    doc.chunksCount = Number.isFinite(opts.chunksCount) ? opts.chunksCount : (doc.chunksCount || 0);
    doc.indexErrorCode = null;
    doc.indexErrorMessage = null;
    doc.inconsistent = false;
    doc.inconsistentReason = null;
    return;
  }

  if (state === 'indexing') {
    // Não altera indexed aqui; só marca indexed após confirmação (chunks > 0)
    doc.indexErrorCode = null;
    doc.indexErrorMessage = null;
    return;
  }

  if (state === 'failed') {
    doc.indexed = false;
    doc.indexedAt = null;
    doc.chunksCount = 0;
    doc.indexErrorCode = opts.errorCode || 'RAG_INDEX_FAILED';
    doc.indexErrorMessage = opts.errorMessage || 'Falha ao indexar no vector store';
    return;
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
      logger.warn('[RAGDocuments] Falha ao persistir documento no PostgreSQL', { documentId: doc.id, error: err.message });
    });
  });
}

function deleteDocumentBestEffort(id) {
  if (!dbAvailable()) return;
  setImmediate(() => {
    deleteDocumentFromDb(id).catch((err) => {
      logger.warn('[RAGDocuments] Falha ao remover documento no PostgreSQL', { documentId: id, error: err.message });
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
    logger.warn('[RAGDocuments] Falha ao inicializar cache do PostgreSQL', { error: err.message });
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
  if (!url) return null;
  
  const normalizedUrl = safeTrimLower(url);
  if (!normalizedUrl) return null;
  
  for (const doc of documents.values()) {
    // Verifica se é do mesmo tenant
    if (tenantId && doc.tenantId !== tenantId) continue;
    
    // Verifica se tem a mesma URL no metadata
    const docUrl = doc.metadata?.url;
    if (docUrl && safeTrimLower(docUrl) === normalizedUrl) {
      return doc;
    }
  }
  
  return null;
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
  if (!fileName) return null;
  
  const normalizedFileName = safeTrimLower(fileName);
  if (!normalizedFileName) return null;
  
  for (const doc of documents.values()) {
    // Verifica se é do mesmo tenant
    if (tenantId && doc.tenantId !== tenantId) continue;
    
    // Verifica se tem o mesmo nome de arquivo no metadata
    const docFileName = doc.metadata?.fileName;
    if (docFileName && safeTrimLower(docFileName) === normalizedFileName) {
      // Se fileSize foi fornecido, também verifica o tamanho para maior precisão
      if (fileSize !== null && doc.metadata?.fileSize) {
        if (doc.metadata.fileSize === fileSize) {
          return doc;
        }
        // Se tamanho é diferente, não é o mesmo arquivo
        continue;
      }
      return doc;
    }
  }
  
  return null;
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
      // Verifica por URL (web scraping)
      if (documentData.metadata?.url) {
        const existingDoc = findDocumentByUrl(documentData.metadata.url, finalTenantId);
        if (existingDoc) {
          logger.info('[RAGDocuments] Documento duplicado encontrado (mesma URL)', {
            url: documentData.metadata.url,
            existingDocumentId: existingDoc.id,
            existingTitle: existingDoc.title,
            tenantId: finalTenantId,
            indexed: existingDoc.indexed || false
          });
          
          // Se o documento existente não está indexado e autoIndex está ativo, indexa agora
          if (documentData.autoIndex !== false && !existingDoc.indexed) {
            logger.info('[RAGDocuments] Documento duplicado não está indexado, indexando agora...', {
              documentId: existingDoc.id,
              tenantId: finalTenantId
            });
            
            try {
              // Garante que o documento tem content_hash nos metadados antes de indexar
              if (!existingDoc.metadata?.content_hash && existingDoc.content) {
                const contentHash = await ragDeduplicationService.generateContentHash(existingDoc.content);
                existingDoc.metadata = {
                  ...existingDoc.metadata,
                  content_hash: contentHash,
                };
                documents.set(existingDoc.id, existingDoc);
                persistDocumentBestEffort(existingDoc);
              }
              
              const ragServiceInstance = getRagService();
              setIndexState(existingDoc, 'indexing');
              documents.set(existingDoc.id, existingDoc);
              persistDocumentBestEffort(existingDoc);
              const indexResult = await ragServiceInstance.indexDocument(existingDoc, finalTenantId);
              
              const chunksCreated = indexResult.chunksCreated || 0;
              if (indexResult.success && chunksCreated > 0) {
                setIndexState(existingDoc, 'indexed', { chunksCount: chunksCreated });
                documents.set(existingDoc.id, existingDoc);
                persistDocumentBestEffort(existingDoc);
                
                logger.info('[RAGDocuments] Documento duplicado indexado com sucesso', {
                  documentId: existingDoc.id,
                  chunksCreated
                });
              } else {
                setIndexState(existingDoc, 'failed', {
                  errorCode: 'RAG_INDEX_FAILED',
                  errorMessage: chunksCreated === 0
                    ? (indexResult.isDuplicate ? 'Indexação retornou 0 chunks (duplicado/sem ingestão)' : 'Indexação retornou 0 chunks (não persistido no vector store)')
                    : (indexResult.error || 'Indexação retornou success=false'),
                });
                documents.set(existingDoc.id, existingDoc);
                persistDocumentBestEffort(existingDoc);
                logger.warn('[RAGDocuments] Indexação do documento duplicado retornou success=false', {
                  documentId: existingDoc.id,
                  error: indexResult.error,
                  isDuplicate: indexResult.isDuplicate
                });
              }
            } catch (indexError) {
              setIndexState(existingDoc, 'failed', { errorCode: 'RAG_INDEX_FAILED', errorMessage: indexError.message });
              documents.set(existingDoc.id, existingDoc);
              persistDocumentBestEffort(existingDoc);
              logger.error('[RAGDocuments] Erro ao indexar documento duplicado', {
                error: indexError.message,
                stack: indexError.stack,
                documentId: existingDoc.id,
                tenantId: finalTenantId
              });
            }
          }
          
          // Retorna documento existente sem criar duplicata
          return {
            success: true,
            document: existingDoc,
            isDuplicate: true,
            existingDocument: existingDoc,
          };
        }
      }
      
      // Verifica por nome de arquivo (uploads)
      if (documentData.metadata?.fileName) {
        const existingDoc = findDocumentByFileName(
          documentData.metadata.fileName, 
          finalTenantId,
          documentData.metadata.fileSize
        );
        if (existingDoc) {
          logger.info('[RAGDocuments] Documento duplicado encontrado (mesmo arquivo)', {
            fileName: documentData.metadata.fileName,
            fileSize: documentData.metadata.fileSize,
            existingDocumentId: existingDoc.id,
            existingTitle: existingDoc.title,
            tenantId: finalTenantId,
            indexed: existingDoc.indexed || false
          });
          
          // Se o documento existente não está indexado e autoIndex está ativo, indexa agora
          if (documentData.autoIndex !== false && !existingDoc.indexed) {
            logger.info('[RAGDocuments] Documento duplicado (arquivo) não está indexado, indexando agora...', {
              documentId: existingDoc.id,
              tenantId: finalTenantId,
              fileName: documentData.metadata.fileName
            });
            
            try {
              // Garante que o documento tem content_hash nos metadados antes de indexar
              if (!existingDoc.metadata?.content_hash && existingDoc.content) {
                const contentHash = await ragDeduplicationService.generateContentHash(existingDoc.content);
                existingDoc.metadata = {
                  ...existingDoc.metadata,
                  content_hash: contentHash,
                };
                documents.set(existingDoc.id, existingDoc);
                persistDocumentBestEffort(existingDoc);
              }
              
              const ragServiceInstance = getRagService();
              setIndexState(existingDoc, 'indexing');
              documents.set(existingDoc.id, existingDoc);
              persistDocumentBestEffort(existingDoc);
              const indexResult = await ragServiceInstance.indexDocument(existingDoc, finalTenantId);
              
              const chunksCreated = indexResult.chunksCreated || 0;
              if (indexResult.success && chunksCreated > 0) {
                setIndexState(existingDoc, 'indexed', { chunksCount: chunksCreated });
                documents.set(existingDoc.id, existingDoc);
                persistDocumentBestEffort(existingDoc);
                
                logger.info('[RAGDocuments] Documento duplicado (arquivo) indexado com sucesso', {
                  documentId: existingDoc.id,
                  chunksCreated
                });
              } else {
                setIndexState(existingDoc, 'failed', {
                  errorCode: 'RAG_INDEX_FAILED',
                  errorMessage: chunksCreated === 0
                    ? (indexResult.isDuplicate ? 'Indexação retornou 0 chunks (duplicado/sem ingestão)' : 'Indexação retornou 0 chunks (não persistido no vector store)')
                    : (indexResult.error || 'Indexação retornou success=false'),
                });
                documents.set(existingDoc.id, existingDoc);
                persistDocumentBestEffort(existingDoc);
                logger.warn('[RAGDocuments] Indexação do documento duplicado (arquivo) retornou success=false', {
                  documentId: existingDoc.id,
                  error: indexResult.error,
                  isDuplicate: indexResult.isDuplicate
                });
              }
            } catch (indexError) {
              setIndexState(existingDoc, 'failed', { errorCode: 'RAG_INDEX_FAILED', errorMessage: indexError.message });
              documents.set(existingDoc.id, existingDoc);
              persistDocumentBestEffort(existingDoc);
              logger.error('[RAGDocuments] Erro ao indexar documento duplicado (arquivo)', {
                error: indexError.message,
                stack: indexError.stack,
                documentId: existingDoc.id,
                tenantId: finalTenantId
              });
            }
          }
          
          // Retorna documento existente sem criar duplicata
          return {
            success: true,
            document: existingDoc,
            isDuplicate: true,
            existingDocument: existingDoc,
          };
        }
      }
    }
    
    const now = new Date().toISOString();
    
    // Gera ID do documento primeiro
    const documentId = documentData.id || `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // ETAPA 3: Gera metadados obrigatórios para deduplicação
    // Para uploads, usa fileName como source_id para agrupar versões do mesmo arquivo
    // Para outros, usa o documentId como source_id
    const sourceId = documentData.metadata?.source_id || 
                     (documentData.metadata?.fileName ? `file:${documentData.metadata.fileName}` : documentId);
    const currentVersion = ragDeduplicationService.getCurrentSourceVersion(finalTenantId, sourceId);
    const sourceVersion = documentData.metadata?.source_version || (currentVersion + 1);
    
    // Gera content_hash se ainda não foi gerado
    let contentHash = documentData.metadata?.content_hash;
    if (!contentHash && documentData.content) {
      contentHash = await ragDeduplicationService.generateContentHash(documentData.content);
    }
    
    const document = {
      id: documentId,
      tenantId: finalTenantId,
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
        url: documentData.metadata?.url || null, // Preserva URL para verificação de duplicação
        fileName: documentData.metadata?.fileName || null, // Preserva fileName para verificação de duplicação
        fileSize: documentData.metadata?.fileSize || null, // Preserva fileSize para verificação de duplicação
        // Metadados obrigatórios para deduplicação
        source_id: sourceId,
        source_version: sourceVersion,
        content_hash: contentHash,
        tenant_id: finalTenantId,
        createdAt: now,
        updatedAt: now,
        version: sourceVersion, // Usa source_version como version
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

    documents.set(document.id, document);
    persistDocumentBestEffort(document);

    // Indexa automaticamente se solicitado
    if (documentData.autoIndex !== false) {
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
          contentHash: document.metadata?.content_hash ? document.metadata.content_hash.substring(0, 16) + '...' : null
        });
        
        const ragServiceInstance = getRagService();
        setIndexState(document, 'indexing');
        documents.set(document.id, document);
        persistDocumentBestEffort(document);
        const indexResult = await ragServiceInstance.indexDocument(document, document.tenantId);
        
        const chunksCreated = indexResult.chunksCreated || 0;
        if (indexResult.success && chunksCreated > 0) {
          setIndexState(document, 'indexed', { chunksCount: chunksCreated });
          documents.set(document.id, document);
          persistDocumentBestEffort(document);
          
          logger.info('[RAGDocuments] Documento indexado com sucesso', {
            documentId: document.id,
            tenantId: document.tenantId,
            chunksCreated,
            isDuplicate: indexResult.isDuplicate || false,
            sourceId: document.metadata?.source_id,
            sourceVersion: document.metadata?.source_version
          });
        } else {
          setIndexState(document, 'failed', {
            errorCode: 'RAG_INDEX_FAILED',
            errorMessage: chunksCreated === 0
              ? (indexResult.isDuplicate ? 'Indexação retornou 0 chunks (duplicado/sem ingestão)' : 'Indexação retornou 0 chunks (não persistido no vector store)')
              : (indexResult.error || 'Indexação retornou success=false'),
          });
          documents.set(document.id, document);
          persistDocumentBestEffort(document);
          logger.warn('[RAGDocuments] Indexação retornou success=false', {
            documentId: document.id,
            tenantId: document.tenantId,
            error: indexResult.error,
            isDuplicate: indexResult.isDuplicate || false,
            chunksCreated
          });
        }
      } catch (indexError) {
        setIndexState(document, 'failed', { errorCode: 'RAG_INDEX_FAILED', errorMessage: indexError.message });
        documents.set(document.id, document);
        persistDocumentBestEffort(document);
        logger.error('[RAGDocuments] Erro ao indexar documento automaticamente', {
          error: indexError.message,
          stack: indexError.stack,
          documentId: document.id,
          tenantId: document.tenantId,
          title: document.title,
          contentLength: document.content?.length || 0
        });
        // Não falha a criação se a indexação falhar
      }
    } else {
      logger.debug('[RAGDocuments] Auto-indexação desabilitada para documento', {
        documentId: document.id,
        tenantId: document.tenantId,
        autoIndex: documentData.autoIndex
      });
    }

    const indexing = (() => {
      const attempted = documentData.autoIndex !== false;
      if (!attempted) {
        return { attempted: false, success: null, errorCode: null, errorMessage: null };
      }
      const success = document.indexStatus === 'indexed' && (document.chunksCount || 0) > 0;
      return {
        attempted: true,
        success,
        errorCode: success ? null : (document.indexErrorCode || 'RAG_INDEX_FAILED'),
        errorMessage: success ? null : (document.indexErrorMessage || 'Falha ao indexar'),
      };
    })();

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
    persistDocumentBestEffort(document);

    // Reindexa se solicitado e conteúdo mudou
    if (updates.reindex && updates.content !== undefined) {
      try {
        const ragServiceInstance = getRagService();
        setIndexState(document, 'indexing');
        persistDocumentBestEffort(document);

        const indexResult = await ragServiceInstance.indexDocument(document, document.tenantId);
        const chunksCreated = indexResult.chunksCreated || 0;
        if (indexResult.success && chunksCreated > 0) {
          setIndexState(document, 'indexed', { chunksCount: chunksCreated });
          persistDocumentBestEffort(document);
        } else {
          setIndexState(document, 'failed', {
            errorCode: 'RAG_INDEX_FAILED',
            errorMessage: chunksCreated === 0 ? 'Indexação retornou 0 chunks (não persistido no vector store)' : (indexResult.error || 'Indexação retornou success=false'),
          });
          persistDocumentBestEffort(document);
        }
      } catch (indexError) {
        setIndexState(document, 'failed', { errorCode: 'RAG_INDEX_FAILED', errorMessage: indexError.message });
        persistDocumentBestEffort(document);
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
    const ragServiceInstance = getRagService();
    if (typeof ragServiceInstance.indexDocument !== 'function') {
      logger.error('[RAGDocuments] ragService.indexDocument não é uma função', {
        documentId,
        ragServiceType: typeof ragServiceInstance,
        ragServiceKeys: Object.keys(ragServiceInstance || {}),
        hasIndexDocument: 'indexDocument' in (ragServiceInstance || {})
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

    setIndexState(document, 'indexing');
    documents.set(document.id, document);
    persistDocumentBestEffort(document);

    // Reindex consistente: remove vetores anteriores antes de reinserir
    try {
      if (document.tenantId) {
        await postgresVectorStore.deleteDocumentVectors({ tenantId: document.tenantId, documentId: document.id });
      }
    } catch (e) {
      logger.warn('[RAGDocuments] Falha ao remover vetores antes do reindex (best-effort)', {
        tenantId: document.tenantId || null,
        documentId: document.id,
        error: e.message,
      });
    }

    const indexResult = await ragServiceInstance.indexDocument(document, document.tenantId);
    
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
      persistDocumentBestEffort(document);
      
      logger.info('[RAGDocuments] Documento marcado como indexado no BD', {
        documentId: document.id,
        chunksCount: document.chunksCount,
        indexedAt: document.indexedAt
      });
    } else {
      const rawErrMsg = safeToString(indexResult.error || '');
      const derivedCode = rawErrMsg.includes('EMBEDDING_DIM_MISMATCH') ? 'EMBEDDING_DIM_MISMATCH' : 'RAG_INDEX_FAILED';
      setIndexState(document, 'failed', {
        errorCode: derivedCode,
        errorMessage: chunksCreated === 0
          ? (indexResult.isDuplicate ? 'Indexação retornou 0 chunks (duplicado/sem ingestão)' : 'Indexação retornou 0 chunks (não persistido no vector store)')
          : (indexResult.error || 'Falha ao indexar documento'),
      });
      persistDocumentBestEffort(document);
      logger.error('[RAGDocuments] Falha ao indexar documento', {
        documentId: document.id,
        error: indexResult.error,
        tenantId: document.tenantId
      });
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
    return {
      success: false,
      chunksCreated: 0,
      errorCode: safeToString(error.message || '').includes('EMBEDDING_DIM_MISMATCH') ? 'EMBEDDING_DIM_MISMATCH' : 'RAG_INDEX_FAILED',
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
    const ragServiceInstance = getRagService();
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
    const serviceUrl = ragServiceInstance.getRagServiceUrl(tenantId);
    const isAvailable = await ragServiceInstance.isRagAvailable(tenantId);
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
      const isAvailable = await ragServiceInstance.isRagAvailable(tenantId);
      if (isAvailable) {
        const serviceUrl = ragServiceInstance.getRagServiceUrl(tenantId);
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
            // Dados agora estão no banco de dados PostgreSQL
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
 * Reindex completo de um tenant (single source of truth = Postgres):
 * 1) marca todos docs como pending (no cache + best-effort no DB)
 * 2) apaga todos os rag_chunks do tenant
 * 3) reprocessa indexação (reindexAllNotIndexed)
 */
async function reindexAllTenant(tenantId) {
  const finalTenantId = tenantId || null;
  if (!finalTenantId) {
    return { success: false, total: 0, indexed: 0, failed: 0, errors: [{ error: 'tenantId é obrigatório' }] };
  }

  // Marca todos como pending (cache + best-effort persist)
  for (const doc of documents.values()) {
    if (doc.tenantId !== finalTenantId) continue;
    setIndexState(doc, 'pending');
    documents.set(doc.id, doc);
    persistDocumentBestEffort(doc);
  }

  // Apaga vetores do tenant (fonte única)
  await postgresVectorStore.deleteTenantVectors(finalTenantId);

  // Reindexa tudo (agora todos estão !indexed)
  return await reindexAllNotIndexed(finalTenantId, true);
}

/**
 * Obtém estatísticas de documentos.
 * 
 * @param {string} tenantId - ID do tenant (opcional)
 * @returns {Object} Estatísticas
 */
async function getDocumentsStats(tenantId = null) {
  const ragServiceInstance = getRagService();
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

  // Vector store agora é Postgres (pgvector): stats vem direto do banco.
  try {
    const vectorCounts = await postgresVectorStore.countVectorDocs({ tenantId: tenantId || null });
    stats.vectorStoreStats = {
      vectorStore: 'postgres',
      indexedDocuments: vectorCounts.documents || 0,
      indexedChunks: vectorCounts.chunks || 0,
      tenantId: tenantId || null,
    };

    // Fonte de verdade de chunks: substitui soma por doc.chunksCount (cache)
    stats.totalChunks = stats.vectorStoreStats.indexedChunks;

    const dbIndexed = stats.indexed;
    const vectorIndexed = stats.vectorStoreStats.indexedDocuments;

    if (dbIndexed === vectorIndexed) {
      stats.syncStatus = 'synced';
    } else if (dbIndexed > vectorIndexed) {
      stats.syncStatus = 'db_ahead';
      stats.syncDifference = dbIndexed - vectorIndexed;
    } else {
      stats.syncStatus = 'vector_ahead';
      stats.syncDifference = vectorIndexed - dbIndexed;
    }
  } catch (err) {
    stats.vectorStoreStats = {
      vectorStore: 'postgres',
      indexedDocuments: 0,
      indexedChunks: 0,
      tenantId: tenantId || null,
      error: err.message,
    };
    if (stats.indexed > 0) {
      stats.syncStatus = 'db_ahead';
      stats.syncDifference = stats.indexed;
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

/**
 * Health do RAG (Node) usando Postgres como fonte única.
 *
 * @param {string} tenantId
 * @param {{ autoRepair?: boolean }} options
 * @returns {Promise<{ok: boolean, tenantId?: string, docs?: any, chunks?: any, warnings?: any[], error?: any}>}
 */
async function getRagHealth(tenantId, options = {}) {
  const finalTenantId = tenantId || null;
  if (!finalTenantId) {
    return { ok: false, error: { code: 'TENANT_REQUIRED', message: 'tenantId é obrigatório' } };
  }

  try {
    const docs = Array.from(documents.values()).filter((d) => d.tenantId === finalTenantId);
    const total = docs.length;
    const indexed = docs.filter((d) => d.indexStatus === 'indexed').length;
    const failed = docs.filter((d) => d.indexStatus === 'failed').length;

    const vectorCounts = await postgresVectorStore.countVectorDocs({ tenantId: finalTenantId });
    const chunksByDoc = await postgresVectorStore.countChunksByDocument({ tenantId: finalTenantId });

    const warnings = [];

    // Consistência interna: doc marcado como indexed mas não tem chunks no Postgres
    const inconsistentDocIds = docs
      .filter((d) => d.indexStatus === 'indexed' && (Number(chunksByDoc[d.id] || 0) === 0))
      .map((d) => d.id);

    if (inconsistentDocIds.length > 0) {
      const reason = `Documento marcado como indexed mas chunks=0 no Postgres (${inconsistentDocIds.length} doc(s))`;
      warnings.push({
        code: 'RAG_INCONSISTENT_INDEXED_WITHOUT_CHUNKS',
        message: reason,
        details: { tenantId: finalTenantId, documentIds: inconsistentDocIds },
      });

      // Auto-correção: rebaixa para failed (fonte única = Postgres)
      for (const id of inconsistentDocIds) {
        const doc = documents.get(id);
        if (!doc) continue;
        setIndexState(doc, 'failed', {
          errorCode: 'RAG_INCONSISTENT',
          errorMessage: 'Marcado como indexed, mas não há chunks gravados no Postgres (pgvector)',
        });
        documents.set(id, doc);
        persistDocumentBestEffort(doc);
      }
      await markInconsistentDocuments(finalTenantId, reason, inconsistentDocIds).catch(() => {});
    } else {
      await markConsistentForTenant(finalTenantId).catch(() => {});
    }

    // Se houver chunks sem documentos (órfãos), avisa (limpeza é endpoint dedicado)
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
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'RAG_HEALTH_FAILED',
        message: 'Falha ao calcular health do RAG',
        details: { tenantId: finalTenantId, message: err.message },
      },
    };
  }
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

