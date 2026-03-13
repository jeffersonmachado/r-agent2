const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('TicketMedia', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  fileName: { type: DataTypes.TEXT, allowNull: true, field: 'file_name' },
  mimeType: { type: DataTypes.TEXT, allowNull: true, field: 'mime_type' },
  sizeBytes: { type: DataTypes.INTEGER, allowNull: true, field: 'size_bytes' },
  sha256: { type: DataTypes.STRING(64), allowNull: true },
  createdBy: { type: DataTypes.STRING, allowNull: true, field: 'created_by' },
  data: { type: DataTypes.BLOB('long'), allowNull: false },
}, {
  tableName: 'ticket_media_files',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key'], name: 'ticket_media_files_tenant_key_idx' },
    { fields: ['sha256'], name: 'ticket_media_files_sha256_idx' },
  ],
});
