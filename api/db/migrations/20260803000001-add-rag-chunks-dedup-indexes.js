'use strict';

/**
 * Migration: índices de deduplicação do RAG em rag_chunks
 *
 * Contexto (2026-08-03): a deduplicação do rag-service deixou de usar
 * índices em memória (perdidos a cada restart) e passou a consultar o
 * Postgres diretamente. Os metadados de dedup (content_hash, source_id,
 * source_version, semantic_hash, active) vivem dentro do JSONB `metadata`
 * de rag_chunks, então são criados índices de expressão para sustentar:
 * - check_structural_duplicate: (tenant_key, metadata->>'content_hash')
 * - versionamento/desativação: (tenant_key, metadata->>'source_id')
 *
 * Aditiva e idempotente (CREATE INDEX IF NOT EXISTS).
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_content_hash
      ON rag_chunks (tenant_key, (metadata->>'content_hash'))
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_source_id
      ON rag_chunks (tenant_key, (metadata->>'source_id'))
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_rag_chunks_tenant_content_hash');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_rag_chunks_tenant_source_id');
  },
};
