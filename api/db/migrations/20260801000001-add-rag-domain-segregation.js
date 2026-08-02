'use strict';

/**
 * Migration: segregação de domínios do RAG (OPERATIONAL vs SYSTEM)
 *
 * Contexto (RAG Domain Segregation, 2026-08-01):
 * - O RAP possui dois domínios de conhecimento: OPERATIONAL (conteúdo de
 *   negócio, por tenant) e SYSTEM (conteúdo técnico SUPPORT/DEVELOPMENT).
 * - Até aqui rag_documents/rag_chunks não tinham domain/classification/
 *   sensitivity, impossibilitando filtro obrigatório ANTES da busca vetorial.
 * - Aditiva e idempotente: colunas novas com defaults seguros. Todo o conteúdo
 *   existente é operacional (nenhum conteúdo SYSTEM é indexado hoje), então o
 *   backfill via DEFAULT 'OPERATIONAL'/'PRODUCTION'/'INTERNAL' é correto.
 * - Índice composto (tenant_key, domain, classification) sustenta o filtro
 *   obrigatório do vector store sem varredura.
 */

const DOMAIN_VALUES = ['OPERATIONAL', 'SYSTEM'];
const CLASSIFICATION_VALUES = ['PRODUCTION', 'SUPPORT', 'DEVELOPMENT'];
const SENSITIVITY_VALUES = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

async function addColumnIfMissing(queryInterface, table, column, definition) {
  const description = await queryInterface.describeTable(table);
  if (!description[column]) {
    await queryInterface.addColumn(table, column, definition);
  }
}

async function removeColumnIfPresent(queryInterface, table, column) {
  const description = await queryInterface.describeTable(table);
  if (description[column]) {
    await queryInterface.removeColumn(table, column);
  }
}

module.exports = {
  DOMAIN_VALUES,
  CLASSIFICATION_VALUES,
  SENSITIVITY_VALUES,

  async up(queryInterface, Sequelize) {
    for (const table of ['rag_documents', 'rag_chunks']) {
      await addColumnIfMissing(queryInterface, table, 'domain', {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'OPERATIONAL',
      });
      await addColumnIfMissing(queryInterface, table, 'classification', {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'PRODUCTION',
      });
      await addColumnIfMissing(queryInterface, table, 'sensitivity', {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'INTERNAL',
      });

      await queryInterface.sequelize.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_domain_check
        CHECK (domain IN ('OPERATIONAL', 'SYSTEM'))
      `).catch(async (err) => {
        if (!/already exists/i.test(err.message)) throw err;
      });
      await queryInterface.sequelize.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_classification_check
        CHECK (classification IN ('PRODUCTION', 'SUPPORT', 'DEVELOPMENT'))
      `).catch(async (err) => {
        if (!/already exists/i.test(err.message)) throw err;
      });
      await queryInterface.sequelize.query(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${table}_sensitivity_check
        CHECK (sensitivity IN ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'))
      `).catch(async (err) => {
        if (!/already exists/i.test(err.message)) throw err;
      });
    }

    const { addIndexIfNotExists } = require('../migrations-helper');
    await addIndexIfNotExists(queryInterface, 'rag_chunks', ['tenant_key', 'domain', 'classification'], {
      name: 'idx_rag_chunks_tenant_domain_classification',
    });
    await addIndexIfNotExists(queryInterface, 'rag_documents', ['tenant_key', 'domain', 'classification'], {
      name: 'idx_rag_documents_tenant_domain_classification',
    });
  },

  async down(queryInterface) {
    for (const table of ['rag_documents', 'rag_chunks']) {
      await queryInterface.sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_domain_check`);
      await queryInterface.sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_classification_check`);
      await queryInterface.sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_sensitivity_check`);
      await removeColumnIfPresent(queryInterface, table, 'domain');
      await removeColumnIfPresent(queryInterface, table, 'classification');
      await removeColumnIfPresent(queryInterface, table, 'sensitivity');
    }
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_rag_chunks_tenant_domain_classification');
    await queryInterface.sequelize.query('DROP INDEX IF EXISTS idx_rag_documents_tenant_domain_classification');
  },
};
