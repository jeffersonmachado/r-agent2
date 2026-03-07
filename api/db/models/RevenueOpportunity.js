const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('RevenueOpportunity', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING(100), allowNull: false },
  type: { type: DataTypes.STRING(50), allowNull: false },
  entity_id: { type: DataTypes.STRING(100), allowNull: true },
  service_type: { type: DataTypes.STRING(100), allowNull: true },
  estimated_value: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 },
  confidence: { type: DataTypes.DECIMAL(5, 4), allowNull: false, defaultValue: 0 },
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'open' },
  metadata: {
    type: DataTypes.TEXT,
    allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'revenue_opportunities',
  timestamps: true,
  underscored: true,
  indexes: [
    { fields: ['tenant_key', 'status'], name: 'revenue_opportunities_tenant_status_idx' },
    { fields: ['tenant_key', 'type', 'entity_id', 'service_type', 'status'], name: 'revenue_opportunities_dedupe_idx' },
  ],
});
