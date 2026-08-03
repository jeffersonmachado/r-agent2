/**
 * Serviço de deduplicação RAG.
 *
 * Responsabilidades:
 * - Verificar duplicidade estrutural (content_hash)
 * - Verificar duplicidade semântica (semantic_hash + cosine similarity via pgvector)
 * - Gerenciar versionamento de documentos
 * - Registrar logs de auditoria
 *
 * REGRAS:
 * - Toda deduplicação ocorre ANTES da recuperação
 * - Lógica determinística e reexecutável
 * - NÃO reindexa documentos existentes automaticamente
 * - NÃO remove dados históricos
 *
 * PERSISTÊNCIA:
 * - Os índices de dedup vivem na tabela `rag_chunks` (Postgres): os metadados
 *   (content_hash, semantic_hash, source_id, source_version, active) ficam no
 *   JSONB `metadata`. Não há estado em memória — falha de DB propaga erro
 *   explícito (sem fallback silencioso).
 * - As queries assumem os índices de expressão
 *   `(tenant_key, (metadata->>'content_hash'))` e `(tenant_key, (metadata->>'source_id'))`,
 *   mas funcionam mesmo sem eles (apenas mais lentas).
 */

const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const {
  normalizeContent,
  generateContentHash,
  generateContentHashSync,
  generateChunkId,
  generateSemanticHash,
  normalizeEmbedding,
  cosineSimilarity,
} = require('../utils/contentNormalization');

function safeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function requireSequelize() {
  const sequelize = getSequelize();
  if (!sequelize) {
    throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
  }
  return sequelize;
}

function normalizeTenantKey(tenantId) {
  if (tenantId === null || tenantId === undefined) return null;
  const tid = safeString(tenantId).trim();
  return tid || null;
}

function requireTenantKey(tenantId) {
  const tenantKey = normalizeTenantKey(tenantId);
  if (!tenantKey) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  return tenantKey;
}

function embeddingToPgVectorLiteral(embedding) {
  // pgvector aceita string no formato "[1,2,3]" (mesmo padrão do postgresVectorStore)
  return `[${embedding.map((n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0';
    return String(Math.abs(v) < 1e-8 ? 0 : v);
  }).join(',')}]`;
}

