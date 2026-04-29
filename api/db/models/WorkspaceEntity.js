'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let WorkspaceEntity = null;

function getWorkspaceEntityModel() {
  if (!WorkspaceEntity) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    WorkspaceEntity = sequelize.define('WorkspaceEntity', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'contact' },
      name: { type: DataTypes.STRING, allowNull: false },
      phone: { type: DataTypes.STRING, allowNull: true },
      email: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'workspace_entities',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'type'], name: 'workspace_entities_tenant_type_idx' },
        { fields: ['tenant_id', 'phone'], name: 'workspace_entities_tenant_phone_idx' },
        { fields: ['tenant_id', 'email'], name: 'workspace_entities_tenant_email_idx' },
        { fields: ['tenant_id', 'created_at'], name: 'workspace_entities_tenant_created_idx' },
      ],
    });
  }

  return WorkspaceEntity;
}

module.exports = getWorkspaceEntityModel;
