'use strict';
const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');
let Resource = null;
function getResourceModel() {
  if (!Resource) {
    const sequelize = getSequelize();
    if (!sequelize) return new Proxy({}, { get: () => { throw new Error('Sequelize nao inicializado. Chame connect() primeiro.'); } });
    Resource = sequelize.define('Resource', {
      id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
      tenant_id: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, { tableName: 'resources', timestamps: true, underscored: true, indexes: [{ fields: ['tenant_id', 'type'], name: 'resources_tenant_type_idx' }] });
  }
  return Resource;
}
module.exports = getResourceModel;
