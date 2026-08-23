'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const base = {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };
    await queryInterface.createTable('ai_providers', {
      ...base,
      key: { type: Sequelize.STRING, allowNull: false, unique: true },
      label: { type: Sequelize.STRING, allowNull: false },
      kind: { type: Sequelize.STRING, allowNull: false },
      base_url: { type: Sequelize.STRING, allowNull: false },
      default_model: { type: Sequelize.STRING, allowNull: false },
      models: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      validation_model: { type: Sequelize.STRING, allowNull: true },
      is_builtin: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
    }).catch((e) => { if (!/already exists/i.test(e.message)) throw e; });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('ai_providers').catch(() => {});
  },
};
