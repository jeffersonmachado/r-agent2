const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessMembership', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  member_id: { type: DataTypes.STRING(128), allowNull: false },
  plan_name: { type: DataTypes.STRING(120), allowNull: false },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: true },
  allowed_classes: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() {
      return parseJsonText(this.getDataValue('allowed_classes'), []);
    },
    set(value) {
      this.setDataValue('allowed_classes', stringifyJsonText(value, []));
    },
  },
  allowed_weekly_frequency: { type: DataTypes.INTEGER, allowNull: true },
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
  tableName: 'fitness_memberships',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('allowed_classes')) instance.setDataValue('allowed_classes', '[]');
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'member_id', 'active'], name: 'fitness_memberships_tenant_member_active_idx' },
  ],
});
