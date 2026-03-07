const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('BeautyClientPreference', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  contact_id: { type: DataTypes.STRING(128), allowNull: false },
  preferred_professional_id: { type: DataTypes.STRING(128), allowNull: true },
  preferred_services: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('preferred_services'), []); },
    set(value) { this.setDataValue('preferred_services', stringifyJsonText(value, [])); },
  },
  preferred_days: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('preferred_days'), []); },
    set(value) { this.setDataValue('preferred_days', stringifyJsonText(value, [])); },
  },
  preferred_time_ranges: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('preferred_time_ranges'), []); },
    set(value) { this.setDataValue('preferred_time_ranges', stringifyJsonText(value, [])); },
  },
}, {
  tableName: 'beauty_client_preferences',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('preferred_services')) instance.setDataValue('preferred_services', '[]');
      if (!instance.getDataValue('preferred_days')) instance.setDataValue('preferred_days', '[]');
      if (!instance.getDataValue('preferred_time_ranges')) instance.setDataValue('preferred_time_ranges', '[]');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'contact_id'], name: 'beauty_client_preferences_tenant_contact_uidx', unique: true },
  ],
});
