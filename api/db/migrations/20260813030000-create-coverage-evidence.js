'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'coverage_evidence', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      record: { type: Sequelize.JSONB, allowNull: false },
      hash: { type: Sequelize.STRING, allowNull: false },
      prev_hash: { type: Sequelize.STRING, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'coverage_evidence', ['hash'], {
      name: 'coverage_evidence_hash_idx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'coverage_evidence', ['prev_hash'], {
      name: 'coverage_evidence_prev_hash_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('coverage_evidence').catch(() => {});
  },
};
