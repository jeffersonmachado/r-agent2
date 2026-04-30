'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AutoCorrectionAction = null;

function getAutoCorrectionActionModel() {
  if (!AutoCorrectionAction) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    AutoCorrectionAction = sequelize.define('AutoCorrectionAction', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      run_id: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'autocorrection_actions',
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        { fields: ['run_id', 'created_at'], name: 'autocorrection_actions_run_created_idx' },
        { fields: ['type', 'status'], name: 'autocorrection_actions_type_status_idx' },
      ],
    });
  }

  return AutoCorrectionAction;
}

module.exports = getAutoCorrectionActionModel;