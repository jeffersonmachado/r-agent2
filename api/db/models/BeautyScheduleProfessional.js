const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('BeautyScheduleProfessional', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  operational_schedule_id: { type: DataTypes.STRING(128), allowNull: false },
  beauty_professional_id: { type: DataTypes.STRING(128), allowNull: false },
}, {
  tableName: 'beauty_schedule_professionals',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'operational_schedule_id', 'beauty_professional_id'], name: 'beauty_sched_prof_tenant_sched_prof_uidx', unique: true },
    { fields: ['tenant_key', 'beauty_professional_id'], name: 'beauty_sched_prof_tenant_prof_idx' },
    { fields: ['tenant_key', 'operational_schedule_id'], name: 'beauty_sched_prof_tenant_sched_idx' },
  ],
});
