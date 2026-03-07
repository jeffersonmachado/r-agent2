const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessCheckin', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  member_id: { type: DataTypes.STRING(128), allowNull: false },
  class_schedule_id: { type: DataTypes.STRING(128), allowNull: true },
  source: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'manual' },
  kiosk_session_id: { type: DataTypes.STRING(128), allowNull: true },
  checked_in_at: { type: DataTypes.DATE, allowNull: false },
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
  tableName: 'fitness_checkins',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'member_id', 'checked_in_at'], name: 'fitness_checkins_tenant_member_time_idx' },
    { fields: ['tenant_key', 'kiosk_session_id'], name: 'fitness_checkins_tenant_kiosk_idx' },
  ],
});
