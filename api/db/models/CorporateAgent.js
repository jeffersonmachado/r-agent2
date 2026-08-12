'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CorporateAgent = null;

function getCorporateAgentModel() {
  if (!CorporateAgent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    CorporateAgent = sequelize.define('CorporateAgent', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      owner: { type: DataTypes.STRING, allowNull: true },
      department: { type: DataTypes.STRING, allowNull: true },
      version: { type: DataTypes.STRING, allowNull: false, defaultValue: '1.0.0' },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'draft' },
      classification: {
        type: DataTypes.ENUM('PRODUCTION', 'SUPPORT', 'DEVELOPMENT'),
        allowNull: false,
        defaultValue: 'DEVELOPMENT',
      },
      capabilities: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      tools: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      knowledgeSources: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      permissions: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      connectedSystems: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      metrics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {
        executions: 0,
        successRate: 0,
        latency: 0,
        cost: 0,
        satisfaction: 0,
      }},
      governance: { type: DataTypes.JSONB, allowNull: false, defaultValue: {
        approvedBy: null,
        approvedAt: null,
        riskLevel: 'low',
        auditEnabled: false,
      }},
      lifecycle: {
        type: DataTypes.ENUM('draft', 'validation', 'validated', 'approved', 'active', 'deprecated', 'archived'),
        allowNull: false,
        defaultValue: 'draft',
      },
      config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'corporate_agents',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id'], name: 'corporate_agents_tenant_idx' },
        { fields: ['slug'], name: 'corporate_agents_slug_idx' },
        // Unicidade composta: o mesmo slug pode existir em tenants distintos.
        { fields: ['tenant_id', 'slug'], name: 'corporate_agents_tenant_slug_uidx', unique: true },
        { fields: ['classification'], name: 'corporate_agents_classification_idx' },
        { fields: ['lifecycle'], name: 'corporate_agents_lifecycle_idx' },
        { fields: ['status'], name: 'corporate_agents_status_idx' },
      ],
    });
  }

  return CorporateAgent;
}

module.exports = getCorporateAgentModel;
