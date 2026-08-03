'use strict';

/**
 * Migration: índice vetorial de rag_chunks ivfflat -> HNSW
 *
 * Contexto (2026-08-03): o pgvector do ambiente é 0.6.0 (HNSW suportado).
 * HNSW lida melhor com filtros seletivos (tenant_key + domain +
 * classification, e agora também permissions/roles no SQL) e não depende de
 * probes por sessão — o knob de recall passa a ser hnsw.ef_search
 * (RAG_HNSW_EF_SEARCH, default 40) em rag-service/services/vector_store.py.
 *
 * Aditiva e idempotente (CREATE INDEX IF NOT EXISTS / DROP INDEX IF EXISTS).
 * O down recria o ivfflat original (lists = 100), como definido na migration
 * 20260122000003-enable-pgvector-and-create-rag-chunks.js.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS rag_chunks_embedding_hnsw_idx
      ON rag_chunks
      USING hnsw (embedding vector_cosine_ops);
    `);
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS rag_chunks_embedding_ivfflat_idx');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS rag_chunks_embedding_ivfflat_idx
      ON rag_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS rag_chunks_embedding_hnsw_idx');
  },
};
