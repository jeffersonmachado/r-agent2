'use strict';

/**
 * Migration: habilita pgvector + cria tabela rag_chunks (tenant_key-based)
 *
 * Objetivo:
 * - Postgres vira fonte única para embeddings (pgvector)
 * - Multi-tenant: todas as linhas são particionadas por tenant_key
 *
 * Observações:
 * - EMBEDDING_DIM é resolvida em runtime da migration via env (fallback: 384),
 *   para manter compatibilidade com o embedding padrão do rag-service (SentenceTransformers).
 * - Para mudar a dimensão depois, é necessário uma migration adicional.
 */

function resolveEmbeddingDim() {
  const raw = process.env.EMBEDDING_DIM || process.env.RAG_EMBEDDING_DIM || '384';
  const dim = parseInt(String(raw), 10);
  if (!Number.isFinite(dim) || dim <= 0) return 384;
  return dim;
}

module.exports = {
  async up(queryInterface) {
    const dim = resolveEmbeddingDim();

    // Habilita extensões necessárias
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS vector;');

    // Tabela de chunks vetorizados
    await queryInterface.sequelize.query(`
      CREATE TABLE IF NOT EXISTS rag_chunks (
        id TEXT PRIMARY KEY,
        tenant_key TEXT NOT NULL,
        document_id TEXT NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding vector(${dim}) NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    // Índices (tenant + FK + busca por documento)
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_key ON rag_chunks (tenant_key);
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id ON rag_chunks (document_id);
    `);
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant_key_document_id ON rag_chunks (tenant_key, document_id);
    `);

    // Índice vetorial (ivfflat) para cosine distance (<=>)
    // Nota: ivfflat é a escolha "segura" por compatibilidade com versões mais antigas do pgvector.
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS rag_chunks_embedding_ivfflat_idx
      ON rag_chunks
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `);
  },

  async down(queryInterface) {
    // Remove tabela (cascateia índices)
    await queryInterface.sequelize.query('DROP TABLE IF EXISTS rag_chunks;');
    // Não removemos a extensão "vector" no down para evitar quebrar outras features.
  },
};

