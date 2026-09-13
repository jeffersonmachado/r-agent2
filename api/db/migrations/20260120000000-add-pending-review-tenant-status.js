/**
 * Migration: add 'pending_review' to tenants.status enum
 */

'use strict';

const logger = require('../../utils/logger');

module.exports = {
  async up(queryInterface) {
    // Postgres enum type name padrão do Sequelize: enum_<table>_<column>
    // Best-effort: se não for Postgres, ignora.
    try {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_tenants_status" ADD VALUE IF NOT EXISTS 'pending_review';`
      );
    } catch (err) {
      // Em ambientes não-Postgres ou se o tipo não existir, não bloqueia migração.
      // eslint-disable-next-line no-console
      logger.warn('[migration] Ignorando alteração de enum_tenants_status:', err.message);
    }
  },

  async down() {
    // Postgres não suporta remover enum value facilmente sem recriar o tipo.
    // No-op.
  },
};

