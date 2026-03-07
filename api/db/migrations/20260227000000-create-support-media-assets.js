'use strict';

const { createTableIfNotExists, addIndexIfNotExists, indexExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'support_media_assets', {
      id: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_id: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      storage_name: {
        type: Sequelize.STRING,
        allowNull: false,
      },
      original_name: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      mime_type: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      size_bytes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      source: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      data: {
        type: Sequelize.BLOB('long'),
        allowNull: false,
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

    await addIndexIfNotExists(queryInterface, 'support_media_assets', ['tenant_id', 'storage_name'], {
      name: 'support_media_assets_tenant_storage_uq',
      unique: true,
    });

    await addIndexIfNotExists(queryInterface, 'support_media_assets', ['tenant_id'], {
      name: 'support_media_assets_tenant_idx',
    });
  },

  async down(queryInterface) {
    if (await indexExists(queryInterface, 'support_media_assets', 'support_media_assets_tenant_storage_uq')) {
      await queryInterface.removeIndex('support_media_assets', 'support_media_assets_tenant_storage_uq');
    }
    if (await indexExists(queryInterface, 'support_media_assets', 'support_media_assets_tenant_idx')) {
      await queryInterface.removeIndex('support_media_assets', 'support_media_assets_tenant_idx');
    }
    await queryInterface.dropTable('support_media_assets');
  },
};

