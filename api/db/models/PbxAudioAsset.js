const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxAudioAsset', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  kind: { type: DataTypes.STRING(32), allowNull: false },
  name: { type: DataTypes.STRING(255), allowNull: false },
  storage: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
}, {
  tableName: 'pbx_audio_assets',
  timestamps: true,
});

