/**
 * Model FlowTemplate - marketplace de templates de fluxo (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let FlowTemplate = null;

function getFlowTemplateModel() {
  if (!FlowTemplate) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    FlowTemplate = sequelize.define('FlowTemplate', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      icon: { type: DataTypes.STRING, allowNull: false, defaultValue: '📋' },
      tags: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      flow: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_by: { type: DataTypes.STRING, allowNull: true },
    }, {
      tableName: 'flow_templates',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'active'], name: 'flow_templates_tenant_key_active_idx' },
        { fields: ['tenant_key', 'name'], name: 'flow_templates_tenant_key_name_idx' },
      ],
    });
  }

  return FlowTemplate;
}

module.exports = getFlowTemplateModel;

