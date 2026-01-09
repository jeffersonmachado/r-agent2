/**
 * Serviço de deduplicação RAG.
 * 
 * Responsabilidades:
 * - Verificar duplicidade estrutural (content_hash)
 * - Verificar duplicidade semântica (semantic_hash + cosine similarity)
 * - Gerenciar versionamento de documentos
 * - Registrar logs de auditoria
 * 
 * REGRAS:
 * - Toda deduplicação ocorre ANTES da recuperação
 * - Lógica determinística e reexecutável
 * - NÃO reindexa documentos existentes automaticamente
 * - NÃO remove dados históricos
 */

const logger = require('../utils/logger');
const {
  normalizeContent,
  generateContentHash,
  generateContentHashSync,
  generateChunkId,
  generateSemanticHash,
  normalizeEmbedding,
  cosineSimilarity,
} = require('../utils/contentNormalization');

// Storage em memória para metadados de chunks (em produção, usar Redis ou DB)
// Estrutura: Map<tenantId, Map<contentHash, metadata>>
const contentHashIndex = new Map();

// Estrutura: Map<tenantId, Map<chunkId, metadata>>
const chunkIndex = new Map();

// Estrutura: Map<tenantId, Map<sourceId, {currentVersion, versions: []}>>
const sourceVersionIndex = new Map();

/**
 * Inicializa índices para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 */
function initializeTenantIndices(tenantId) {
  if (!contentHashIndex.has(tenantId)) {
    contentHashIndex.set(tenantId, new Map());
  }
  if (!chunkIndex.has(tenantId)) {
    chunkIndex.set(tenantId, new Map());
  }
  if (!sourceVersionIndex.has(tenantId)) {
    sourceVersionIndex.set(tenantId, new Map());
  }
}

/**
 * Verifica duplicidade estrutural (content_hash).
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} contentHash - Hash do conteúdo normalizado
 * @param {string} sourceId - ID da fonte (opcional, para logs)
 * @returns {Object} {isDuplicate: boolean, existingChunk?: Object, reason?: string}
 */
function checkStructuralDuplicate(tenantId, contentHash, sourceId = null) {
  initializeTenantIndices(tenantId);
  
  const tenantContentHash = contentHashIndex.get(tenantId);
  const existing = tenantContentHash.get(contentHash);

  if (existing) {
    logger.info('[RAGDeduplication] Duplicidade estrutural detectada', {
      tenantId,
      contentHash: contentHash.substring(0, 16) + '...',
      sourceId,
      existingChunkId: existing.chunk_id,
      existingDocumentId: existing.document_id,
      existingSourceId: existing.source_id,
    });

    return {
      isDuplicate: true,
      existingChunk: existing,
      reason: 'content_hash_duplicate',
    };
  }

  return { isDuplicate: false };
}

/**
 * Verifica duplicidade semântica (similaridade de embedding > 0.97).
 * 
 * @param {string} tenantId - ID do tenant
 * @param {Array<number>} embedding - Embedding normalizado
 * @param {string} semanticHash - Hash do embedding
 * @param {string} sourceId - ID da fonte (opcional, para logs)
 * @returns {Promise<Object>} {isDuplicate: boolean, existingChunk?: Object, similarity?: number, reason?: string}
 */
async function checkSemanticDuplicate(tenantId, embedding, semanticHash, sourceId = null) {
  initializeTenantIndices(tenantId);
  
  const tenantChunks = chunkIndex.get(tenantId);
  const normalizedEmbedding = normalizeEmbedding(embedding);

  // Busca chunks do mesmo tenant
  let maxSimilarity = 0;
  let mostSimilarChunk = null;

  for (const [chunkId, chunkMetadata] of tenantChunks.entries()) {
    // Verifica se chunk está ativo
    if (!chunkMetadata.active) continue;

    // Se tem semantic_hash igual, é duplicata exata
    if (chunkMetadata.semantic_hash === semanticHash) {
      logger.info('[RAGDeduplication] Duplicidade semântica exata detectada (semantic_hash)', {
        tenantId,
        semanticHash: semanticHash.substring(0, 16) + '...',
        sourceId,
        existingChunkId: chunkId,
        existingDocumentId: chunkMetadata.document_id,
      });

      return {
        isDuplicate: true,
        existingChunk: chunkMetadata,
        similarity: 1.0,
        reason: 'semantic_hash_exact_duplicate',
      };
    }

    // Se tem embedding armazenado, calcula similaridade
    if (chunkMetadata.embedding && Array.isArray(chunkMetadata.embedding)) {
      try {
        const similarity = cosineSimilarity(normalizedEmbedding, chunkMetadata.embedding);
        
        if (similarity > maxSimilarity) {
          maxSimilarity = similarity;
          mostSimilarChunk = { ...chunkMetadata, chunk_id: chunkId };
        }
      } catch (err) {
        logger.warn('[RAGDeduplication] Erro ao calcular similaridade', {
          tenantId,
          chunkId,
          error: err.message,
        });
      }
    }
  }

  // Threshold de 0.97 para considerar duplicata semântica
  if (maxSimilarity > 0.97) {
    logger.info('[RAGDeduplication] Duplicidade semântica detectada (similaridade alta)', {
      tenantId,
      semanticHash: semanticHash.substring(0, 16) + '...',
      sourceId,
      similarity: maxSimilarity,
      existingChunkId: mostSimilarChunk.chunk_id,
      existingDocumentId: mostSimilarChunk.document_id,
    });

    return {
      isDuplicate: true,
      existingChunk: mostSimilarChunk,
      similarity: maxSimilarity,
      reason: 'semantic_similarity_duplicate',
    };
  }

  return { isDuplicate: false, similarity: maxSimilarity };
}

