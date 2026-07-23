'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LearningMission = null;

function getLearningMissionModel() {
  if (!LearningMission) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    LearningMission = sequelize.define('LearningMission', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      // null = missão disponível para todos os usuários do tenant
      agentId: { type: DataTypes.STRING, allowNull: true },
      journeyKey: { type: DataTypes.STRING, allowNull: true },
      title: { type: DataTypes.STRING, allowNull: false },
      summary: { type: DataTypes.TEXT, allowNull: true },
      ragDocumentId: { type: DataTypes.STRING, allowNull: true },
      replayId: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'available' },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      completedBy: { type: DataTypes.STRING, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'learning_missions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'agent_id', 'status'], name: 'lm_tenant_agent_status_idx' },
        { fields: ['tenant_id', 'journey_key'], name: 'lm_tenant_journey_idx' },
      ],
    });
  }

  return LearningMission;
}

module.exports = getLearningMissionModel;
