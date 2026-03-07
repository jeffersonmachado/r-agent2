const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('BeautyScheduleService', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  operational_schedule_id: { type: DataTypes.STRING(128), allowNull: false },
  beauty_service_id: { type: DataTypes.STRING(128), allowNull: false },
}, {
  tableName: 'beauty_schedule_services',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'operational_schedule_id', 'beauty_service_id'], name: 'beauty_sched_svc_tenant_sched_svc_uidx', unique: true },
    { fields: ['tenant_key', 'beauty_service_id'], name: 'beauty_sched_svc_tenant_svc_idx' },
    { fields: ['tenant_key', 'operational_schedule_id'], name: 'beauty_sched_svc_tenant_sched_idx' },
  ],
});
