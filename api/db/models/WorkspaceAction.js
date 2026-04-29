'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let WorkspaceAction = null;

function getWorkspaceActionModel() {
  if (!WorkspaceAction) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    WorkspaceAction = sequelize.define('WorkspaceAction', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'pending' },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'workspace_actions',
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'entity_id', 'created_at'], name: 'workspace_actions_tenant_entity_created_idx' },
        { fields: ['tenant_id', 'status'], name: 'workspace_actions_tenant_status_idx' },
        { fields: ['tenant_id', 'type'], name: 'workspace_actions_tenant_type_idx' },
      ],
    });
  }

  return WorkspaceAction;
}

module.exports = getWorkspaceActionModel;
