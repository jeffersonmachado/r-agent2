/**
 * Migration: Create flow_templates table (tenant_key-based)
 *
 * - tenant_key = 'system' representa templates globais
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'flow_templates', {
      id: { type: Sequelize.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      icon: { type: Sequelize.STRING, allowNull: false, defaultValue: '📋' },
      tags: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      flow: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      active: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: Sequelize.STRING, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'flow_templates', ['tenant_key', 'active'], {
      name: 'flow_templates_tenant_key_active_idx',
    });
    await addIndexIfNotExists(queryInterface, 'flow_templates', ['tenant_key', 'name'], {
      name: 'flow_templates_tenant_key_name_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('flow_templates');
  },
};

