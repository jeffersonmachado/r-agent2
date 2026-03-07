'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'revenue_opportunities', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING(100), allowNull: false },
      type: { type: Sequelize.STRING(50), allowNull: false },
      entity_id: { type: Sequelize.STRING(100), allowNull: true },
      service_type: { type: Sequelize.STRING(100), allowNull: true },
      estimated_value: { type: Sequelize.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
      confidence: { type: Sequelize.DECIMAL(5, 4), allowNull: false, defaultValue: 0 },
      status: { type: Sequelize.STRING(30), allowNull: false, defaultValue: 'open' },
      metadata: { type: Sequelize.TEXT, allowNull: false, defaultValue: '{}' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });
    await addIndexIfNotExists(queryInterface, 'revenue_opportunities', ['tenant_key', 'status'], {
      name: 'revenue_opportunities_tenant_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'revenue_opportunities', ['tenant_key', 'type', 'entity_id', 'service_type', 'status'], {
      name: 'revenue_opportunities_dedupe_idx',
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('revenue_opportunities');
  },
};