function rowToExistingChunk(row) {
  const metadata = (row && row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
  return {
    ...metadata,
    chunk_id: row.id,
    document_id: row.document_id,
  };
}

function shortHash(hash) {
  return safeString(hash).substring(0, 16) + '...';
}

/**
 * Verifica duplicidade estrutural (content_hash) consultando `rag_chunks`.
 *
 * @param {string} tenantId - ID do tenant
 * @param {string} contentHash - Hash do conteúdo normalizado
 * @param {string} sourceId - ID da fonte (opcional, para logs)
 * @returns {Promise<Object>} {isDuplicate: boolean, existingChunk?: Object, reason?: string}
 */
async function checkStructuralDuplicate(tenantId, contentHash, sourceId = null) {
  const sequelize = requireSequelize();
  const tenantKey = requireTenantKey(tenantId);

  const [rows] = await sequelize.query(
    `
      SELECT id, document_id, metadata
      FROM rag_chunks
      WHERE tenant_key = :tenantKey
        AND metadata->>'content_hash' = :contentHash
      LIMIT 1
    `,
    { replacements: { tenantKey, contentHash: safeString(contentHash) } }
  );

  const row = rows && rows[0];
  if (row) {
    const existingChunk = rowToExistingChunk(row);

    logger.info('[RAGDeduplication] Duplicidade estrutural detectada', {
      tenantId,
      contentHash: shortHash(contentHash),
      sourceId,
      existingChunkId: existingChunk.chunk_id,
      existingDocumentId: existingChunk.document_id,
      existingSourceId: existingChunk.source_id,
    });

    return {
      isDuplicate: true,
      existingChunk,
      reason: 'content_hash_duplicate',
    };
  }

  return { isDuplicate: false };
}

/**
 * Verifica duplicidade semântica (similaridade de embedding > 0.97) no Postgres.
 *
 * Estratégia:
 * 1. Match exato por `metadata->>'semantic_hash'` (apenas chunks ativos).
 * 2. Vizinho mais próximo via pgvector (`embedding <=> :queryVector`),
 *    similaridade = 1 - distância cosseno, apenas chunks ativos.
 *
 * @param {string} tenantId - ID do tenant
 * @param {Array<number>} embedding - Embedding normalizado
 * @param {string} semanticHash - Hash do embedding
 * @param {string} sourceId - ID da fonte (opcional, para logs)
 * @returns {Promise<Object>} {isDuplicate: boolean, existingChunk?: Object, similarity?: number, reason?: string}
 */
async function checkSemanticDuplicate(tenantId, embedding, semanticHash, sourceId = null) {
  const sequelize = requireSequelize();
  const tenantKey = requireTenantKey(tenantId);
  const normalizedEmbedding = normalizeEmbedding(embedding);

  // 1) Duplicata exata por semantic_hash (apenas chunks ativos)
  const [exactRows] = await sequelize.query(
    `
      SELECT id, document_id, metadata
      FROM rag_chunks
      WHERE tenant_key = :tenantKey
        AND metadata->>'semantic_hash' = :semanticHash
        AND COALESCE((metadata->>'active')::boolean, true)
      LIMIT 1
    `,
    { replacements: { tenantKey, semanticHash: safeString(semanticHash) } }
  );

  const exactRow = exactRows && exactRows[0];
  if (exactRow) {
    const existingChunk = rowToExistingChunk(exactRow);

    logger.info('[RAGDeduplication] Duplicidade semântica exata detectada (semantic_hash)', {
      tenantId,
      semanticHash: shortHash(semanticHash),
      sourceId,
      existingChunkId: existingChunk.chunk_id,
      existingDocumentId: existingChunk.document_id,
    });

    return {
      isDuplicate: true,
      existingChunk,
      similarity: 1.0,
      reason: 'semantic_hash_exact_duplicate',
    };
  }

  // 2) Vizinho mais próximo via pgvector (distância cosseno), apenas chunks ativos
  const q = embeddingToPgVectorLiteral(normalizedEmbedding);
  const [rows] = await sequelize.query(
    `
      SELECT
        id,
        document_id,
        metadata,
        (embedding <=> (:q)::vector) AS distance
      FROM rag_chunks
      WHERE tenant_key = :tenantKey
        AND COALESCE((metadata->>'active')::boolean, true)
      ORDER BY embedding <=> (:q)::vector
      LIMIT 1
    `,
    { replacements: { tenantKey, q } }
  );

  const row = rows && rows[0];
  const distance = row ? Number(row.distance) : null;
  const similarity = Number.isFinite(distance) ? 1 - distance : 0;

  // Threshold de 0.97 para considerar duplicata semântica
  if (row && similarity > 0.97) {
    const existingChunk = rowToExistingChunk(row);

    logger.info('[RAGDeduplication] Duplicidade semântica detectada (similaridade alta)', {
      tenantId,
      semanticHash: shortHash(semanticHash),
      sourceId,
      similarity,
      existingChunkId: existingChunk.chunk_id,
      existingDocumentId: existingChunk.document_id,
    });

    return {
      isDuplicate: true,
      existingChunk,
      similarity,
      reason: 'semantic_similarity_duplicate',
    };
  }

  return { isDuplicate: false, similarity };
}

/**
 * Registra chunk para deduplicação.
 *
 * DEPRECADO (no-op): os metadados de dedup agora vivem no JSONB `metadata` de
 * `rag_chunks`, escritos pelo próprio caminho de indexação — o Postgres é a
 * fonte da verdade. Mantido apenas para compatibilidade de assinatura com
 * callers existentes; valida os metadados obrigatórios e registra log.
 *
 * @param {string} tenantId - ID do tenant
 * @param {Object} chunkMetadata - Metadados do chunk
 * @param {Array<number>} embedding - Embedding do chunk (ignorado)
 */
function registerChunk(tenantId, chunkMetadata, embedding = null) {
  const {
    chunk_id,
    document_id,
    source_id,
    source_version,
    content_hash,
    semantic_hash,
  } = chunkMetadata || {};

  // Valida metadados obrigatórios (comportamento preservado)
  if (!chunk_id || !document_id || !source_id || !content_hash || !semantic_hash) {
    throw new Error('Metadados obrigatórios faltando: chunk_id, document_id, source_id, content_hash, semantic_hash');
  }

  logger.debug('[RAGDeduplication] registerChunk é no-op (dedup persistido em rag_chunks)', {
    tenantId,
    chunkId: safeString(chunk_id).substring(0, 16) + '...',
    documentId: document_id,
    sourceId: source_id,
    sourceVersion: source_version || 1,
    contentHash: shortHash(content_hash),
  });
}

/**
 * Marca versões anteriores de um source como inativas (metadata.active=false).
 *
 * @param {string} tenantId - ID do tenant
 * @param {string} sourceId - ID da fonte
 * @param {number} newVersion - Nova versão
 * @returns {Promise<void>}
 */
async function deactivatePreviousVersions(tenantId, sourceId, newVersion) {
  const sequelize = requireSequelize();
  const tenantKey = requireTenantKey(tenantId);

  const [, meta] = await sequelize.query(
    `
      UPDATE rag_chunks
      SET metadata = jsonb_set(metadata, '{active}', 'false'::jsonb, true)
      WHERE tenant_key = :tenantKey
        AND metadata->>'source_id' = :sourceId
        AND COALESCE((metadata->>'source_version')::int, 1) < :newVersion
        AND COALESCE((metadata->>'active')::boolean, true)
    `,
    {
      replacements: {
        tenantKey,
        sourceId: safeString(sourceId),
        newVersion: Number.isFinite(newVersion) ? newVersion : 1,
      },
    }
  );

  const deactivatedCount = meta && Number.isFinite(meta.rowCount) ? meta.rowCount : 0;
  if (deactivatedCount > 0) {
    logger.info('[RAGDeduplication] Versões anteriores desativadas', {
      tenantId,
      sourceId,
      newVersion,
      deactivatedCount,
    });
  }
}

/**
 * Obtém versão atual de um source (MAX(source_version) em rag_chunks).
 *
 * @param {string} tenantId - ID do tenant
 * @param {string} sourceId - ID da fonte
 * @returns {Promise<number>} Versão atual ou 1 se não existir
 */
async function getCurrentSourceVersion(tenantId, sourceId) {
  const sequelize = requireSequelize();
  const tenantKey = requireTenantKey(tenantId);

  const [[row]] = await sequelize.query(
    `
      SELECT MAX((metadata->>'source_version')::int) AS current_version
      FROM rag_chunks
      WHERE tenant_key = :tenantKey
        AND metadata->>'source_id' = :sourceId
    `,
    { replacements: { tenantKey, sourceId: safeString(sourceId) } }
  );

  const currentVersion = Number(row && row.current_version);
  return Number.isFinite(currentVersion) && currentVersion > 0 ? currentVersion : 1;
}

/**
 * Filtra chunks para recuperação (remove duplicatas e inativos).
 *
 * @param {string} tenantId - ID do tenant
 * @param {Array<Object>} chunks - Chunks recuperados
 * @returns {Array<Object>} Chunks filtrados (máximo 1 por source_id, apenas active=true)
 */
function filterChunksForRetrieval(tenantId, chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }

  // Filtra apenas chunks ativos
  const activeChunks = chunks.filter(chunk => {
    const metadata = chunk.metadata || {};
    // Chunks sem metadata.active são considerados ativos por padrão
    // Chunks sem tenant_id são considerados do tenant atual se não especificado
    const isActive = metadata.active !== false;
    const isTenantMatch = !metadata.tenant_id || metadata.tenant_id === tenantId;
    return isActive && isTenantMatch;
  });

  // Agrupa por source_id e mantém apenas o melhor de cada
  const sourceMap = new Map();
  let skippedCount = 0;

  for (const chunk of activeChunks) {
    const metadata = chunk.metadata || {};
    // Usa source_id se disponível, caso contrário usa document_id como fallback
    const sourceId = metadata.source_id || metadata.document_id || chunk.document_id || chunk.documentId || chunk.id || chunk.chunkId;

    if (!sourceId) {
      skippedCount++;
      logger.debug('[RAGDeduplication] Chunk sem source_id, pulando', {
        tenantId,
        chunkId: chunk.id || chunk.chunkId || 'unknown',
        hasMetadata: !!chunk.metadata,
        metadataKeys: chunk.metadata ? Object.keys(chunk.metadata) : [],
        chunkKeys: Object.keys(chunk),
      });
      continue;
    }

    const existing = sourceMap.get(sourceId);
    const score = chunk.score || chunk.similarity || 0;

    if (!existing || score > (existing.score || existing.similarity || 0)) {
      sourceMap.set(sourceId, chunk);
    }
  }

  const filtered = Array.from(sourceMap.values());

  logger.debug('[RAGDeduplication] Chunks filtrados para recuperação', {
    tenantId,
    originalCount: chunks.length,
    activeCount: activeChunks.length,
    filteredCount: filtered.length,
    sourcesCount: sourceMap.size,
    skippedCount,
  });

  return filtered;
}

