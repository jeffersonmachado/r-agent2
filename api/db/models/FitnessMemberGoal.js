const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessMemberGoal', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  member_id: { type: DataTypes.STRING(128), allowNull: false },
  goal_type: { type: DataTypes.STRING(80), allowNull: false },
  target_value: { type: DataTypes.STRING(120), allowNull: true },
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
  tableName: 'fitness_member_goals',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'member_id', 'active'], name: 'fitness_member_goals_tenant_member_active_idx' },
  ],
});
