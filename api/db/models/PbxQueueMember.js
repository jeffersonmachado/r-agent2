const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');

module.exports = createModelFactory('PbxQueueMember', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
  queueId: { type: DataTypes.STRING, allowNull: false, field: 'queue_id' },
  memberType: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'extension', field: 'member_type' },
  memberRef: { type: DataTypes.STRING(128), allowNull: false, field: 'member_ref' },
  penalty: { type: DataTypes.INTEGER, allowNull: true },
  paused: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: 'pbx_queue_members',
  timestamps: true,
});