/**
 * Registra chunk nos índices de deduplicação.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {Object} chunkMetadata - Metadados do chunk
 * @param {Array<number>} embedding - Embedding do chunk (opcional, para similaridade futura)
 */
function registerChunk(tenantId, chunkMetadata, embedding = null) {
  initializeTenantIndices(tenantId);

  const {
    chunk_id,
    document_id,
    source_id,
    source_version,
    content_hash,
    semantic_hash,
    active = true,
  } = chunkMetadata;

  // Valida metadados obrigatórios
  if (!chunk_id || !document_id || !source_id || !content_hash || !semantic_hash) {
    throw new Error('Metadados obrigatórios faltando: chunk_id, document_id, source_id, content_hash, semantic_hash');
  }

  const metadata = {
    tenant_id: tenantId,
    chunk_id,
    document_id,
    source_id,
    source_version: source_version || 1,
    content_hash,
    semantic_hash,
    active,
    created_at: chunkMetadata.created_at || new Date().toISOString(),
    embedding: embedding ? normalizeEmbedding(embedding) : null, // Armazena normalizado
  };

  // Registra no índice de content_hash
  const tenantContentHash = contentHashIndex.get(tenantId);
  tenantContentHash.set(content_hash, metadata);

  // Registra no índice de chunk_id
  const tenantChunks = chunkIndex.get(tenantId);
  tenantChunks.set(chunk_id, metadata);

  // Atualiza versionamento de source
  const tenantSources = sourceVersionIndex.get(tenantId);
  if (!tenantSources.has(source_id)) {
    tenantSources.set(source_id, {
      currentVersion: source_version || 1,
      versions: [],
    });
  }

  const sourceInfo = tenantSources.get(source_id);
  if (source_version && source_version > sourceInfo.currentVersion) {
    // Nova versão: marca versões anteriores como inativas
    for (const [chunkId, chunkMeta] of tenantChunks.entries()) {
      if (chunkMeta.source_id === source_id && chunkMeta.source_version < source_version) {
        chunkMeta.active = false;
        tenantChunks.set(chunkId, chunkMeta);
      }
    }
    sourceInfo.currentVersion = source_version;
  }

  if (!sourceInfo.versions.includes(source_version || 1)) {
    sourceInfo.versions.push(source_version || 1);
  }

  logger.debug('[RAGDeduplication] Chunk registrado', {
    tenantId,
    chunkId: chunk_id.substring(0, 16) + '...',
    documentId: document_id,
    sourceId: source_id,
    sourceVersion: source_version || 1,
    contentHash: content_hash.substring(0, 16) + '...',
  });
}

/**
 * Marca versões anteriores de um source como inativas.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} sourceId - ID da fonte
 * @param {number} newVersion - Nova versão
 */
function deactivatePreviousVersions(tenantId, sourceId, newVersion) {
  initializeTenantIndices(tenantId);
  
  const tenantChunks = chunkIndex.get(tenantId);
  let deactivatedCount = 0;

  for (const [chunkId, chunkMeta] of tenantChunks.entries()) {
    if (chunkMeta.source_id === sourceId && chunkMeta.source_version < newVersion && chunkMeta.active) {
      chunkMeta.active = false;
      tenantChunks.set(chunkId, chunkMeta);
      deactivatedCount++;
    }
  }

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
 * Obtém versão atual de um source.
 * 
 * @param {string} tenantId - ID do tenant
 * @param {string} sourceId - ID da fonte
 * @returns {number} Versão atual ou 1 se não existir
 */
function getCurrentSourceVersion(tenantId, sourceId) {
  initializeTenantIndices(tenantId);
  
  const tenantSources = sourceVersionIndex.get(tenantId);
  const sourceInfo = tenantSources.get(sourceId);
  
  return sourceInfo ? sourceInfo.currentVersion : 1;
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
 * Limpa índices de um tenant (útil para testes).
 * 
 * @param {string} tenantId - ID do tenant
 */
function clearTenantIndices(tenantId) {
  contentHashIndex.delete(tenantId);
  chunkIndex.delete(tenantId);
  sourceVersionIndex.delete(tenantId);
  
  logger.info('[RAGDeduplication] Índices limpos para tenant', { tenantId });
}

/**
 * Obtém estatísticas de deduplicação para um tenant.
 * 
 * @param {string} tenantId - ID do tenant
 * @returns {Object} Estatísticas
 */
function getDeduplicationStats(tenantId) {
  initializeTenantIndices(tenantId);
  
  const tenantContentHash = contentHashIndex.get(tenantId);
  const tenantChunks = chunkIndex.get(tenantId);
  const tenantSources = sourceVersionIndex.get(tenantId);

  const activeChunks = Array.from(tenantChunks.values()).filter(c => c.active);
  const inactiveChunks = Array.from(tenantChunks.values()).filter(c => !c.active);

  return {
    totalContentHashes: tenantContentHash.size,
    totalChunks: tenantChunks.size,
    activeChunks: activeChunks.length,
    inactiveChunks: inactiveChunks.length,
    totalSources: tenantSources.size,
    sourcesWithMultipleVersions: Array.from(tenantSources.values()).filter(s => s.versions.length > 1).length,
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
