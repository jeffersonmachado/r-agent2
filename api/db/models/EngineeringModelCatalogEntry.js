'use strict';

/**
 * Model EngineeringModelCatalogEntry — ER-V1-FINAL-008 (Current Model Catalog).
 *
 * Um registro por `providerId:modelId` observado pelo discovery real fora da allowlist estática
 * (`engine/engineeringRouter/modelCapabilities.js`), ou de um modelo antes mapeado que o
 * discovery confirmou não estar mais listado pelo provider. Camada de auditoria/governança —
 * NUNCA a fonte de elegibilidade do Router (ver `engine/engineeringRouter/modelCatalogPolicy.js`).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let EngineeringModelCatalogEntry = null;

function getEngineeringModelCatalogEntryModel() {
  if (!EngineeringModelCatalogEntry) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    EngineeringModelCatalogEntry = sequelize.define('EngineeringModelCatalogEntry', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      provider_id: { type: DataTypes.STRING, allowNull: false },
      model_id: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false },
      capabilities: { type: DataTypes.JSONB, allowNull: true },
      roles: { type: DataTypes.JSONB, allowNull: true },
      evidence: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      first_discovered_at: { type: DataTypes.DATE, allowNull: false },
      last_seen_at: { type: DataTypes.DATE, allowNull: false },
      last_status_change_at: { type: DataTypes.DATE, allowNull: false },
    }, {
      tableName: 'engineering_model_catalog_entries',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['provider_id', 'model_id'], name: 'engineering_model_catalog_entries_provider_model_uidx', unique: true },
        { fields: ['status'], name: 'engineering_model_catalog_entries_status_idx' },
      ],
    });
  }
  return EngineeringModelCatalogEntry;
}

module.exports = getEngineeringModelCatalogEntryModel;
