'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let UserInteractionSession = null;

function getUserInteractionSessionModel() {
  if (!UserInteractionSession) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    UserInteractionSession = sequelize.define('UserInteractionSession', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      agentId: { type: DataTypes.STRING, allowNull: false },
      username: { type: DataTypes.STRING, allowNull: true },
      sessionId: { type: DataTypes.STRING, allowNull: false },
      startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      lastSeenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      eventCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      routesVisited: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'user_interaction_sessions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'agent_id'], name: 'uis_tenant_agent_idx' },
        { fields: ['tenant_id', 'session_id'], name: 'uis_tenant_session_idx', unique: true },
        { fields: ['tenant_id', 'last_seen_at'], name: 'uis_tenant_last_seen_idx' },
      ],
    });
  }

  return UserInteractionSession;
}

module.exports = getUserInteractionSessionModel;
