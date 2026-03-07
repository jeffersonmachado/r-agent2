const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('BeautyProfessional', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  specialty: { type: DataTypes.STRING(120), allowNull: true },
  specialties: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('specialties'), []); },
    set(value) { this.setDataValue('specialties', stringifyJsonText(value, [])); },
  },
  max_daily_sessions: { type: DataTypes.INTEGER, allowNull: true },
  working_hours: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('working_hours'), {}); },
    set(value) { this.setDataValue('working_hours', stringifyJsonText(value, {})); },
  },
  schedule_ref: { type: DataTypes.STRING(128), allowNull: true },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'beauty_professionals',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
      if (!instance.getDataValue('specialties')) instance.setDataValue('specialties', '[]');
      if (!instance.getDataValue('working_hours')) instance.setDataValue('working_hours', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'active'], name: 'beauty_professionals_tenant_active_idx' },
    { fields: ['tenant_key', 'name'], name: 'beauty_professionals_tenant_name_idx' },
  ],
});
