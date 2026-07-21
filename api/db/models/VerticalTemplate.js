'use strict';

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let VerticalTemplate = null;

function getVerticalTemplateModel() {
  if (!VerticalTemplate) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    VerticalTemplate = sequelize.define('VerticalTemplate', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false, defaultValue: 'system' },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false },
      category: {
        type: DataTypes.ENUM('Beauty', 'Fitness', 'Food', 'Clinic', 'Bakery', 'Services', 'Retail', 'Education', 'Health', 'Custom'),
        allowNull: false,
      },
      description: { type: DataTypes.TEXT, allowNull: true },
      icon: { type: DataTypes.STRING, allowNull: true },
      color: { type: DataTypes.STRING, allowNull: true },
      journeys: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      agents: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      knowledge: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      automations: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      kpis: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      config: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      status: {
        type: DataTypes.ENUM('draft', 'published', 'deprecated', 'archived'),
        allowNull: false,
        defaultValue: 'draft',
      },
      usageCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'vertical_templates',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'category'], name: 'vt_tenant_category_idx' },
        { fields: ['slug'], name: 'vt_slug_idx' },
        { fields: ['status'], name: 'vt_status_idx' },
      ],
    });
  }

  return VerticalTemplate;
}

module.exports = getVerticalTemplateModel;
