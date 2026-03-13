const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxRecording', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  uniqueid: { type: DataTypes.STRING(80), allowNull: true },
  direction: { type: DataTypes.STRING(16), allowNull: true },
  src: { type: DataTypes.STRING(80), allowNull: true },
  dst: { type: DataTypes.STRING(80), allowNull: true },
  storage: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  startedAt: { type: DataTypes.DATE, allowNull: true, field: 'started_at' },
  endedAt: { type: DataTypes.DATE, allowNull: true, field: 'ended_at' },
}, {
  tableName: 'pbx_recordings',
  timestamps: true,
});

