const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxHoliday', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  date: { type: DataTypes.DATEONLY, allowNull: false },
  name: { type: DataTypes.STRING(128), allowNull: false },
  settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'pbx_holidays',
  timestamps: true,
});

