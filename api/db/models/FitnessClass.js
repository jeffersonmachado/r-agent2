const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessClass', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING(120), allowNull: false },
  instructor_id: { type: DataTypes.STRING(128), allowNull: true },
  category: { type: DataTypes.STRING(80), allowNull: true },
  operation_mode: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'group_class' },
  duration_minutes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60 },
  default_capacity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
  active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() {
      return parseJsonText(this.getDataValue('metadata'), {});
    },
    set(value) {
      this.setDataValue('metadata', stringifyJsonText(value, {}));
    },
  },
}, {
  tableName: 'fitness_classes',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      const raw = instance.getDataValue('metadata');
      if (raw === null || raw === undefined || raw === '') {
        instance.setDataValue('metadata', '{}');
      }
    },
  },
  indexes: [
    { fields: ['tenant_key', 'active'], name: 'fitness_classes_tenant_active_idx' },
    { fields: ['tenant_key', 'category'], name: 'fitness_classes_tenant_category_idx' },
    { fields: ['tenant_key', 'operation_mode'], name: 'fitness_classes_tenant_mode_idx' },
  ],
});
