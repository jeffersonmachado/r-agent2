'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'runtime_artifacts', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      kind: { type: Sequelize.STRING, allowNull: false },
      ref_id: { type: Sequelize.STRING, allowNull: false },
      content_jsonb: { type: Sequelize.JSONB, allowNull: true },
      content_text: { type: Sequelize.TEXT, allowNull: true },
      size_bytes: { type: Sequelize.BIGINT, allowNull: false, defaultValue: 0 },
      sha256: { type: Sequelize.STRING, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'runtime_artifacts', ['tenant_key', 'kind', 'ref_id'], {
      name: 'runtime_artifacts_tenant_kind_ref_idx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'runtime_artifacts', ['tenant_key', 'kind', 'created_at'], {
      name: 'runtime_artifacts_tenant_kind_created_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('runtime_artifacts').catch(() => {});
  },
};
