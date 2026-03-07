const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('ScheduleBlock', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  scope_type: { type: DataTypes.STRING(16), allowNull: false }, // team|owner
  scope_id: { type: DataTypes.STRING(128), allowNull: false },
  start_at: { type: DataTypes.DATE, allowNull: false },
  end_at: { type: DataTypes.DATE, allowNull: false },
  reason: { type: DataTypes.STRING(160), allowNull: true },
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
  tableName: 'schedule_blocks',
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
    {
      fields: ['tenant_key', 'scope_type', 'scope_id', 'active', 'start_at'],
      name: 'schedule_blocks_tenant_scope_active_start_idx',
    },
  ],
});
