'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let JourneyRegistry = null;

function getJourneyRegistryModel() {
  if (!JourneyRegistry) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    JourneyRegistry = sequelize.define('JourneyRegistry', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      domain: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      owner: { type: DataTypes.STRING, allowNull: true },
      criticality: {
        type: DataTypes.ENUM('low', 'medium', 'high', 'critical'),
        allowNull: false,
        defaultValue: 'medium',
      },
      sla: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      kpis: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      successCriteria: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      scenarios: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      status: {
        type: DataTypes.ENUM('draft', 'active', 'deprecated', 'archived'),
        allowNull: false,
        defaultValue: 'draft',
      },
      metrics: { type: DataTypes.JSONB, allowNull: false, defaultValue: {
        totalExecutions: 0,
        successRate: 0,
        avgDuration: 0,
        failureRate: 0,
      }},
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'journey_registry',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'domain'], name: 'journey_registry_tenant_domain_idx' },
        { fields: ['slug'], name: 'journey_registry_slug_idx' },
        { fields: ['status'], name: 'journey_registry_status_idx' },
        { fields: ['criticality'], name: 'journey_registry_criticality_idx' },
      ],
    });
  }

  return JourneyRegistry;
}

module.exports = getJourneyRegistryModel;
