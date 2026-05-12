const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxCdr', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  uniqueid: { type: DataTypes.STRING(80), allowNull: false },
  calldate: { type: DataTypes.DATE, allowNull: true },
  src: { type: DataTypes.STRING(80), allowNull: true },
  dst: { type: DataTypes.STRING(80), allowNull: true },
  disposition: { type: DataTypes.STRING(32), allowNull: true },
  duration: { type: DataTypes.INTEGER, allowNull: true },
  billsec: { type: DataTypes.INTEGER, allowNull: true },
  accountcode: { type: DataTypes.STRING(80), allowNull: true },
  userfield: { type: DataTypes.STRING(255), allowNull: true },
  extra: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'pbx_cdr',
  timestamps: true,
});

