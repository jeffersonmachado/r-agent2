'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LearningRouteSkillMap = null;

function getLearningRouteSkillMapModel() {
  if (!LearningRouteSkillMap) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    LearningRouteSkillMap = sequelize.define('LearningRouteSkillMap', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      route: { type: DataTypes.STRING, allowNull: false },
      skillKey: { type: DataTypes.STRING, allowNull: false },
      source: { type: DataTypes.STRING, allowNull: false, defaultValue: 'static' },
      confidence: { type: DataTypes.FLOAT, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'learning_route_skill_map',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'route'], name: 'lrsm_tenant_route_uq', unique: true },
      ],
    });
  }

  return LearningRouteSkillMap;
}

module.exports = getLearningRouteSkillMapModel;
