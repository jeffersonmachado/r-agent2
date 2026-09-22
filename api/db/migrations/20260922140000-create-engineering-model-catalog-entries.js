/**
 * Migration: cria engineering_model_catalog_entries.
 *
 * ER-V1-FINAL-008 (Current Model Catalog): registro governado de todo `providerId:modelId` que
 * o discovery real já observou fora da allowlist estática (`modelCapabilities.js`), e do
 * status real (RETIRED) de um modelo antes mapeado que o provider deixou de listar. Nunca é a
 * fonte de elegibilidade do Router (isso continua sendo só a allowlist estática) — é a camada de
 * auditoria/governança sobre o que o discovery encontra, para que "modelo novo do provider"
 * nunca seja simplesmente descartado sem rastro nem vire elegível automaticamente.
 */

'use strict';

const { createTableIfNotExists, addIndexIfNotExists } = require('../migrations-helper');

module.exports = {
  async up(queryInterface, Sequelize) {
    await createTableIfNotExists(queryInterface, 'engineering_model_catalog_entries', {
      id: { type: Sequelize.UUID, allowNull: false, primaryKey: true, defaultValue: Sequelize.UUIDV4 },
      provider_id: { type: Sequelize.STRING, allowNull: false },
      model_id: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false },
      capabilities: { type: Sequelize.JSONB, allowNull: true },
      roles: { type: Sequelize.JSONB, allowNull: true },
      evidence: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      first_discovered_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      last_seen_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      last_status_change_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await addIndexIfNotExists(queryInterface, 'engineering_model_catalog_entries', ['provider_id', 'model_id'], {
      name: 'engineering_model_catalog_entries_provider_model_uidx',
      unique: true,
    });
    await addIndexIfNotExists(queryInterface, 'engineering_model_catalog_entries', ['status'], {
      name: 'engineering_model_catalog_entries_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('engineering_model_catalog_entries').catch(() => {});
  },
};
