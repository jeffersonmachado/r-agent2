'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let WorkspaceEntityLink = null;

function getWorkspaceEntityLinkModel() {
  if (!WorkspaceEntityLink) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize nao inicializado. Chame connect() primeiro.'); } });
    }

    WorkspaceEntityLink = sequelize.define('WorkspaceEntityLink', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: false },
      source_type: { type: DataTypes.STRING, allowNull: false },
      source_id: { type: DataTypes.STRING, allowNull: false },
      confidence: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 1 },
    }, {
      tableName: 'workspace_entity_links',
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'entity_id', 'source_type'], name: 'workspace_links_tenant_entity_type_idx' },
        { fields: ['tenant_id', 'source_type', 'source_id'], unique: true, name: 'workspace_links_tenant_source_unique' },
      ],
    });
  }
  return WorkspaceEntityLink;
}

module.exports = getWorkspaceEntityLinkModel;
