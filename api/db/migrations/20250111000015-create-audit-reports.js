/**
 * Migration: Create audit_reports table
 *
 * Stores generated audit reports (JSON/text) without filesystem dependency.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'audit_reports', {
      report_id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      audit_id: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      generated_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      format: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'json',
      },
      data: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      text: {
        type: Sequelize.TEXT,
        allowNull: true,
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

    await addIndexIfNotExists(queryInterface, 'audit_reports', ['audit_id', 'generated_at'], {
      name: 'audit_reports_audit_id_generated_at_idx',
    });
    await addIndexIfNotExists(queryInterface, 'audit_reports', ['generated_at'], {
      name: 'audit_reports_generated_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_reports');
  },
};

