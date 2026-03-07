const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('FitnessAttendance', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  class_schedule_id: { type: DataTypes.STRING(128), allowNull: false },
  member_id: { type: DataTypes.STRING(128), allowNull: false },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'booked' },
  checkin_time: { type: DataTypes.DATE, allowNull: true },
  booking_time: { type: DataTypes.DATE, allowNull: true },
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
  tableName: 'fitness_attendance',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'class_schedule_id', 'member_id'], name: 'fitness_attendance_tenant_schedule_member_uidx', unique: true },
    { fields: ['tenant_key', 'member_id', 'status'], name: 'fitness_attendance_tenant_member_status_idx' },
  ],
});
