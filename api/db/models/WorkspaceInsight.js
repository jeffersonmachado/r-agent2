'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let WorkspaceInsight = null;

function getWorkspaceInsightModel() {
  if (!WorkspaceInsight) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    WorkspaceInsight = sequelize.define('WorkspaceInsight', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      confidence: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0.5 },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
    }, {
      tableName: 'workspace_insights',
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'entity_id', 'created_at'], name: 'workspace_insights_tenant_entity_created_idx' },
        { fields: ['tenant_id', 'type'], name: 'workspace_insights_tenant_type_idx' },
      ],
    });
  }

  return WorkspaceInsight;
}

module.exports = getWorkspaceInsightModel;
