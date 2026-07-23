'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let UserCompetency = null;

function getUserCompetencyModel() {
  if (!UserCompetency) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    UserCompetency = sequelize.define('UserCompetency', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      agentId: { type: DataTypes.STRING, allowNull: false },
      skillKey: { type: DataTypes.STRING, allowNull: false },
      score: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
      components: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      evidenceRefs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      eventCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      firstSeenAt: { type: DataTypes.DATE, allowNull: true },
      lastSeenAt: { type: DataTypes.DATE, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'user_competencies',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'agent_id', 'skill_key'], name: 'uc_tenant_agent_skill_uq', unique: true },
        { fields: ['tenant_id', 'skill_key'], name: 'uc_tenant_skill_idx' },
      ],
    });
  }

  return UserCompetency;
}

module.exports = getUserCompetencyModel;
