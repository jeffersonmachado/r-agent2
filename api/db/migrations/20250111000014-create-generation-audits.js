/**
 * Migration: Create generation_audits table
 *
 * Stores metadata of flow/RPA generations for governance without filesystem dependency.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'generation_audits', {
      audit_id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      flow_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      rpa_test_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      sources: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      data: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await addIndexIfNotExists(queryInterface, 'generation_audits', ['tenant_key', 'timestamp'], {
      name: 'generation_audits_tenant_key_timestamp_idx',
    });
    await addIndexIfNotExists(queryInterface, 'generation_audits', ['flow_id'], {
      name: 'generation_audits_flow_id_idx',
    });
    await addIndexIfNotExists(queryInterface, 'generation_audits', ['rpa_test_id'], {
      name: 'generation_audits_rpa_test_id_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('generation_audits');
  },
};