/**
 * Limpa índices de um tenant.
 *
 * DEPRECADO (no-op): não há mais índices em memória — a fonte da verdade é
 * `rag_chunks` no Postgres. Mantido apenas para compatibilidade com testes
 * legados.
 *
 * @param {string} tenantId - ID do tenant
 */
function clearTenantIndices(tenantId) {
  logger.debug('[RAGDeduplication] clearTenantIndices é no-op (sem índices em memória)', { tenantId });
}

/**
 * Obtém estatísticas de deduplicação para um tenant via SQL (COUNT/GROUP BY).
 *
 * @param {string} tenantId - ID do tenant
 * @returns {Promise<Object>} Estatísticas
 */
async function getDeduplicationStats(tenantId) {
  const sequelize = requireSequelize();
  const tenantKey = requireTenantKey(tenantId);

  const [[row]] = await sequelize.query(
    `
      SELECT
        COUNT(*)::int AS total_chunks,
        COUNT(DISTINCT metadata->>'content_hash')::int AS total_content_hashes,
        COUNT(*) FILTER (WHERE COALESCE((metadata->>'active')::boolean, true))::int AS active_chunks,
        COUNT(*) FILTER (WHERE NOT COALESCE((metadata->>'active')::boolean, true))::int AS inactive_chunks,
        COUNT(DISTINCT metadata->>'source_id')::int AS total_sources
      FROM rag_chunks
      WHERE tenant_key = :tenantKey
    `,
    { replacements: { tenantKey } }
  );

  const [[multiRow]] = await sequelize.query(
    `
      SELECT COUNT(*)::int AS sources
      FROM (
        SELECT metadata->>'source_id' AS source_id
        FROM rag_chunks
        WHERE tenant_key = :tenantKey
        GROUP BY metadata->>'source_id'
        HAVING COUNT(DISTINCT metadata->>'source_version') > 1
      ) multi
    `,
    { replacements: { tenantKey } }
  );

  return {
    totalContentHashes: Number(row?.total_content_hashes || 0),
    totalChunks: Number(row?.total_chunks || 0),
    activeChunks: Number(row?.active_chunks || 0),
    inactiveChunks: Number(row?.inactive_chunks || 0),
    totalSources: Number(row?.total_sources || 0),
    sourcesWithMultipleVersions: Number(multiRow?.sources || 0),
  };
}

module.exports = {
  checkStructuralDuplicate,
  checkSemanticDuplicate,
  registerChunk,
  deactivatePreviousVersions,
  getCurrentSourceVersion,
  filterChunksForRetrieval,
  clearTenantIndices,
  getDeduplicationStats,
  // Exporta utilitários também
  normalizeContent,
  generateContentHash,
  generateContentHashSync,
  generateChunkId,
  generateSemanticHash,
  normalizeEmbedding,
  cosineSimilarity,
};
