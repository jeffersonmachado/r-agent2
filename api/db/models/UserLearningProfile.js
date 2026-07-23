'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let UserLearningProfile = null;

function getUserLearningProfileModel() {
  if (!UserLearningProfile) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    UserLearningProfile = sequelize.define('UserLearningProfile', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      agentId: { type: DataTypes.STRING, allowNull: false },
      summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      computedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'user_learning_profiles',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'agent_id'], name: 'ulp_tenant_agent_uq', unique: true },
      ],
    });
  }

  return UserLearningProfile;
}

module.exports = getUserLearningProfileModel;
