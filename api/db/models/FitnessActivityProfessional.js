const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessActivityProfessional', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  activity_id: { type: DataTypes.STRING(128), allowNull: false },
  professional_id: { type: DataTypes.STRING(128), allowNull: false },
  duration_minutes: { type: DataTypes.INTEGER, allowNull: true },
  default_price: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  max_capacity_override: { type: DataTypes.INTEGER, allowNull: true },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'fitness_activity_professionals',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'activity_id', 'professional_id'], name: 'fitness_activity_professionals_tenant_activity_prof_uidx', unique: true },
    { fields: ['tenant_key', 'professional_id'], name: 'fitness_activity_professionals_tenant_prof_idx' },
  ],
});
