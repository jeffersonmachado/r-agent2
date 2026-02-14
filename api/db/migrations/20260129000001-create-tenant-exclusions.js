'use strict';

/**
 * Migration: Create tenant_exclusions table (tenant_id-based)
 *
 * Objetivo:
 * - Persistir termos de exclusão por tenant para reduzir ruído (OCR/scraping) ao longo do tempo.
 *
 * Campos (mínimos):
 * - tenant_id (string)
 * - term (string)
 * - created_at (timestamp)
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'tenant_exclusions', {
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      term: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Único por tenant: evita duplicação
    await addIndexIfNotExists(queryInterface, 'tenant_exclusions', ['tenant_id', 'term'], {
      unique: true,
      name: 'tenant_exclusions_unique',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_exclusions', ['tenant_id'], {
      name: 'tenant_exclusions_tenant_id_idx',
    });

    await addIndexIfNotExists(queryInterface, 'tenant_exclusions', ['created_at'], {
      name: 'tenant_exclusions_created_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_exclusions');
  },
};

