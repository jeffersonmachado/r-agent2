const logger = require('../../utils/logger');
const { safeErrorMessage } = require('../../utils/defensiveCoercion');

const postgresVectorStore = require('../vectorStore/postgresVectorStore');

async function getDocumentsStats(tenantId = null, documentsCache) {
  let docs = Array.from(documentsCache.values());

  if (tenantId) {
    docs = docs.filter((document) => document.tenantId === tenantId);
  }

  const stats = {
    total: docs.length,
    indexed: docs.filter((document) => document.indexed).length,
    notIndexed: docs.filter((document) => !document.indexed).length,
    bySource: {},
    byCategory: {},
    byStatus: {},
    totalChunks: 0,
    vectorStoreStats: null,
    syncStatus: null,
  };

  docs.forEach((document) => {
    const source = document.metadata?.source || 'unknown';
    const category = document.metadata?.category || 'uncategorized';
    const status = document.status || 'active';

    stats.bySource[source] = (stats.bySource[source] || 0) + 1;
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
    stats.totalChunks += document.chunksCount || 0;
  });

  try {
    const vectorCounts = await postgresVectorStore.countVectorDocs({ tenantId: tenantId || null });
    stats.vectorStoreStats = {
      vectorStore: 'postgres',
      indexedDocuments: vectorCounts.documents || 0,
      indexedChunks: vectorCounts.chunks || 0,
      tenantId: tenantId || null,
    };

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
  } catch (error) {
    stats.vectorStoreStats = {
      vectorStore: 'postgres',
      indexedDocuments: 0,
      indexedChunks: 0,
      tenantId: tenantId || null,
      error: safeErrorMessage(error),
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
    vectorStoreError: stats.vectorStoreStats?.error || null,
  });

  return stats;
}

module.exports = {
  getDocumentsStats,
};
