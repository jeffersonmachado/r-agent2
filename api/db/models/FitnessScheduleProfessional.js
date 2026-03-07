const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('FitnessScheduleProfessional', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  class_schedule_id: { type: DataTypes.STRING(128), allowNull: false },
  operational_schedule_id: { type: DataTypes.STRING(128), allowNull: true },
  professional_id: { type: DataTypes.STRING(128), allowNull: false },
}, {
  tableName: 'fitness_schedule_professionals',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'class_schedule_id', 'professional_id'], name: 'fitness_schedule_prof_tenant_sched_prof_uidx', unique: true },
    { fields: ['tenant_key', 'professional_id'], name: 'fitness_schedule_prof_tenant_prof_idx' },
    { fields: ['tenant_key', 'operational_schedule_id'], name: 'fitness_schedule_prof_tenant_operational_idx' },
  ],
});
