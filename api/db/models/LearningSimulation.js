'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LearningSimulation = null;

function getLearningSimulationModel() {
  if (!LearningSimulation) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    LearningSimulation = sequelize.define('LearningSimulation', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      journeyKey: { type: DataTypes.STRING, allowNull: false },
      seedType: { type: DataTypes.STRING, allowNull: false },
      personaKey: { type: DataTypes.STRING, allowNull: false },
      scenario: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      aiEnrichment: { type: DataTypes.JSONB, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'generated' },
      result: { type: DataTypes.JSONB, allowNull: true },
      createdBy: { type: DataTypes.STRING, allowNull: true },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'learning_simulations',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'journey_key'], name: 'ls_tenant_journey_idx' },
        { fields: ['tenant_id', 'created_at'], name: 'ls_tenant_created_idx' },
      ],
    });
  }

  return LearningSimulation;
}

module.exports = getLearningSimulationModel;
