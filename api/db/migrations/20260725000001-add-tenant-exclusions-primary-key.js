'use strict';

/**
 * Migration: Adiciona PRIMARY KEY (tenant_id, term) em tenant_exclusions
 *
 * Contexto (Database Integrity Wave, 2026-07-25):
 * - O model TenantExclusion declara PK composta (tenant_id, term), mas a
 *   migration original (20260129000001-create-tenant-exclusions.js) criou a
 *   tabela sem PK — apenas o índice único `tenant_exclusions_unique`.
 * - Aditiva e idempotente: só executa se a tabela existir e ainda não houver
 *   PK; aborta com erro explícito se houver duplicatas (não destrói dados).
 * - Quando o índice único já existe, promove-o a PK via
 *   `ADD CONSTRAINT ... PRIMARY KEY USING INDEX` (instantâneo, sem rebuild).
 */

const { tableExists, indexExists } = require('../migrations-helper');

const TABLE = 'tenant_exclusions';
const UNIQUE_INDEX = 'tenant_exclusions_unique';

module.exports = {
  async up(queryInterface) {
    if (!(await tableExists(queryInterface, TABLE))) {
      console.log(`[Migration] Tabela ${TABLE} não existe, pulando (criada pela migration 20260129000001)`);
      return;
    }

    const [pkRows] = await queryInterface.sequelize.query(
      `SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_type = 'PRIMARY KEY'
          AND table_schema = current_schema()
          AND table_name = '${TABLE}'`
    );
    if (pkRows.length > 0) {
      console.log(`[Migration] ${TABLE} já possui PRIMARY KEY, pulando`);
      return;
    }

    const [duplicates] = await queryInterface.sequelize.query(
      `SELECT tenant_id, term, COUNT(*) AS c FROM ${TABLE}
        GROUP BY tenant_id, term HAVING COUNT(*) > 1 LIMIT 1`
    );
    if (duplicates.length > 0) {
      throw new Error(
        `[Migration] ${TABLE} contém duplicatas em (tenant_id, term); `
        + 'regularize os dados antes de adicionar a PRIMARY KEY'
      );
    }

    if (await indexExists(queryInterface, TABLE, UNIQUE_INDEX)) {
      await queryInterface.sequelize.query(
        `ALTER TABLE ${TABLE}
         ADD CONSTRAINT ${TABLE}_pkey PRIMARY KEY USING INDEX ${UNIQUE_INDEX}`
      );
    } else {
      await queryInterface.sequelize.query(
        `ALTER TABLE ${TABLE}
         ADD CONSTRAINT ${TABLE}_pkey PRIMARY KEY (tenant_id, term)`
      );
    }
    console.log(`[Migration] PRIMARY KEY (tenant_id, term) adicionada em ${TABLE}`);
  },

  async down(queryInterface) {
    if (!(await tableExists(queryInterface, TABLE))) return;
    await queryInterface.sequelize.query(
      `ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${TABLE}_pkey`
    );
  },
};
