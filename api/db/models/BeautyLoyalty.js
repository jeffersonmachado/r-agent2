const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('BeautyLoyalty', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  contact_id: { type: DataTypes.STRING(128), allowNull: false },
  visits: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  points: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  last_visit_at: { type: DataTypes.DATE, allowNull: true },
  segment: { type: DataTypes.STRING(80), allowNull: true },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'beauty_loyalty',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'contact_id'], name: 'beauty_loyalty_tenant_contact_uidx', unique: true },
    { fields: ['tenant_key', 'segment'], name: 'beauty_loyalty_tenant_segment_idx' },
  ],
});
