'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'marketing_links', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING, allowNull: false },
      target_url: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      source: { type: Sequelize.STRING, allowNull: true },
      campaign: { type: Sequelize.STRING, allowNull: true },
      medium: { type: Sequelize.STRING, allowNull: true },
      content: { type: Sequelize.STRING, allowNull: true },
      term: { type: Sequelize.STRING, allowNull: true },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      click_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await addIndexIfNotExists(queryInterface, 'marketing_links', ['tenant_key', 'status'], {
      name: 'marketing_links_tenant_status_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_links', ['tenant_key', 'code'], {
      name: 'marketing_links_tenant_code_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_links', ['code'], {
      name: 'marketing_links_code_uq',
      unique: true,
    });

    await createTableIfNotExists(queryInterface, 'marketing_link_clicks', {
      id: { type: Sequelize.STRING, allowNull: false, primaryKey: true },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      link_id: { type: Sequelize.STRING, allowNull: false },
      code: { type: Sequelize.STRING, allowNull: false },
      target_url: { type: Sequelize.TEXT, allowNull: false },
      source: { type: Sequelize.STRING, allowNull: true },
      campaign: { type: Sequelize.STRING, allowNull: true },
      medium: { type: Sequelize.STRING, allowNull: true },
      content: { type: Sequelize.STRING, allowNull: true },
      term: { type: Sequelize.STRING, allowNull: true },
      ip: { type: Sequelize.STRING, allowNull: true },
      user_agent: { type: Sequelize.TEXT, allowNull: true },
      referrer: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false },
      updated_at: { type: Sequelize.DATE, allowNull: false },
    });

    await addIndexIfNotExists(queryInterface, 'marketing_link_clicks', ['tenant_key', 'link_id'], {
      name: 'marketing_link_clicks_tenant_link_idx',
    });
    await addIndexIfNotExists(queryInterface, 'marketing_link_clicks', ['tenant_key', 'code'], {
      name: 'marketing_link_clicks_tenant_code_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('marketing_link_clicks').catch(() => {});
    await queryInterface.dropTable('marketing_links').catch(() => {});
  },
};
