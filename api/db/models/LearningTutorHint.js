'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LearningTutorHint = null;

function getLearningTutorHintModel() {
  if (!LearningTutorHint) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    LearningTutorHint = sequelize.define('LearningTutorHint', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      agentId: { type: DataTypes.STRING, allowNull: false },
      sessionId: { type: DataTypes.STRING, allowNull: true },
      route: { type: DataTypes.STRING, allowNull: false },
      level: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      trigger: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      hintText: { type: DataTypes.TEXT, allowNull: false },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'rag' },
      evidenceRefs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'learning_tutor_hints',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'agent_id', 'route', 'created_at'], name: 'lth_tenant_agent_route_idx' },
        { fields: ['tenant_id', 'route', 'created_at'], name: 'lth_tenant_route_idx' },
      ],
    });
  }

  return LearningTutorHint;
}

module.exports = getLearningTutorHintModel;
