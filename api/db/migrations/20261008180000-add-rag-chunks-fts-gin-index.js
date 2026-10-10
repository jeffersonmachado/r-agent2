'use strict';

/**
 * Migration: índice GIN de Full-Text Search em rag_chunks (busca híbrida, FASE 5).
 *
 * Contexto (2026-10-08): o retrieval era somente vetorial. Termo exato —
 * identificador, sigla, nome de função, rótulo de tela — pode ter similaridade
 * de embedding baixa e ficar fora do top-k mesmo estando no corpus. A busca
 * lexical fecha esse buraco e é fundida à semântica por RRF
 * (`rag-service/services/hybrid_search.py`).
 *
 * O índice é de EXPRESSÃO, com a mesma configuração usada na consulta
 * (`to_tsvector('portuguese', content)`), senão o planejador não o usa. A
 * configuração `portuguese` já existe no cluster (pg_ts_config); nenhuma
 * extensão nova é necessária (pg_trgm/unaccent seguem NÃO instalados e só
 * entrariam com ganho medido).
 *
 * Aditiva e idempotente; o `down` remove apenas o índice criado aqui.
 */

module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      CREATE INDEX IF NOT EXISTS idx_rag_chunks_fts_portuguese
      ON rag_chunks
      USING gin (to_tsvector('portuguese', content));
    `);
    await queryInterface.sequelize.query('ANALYZE rag_chunks;');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_rag_chunks_fts_portuguese;');
  },
};
