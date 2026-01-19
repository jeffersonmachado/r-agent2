'use strict';

/**
 * Migration: Create quick_replies table (tenant_key-based)
 *
 * Replaces quickReplies.json with PostgreSQL persistence.
 */

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'quick_replies', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      title: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      tags: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      usage_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_by: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await addIndexIfNotExists(queryInterface, 'quick_replies', ['tenant_key', 'active'], {
      name: 'quick_replies_tenant_key_active_idx',
    });
    await addIndexIfNotExists(queryInterface, 'quick_replies', ['tenant_key', 'category'], {
      name: 'quick_replies_tenant_key_category_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('quick_replies');
  },
};

