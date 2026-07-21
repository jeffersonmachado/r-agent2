'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AiGovernanceRecord = null;

function getAiGovernanceRecordModel() {
  if (!AiGovernanceRecord) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    AiGovernanceRecord = sequelize.define('AiGovernanceRecord', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      agentId: { type: DataTypes.UUID, allowNull: true },
      eventType: {
        type: DataTypes.ENUM('create', 'approve', 'reject', 'publish', 'deprecate', 'archive', 'execute', 'decision', 'audit'),
        allowNull: false,
      },
      actor: { type: DataTypes.STRING, allowNull: true },
      actorRole: { type: DataTypes.STRING, allowNull: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      decision: { type: DataTypes.JSONB, allowNull: true },
      dataAccessed: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      toolsUsed: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      cost: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      riskLevel: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        allowNull: false,
        defaultValue: 'low',
      },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'ai_governance_records',
      timestamps: true,
      underscored: true,
      updatedAt: false,
      indexes: [
        { fields: ['tenant_id'], name: 'ai_gov_tenant_idx' },
        { fields: ['agent_id'], name: 'ai_gov_agent_idx' },
        { fields: ['event_type'], name: 'ai_gov_event_type_idx' },
        { fields: ['created_at'], name: 'ai_gov_created_idx' },
      ],
    });
  }

  return AiGovernanceRecord;
}

module.exports = getAiGovernanceRecordModel;
