'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let WorkspaceTimelineEvent = null;

function getWorkspaceTimelineEventModel() {
  if (!WorkspaceTimelineEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    WorkspaceTimelineEvent = sequelize.define('WorkspaceTimelineEvent', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      entity_id: { type: DataTypes.UUID, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      ref_id: { type: DataTypes.STRING, allowNull: true },
      payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'workspace_timeline_events',
      timestamps: true,
      updatedAt: false,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'entity_id', 'created_at'], name: 'workspace_timeline_tenant_entity_created_idx' },
        { fields: ['tenant_id', 'type', 'created_at'], name: 'workspace_timeline_tenant_type_created_idx' },
        { fields: ['tenant_id', 'type', 'ref_id'], name: 'workspace_timeline_tenant_type_ref_idx' },
      ],
    });
  }

  return WorkspaceTimelineEvent;
}

module.exports = getWorkspaceTimelineEventModel;
