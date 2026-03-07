const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('BeautyServiceProfessional', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  service_id: { type: DataTypes.STRING(128), allowNull: false },
  professional_id: { type: DataTypes.STRING(128), allowNull: false },
  duration_minutes: { type: DataTypes.INTEGER, allowNull: true },
  price_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'beauty_service_professionals',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'service_id', 'professional_id'], name: 'beauty_service_professionals_tenant_service_prof_idx', unique: true },
    { fields: ['tenant_key', 'professional_id', 'active'], name: 'beauty_service_professionals_tenant_prof_active_idx' },
  ],
});
