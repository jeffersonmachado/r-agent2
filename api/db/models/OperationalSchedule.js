const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('OperationalSchedule', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  context_type: { type: DataTypes.STRING(24), allowNull: false },
  context_id: { type: DataTypes.STRING(128), allowNull: false },
  contact_id: { type: DataTypes.STRING(128), allowNull: true },
  conversation_id: { type: DataTypes.STRING(128), allowNull: true },
  channel: { type: DataTypes.STRING(24), allowNull: false },
  mode: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'free' },
  origin: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'human' },
  start_at: { type: DataTypes.DATE, allowNull: false },
  end_at: { type: DataTypes.DATE, allowNull: false },
  timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'UTC' },
  requires_confirmation: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  confirmation_status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'not_required' },
  status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'draft' },
  owner_id: { type: DataTypes.STRING(128), allowNull: true },
  team_id: { type: DataTypes.STRING(128), allowNull: true },
  purpose: { type: DataTypes.STRING(120), allowNull: false, defaultValue: 'compromisso' },
  notes: { type: DataTypes.TEXT, allowNull: true },
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
  idempotency_key: { type: DataTypes.STRING(160), allowNull: true },
}, {
  tableName: 'operational_schedules',
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
    { fields: ['tenant_key', 'context_type', 'context_id'], name: 'operational_schedules_tenant_context_idx' },
    { fields: ['tenant_key', 'team_id', 'start_at'], name: 'operational_schedules_tenant_team_start_idx' },
    { fields: ['tenant_key', 'owner_id', 'start_at'], name: 'operational_schedules_tenant_owner_start_idx' },
    { fields: ['tenant_key', 'idempotency_key'], name: 'operational_schedules_tenant_idempotency_uq', unique: true },
  ],
});
