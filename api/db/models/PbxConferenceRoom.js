const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxConferenceRoom', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  name: { type: DataTypes.STRING(128), allowNull: false },
  pin: { type: DataTypes.STRING(32), allowNull: true },
  options: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'pbx_conference_rooms',
  timestamps: true,
});

