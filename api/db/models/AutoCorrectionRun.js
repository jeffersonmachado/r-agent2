'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AutoCorrectionRun = null;

function getAutoCorrectionRunModel() {
  if (!AutoCorrectionRun) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    AutoCorrectionRun = sequelize.define('AutoCorrectionRun', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      source_type: { type: DataTypes.STRING, allowNull: false },
      source_id: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'detected' },
      diagnosis: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      proposed_patch: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      validation_result: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'autocorrection_runs',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'source_type', 'source_id'], name: 'autocorrection_runs_tenant_source_idx' },
        { fields: ['tenant_id', 'status', 'created_at'], name: 'autocorrection_runs_tenant_status_created_idx' },
      ],
    });
  }

  return AutoCorrectionRun;
}

module.exports = getAutoCorrectionRunModel;