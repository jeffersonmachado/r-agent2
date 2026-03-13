const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxExtension', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  extension: { type: DataTypes.STRING(40), allowNull: false },
  displayName: { type: DataTypes.STRING(120), allowNull: true, field: 'display_name' },
  authUsername: { type: DataTypes.STRING(120), allowNull: true, field: 'auth_username' },
  authPassword: { type: DataTypes.STRING(255), allowNull: true, field: 'auth_password' },
  calleridName: { type: DataTypes.STRING(120), allowNull: true, field: 'callerid_name' },
  calleridNumber: { type: DataTypes.STRING(40), allowNull: true, field: 'callerid_number' },
  voicemailEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'voicemail_enabled' },
  codecs: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  endpointOptions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'endpoint_options' },
  status: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'active' },
}, {
  tableName: 'pbx_extensions',
  timestamps: true,
});

