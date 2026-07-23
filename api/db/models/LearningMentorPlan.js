'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let LearningMentorPlan = null;

function getLearningMentorPlanModel() {
  if (!LearningMentorPlan) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    LearningMentorPlan = sequelize.define('LearningMentorPlan', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      agentId: { type: DataTypes.STRING, allowNull: false },
      // Agregados determinísticos (janelas 7/30/90 dias) — insumo do plano.
      aggregates: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      // Plano gerado por IA sobre os agregados (competências sugeridas,
      // objetivos, indicadores).
      plan: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      generatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'learning_mentor_plans',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'agent_id', 'generated_at'], name: 'lmp_tenant_agent_generated_idx' },
      ],
    });
  }

  return LearningMentorPlan;
}

module.exports = getLearningMentorPlanModel;
