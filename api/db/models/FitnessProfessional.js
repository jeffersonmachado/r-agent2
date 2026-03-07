const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessProfessional', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  role_type: { type: DataTypes.STRING(48), allowNull: false, defaultValue: 'instructor' },
  specialties: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('specialties'), []); },
    set(value) { this.setDataValue('specialties', stringifyJsonText(value, [])); },
  },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  can_group_sessions: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  can_individual_sessions: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  max_concurrent_sessions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'fitness_professionals',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('specialties')) instance.setDataValue('specialties', '[]');
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'active'], name: 'fitness_professionals_tenant_active_idx' },
    { fields: ['tenant_key', 'role_type'], name: 'fitness_professionals_tenant_role_idx' },
  ],
});
