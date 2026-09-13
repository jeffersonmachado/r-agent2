'use strict';

const logger = require('../../utils/logger');

/**
 * Migration: Corrige drift de schema em access_decisions.signature
 *
 * Contexto (falha observada 2026-07-26, smoke prod-like QA Waves):
 * - O model AccessDecision e a migration original
 *   (20260314130000-create-access-control-core.js) declaram
 *   `signature: TEXT`, mas bancos criados por caminhos antigos ficaram com
 *   `character varying(255)`.
 * - A assinatura da decisão (token assinado) excede 255 caracteres, e o
 *   INSERT falhava com `value too long for type character varying(255)`,
 *   derrubando POST /api/access-control/decisions/resolve com HTTP 500
 *   sempre que a decisão era `allow` (fitness check-in determinístico).
 * - Aditiva e idempotente: widening de varchar(255) para TEXT não destrói
 *   dados; se a coluna já estiver em TEXT, a migration é no-op.
 */

const { tableExists } = require('../migrations-helper');

const TABLE = 'access_decisions';
const COLUMN = 'signature';

async function columnType(queryInterface) {
  const [rows] = await queryInterface.sequelize.query(
    `SELECT data_type, character_maximum_length
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = '${TABLE}'
        AND column_name = '${COLUMN}'`
  );
  return rows[0] || null;
}

module.exports = {
  async up(queryInterface) {
    if (!(await tableExists(queryInterface, TABLE))) {
      logger.info(`[Migration] Tabela ${TABLE} não existe, pulando (criada pela migration 20260314130000)`);
      return;
    }

    const column = await columnType(queryInterface);
    if (!column) {
      logger.info(`[Migration] Coluna ${TABLE}.${COLUMN} não existe, pulando`);
      return;
    }
    if (column.data_type === 'text') {
      logger.info(`[Migration] ${TABLE}.${COLUMN} já é TEXT, pulando`);
      return;
    }

    await queryInterface.sequelize.query(
      `ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} TYPE TEXT`
    );
    logger.info(`[Migration] ${TABLE}.${COLUMN} alterada de ${column.data_type}(${column.character_maximum_length}) para TEXT`);
  },

  async down(queryInterface) {
    if (!(await tableExists(queryInterface, TABLE))) return;

    const column = await columnType(queryInterface);
    if (!column || column.data_type !== 'text') return;

    const [oversized] = await queryInterface.sequelize.query(
      `SELECT 1 FROM ${TABLE} WHERE length(${COLUMN}) > 255 LIMIT 1`
    );
    if (oversized.length > 0) {
      throw new Error(
        `[Migration] ${TABLE}.${COLUMN} contém valores com mais de 255 caracteres; `
        + 'não é possível reverter para varchar(255) sem destruir dados'
      );
    }

    await queryInterface.sequelize.query(
      `ALTER TABLE ${TABLE} ALTER COLUMN ${COLUMN} TYPE character varying(255)`
    );
    logger.info(`[Migration] ${TABLE}.${COLUMN} revertida para varchar(255)`);
  },
};
