const { DataTypes } = require('sequelize');
const { createModelFactory } = require('./helpers');
const { parseJsonText, stringifyJsonText } = require('./jsonText');

module.exports = createModelFactory('AutonomousGapCandidate', {
  id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
  tenant_key: { type: DataTypes.STRING, allowNull: false },
  campaign_id: { type: DataTypes.STRING(128), allowNull: false },
  contact_id: { type: DataTypes.STRING(128), allowNull: false },
  source: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'ranked' },
  score: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  score_breakdown: {
    type: DataTypes.TEXT, allowNull: false,
    get() { return parseJsonText(this.getDataValue('score_breakdown'), {}); },
    set(value) { this.setDataValue('score_breakdown', stringifyJsonText(value, {})); },
  },
  invite_status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'pending' },
  invite_channel: { type: DataTypes.STRING(24), allowNull: true },
  outbound_message_id: { type: DataTypes.STRING(128), allowNull: true },
  sent_at: { type: DataTypes.DATE, allowNull: true },
  responded_at: { type: DataTypes.DATE, allowNull: true },
  response_type: { type: DataTypes.STRING(32), allowNull: true },
  cooldown_until: { type: DataTypes.DATE, allowNull: true },
  metadata: {
    type: DataTypes.TEXT, allowNull: false,
    get() { return parseJsonText(this.getDataValue('metadata'), {}); },
    set(value) { this.setDataValue('metadata', stringifyJsonText(value, {})); },
  },
}, {
  tableName: 'autonomous_gap_candidates',
  timestamps: true,
  underscored: true,
  hooks: {
    beforeValidate(instance) {
      if (!instance.getDataValue('score_breakdown')) instance.setDataValue('score_breakdown', '{}');
      if (!instance.getDataValue('metadata')) instance.setDataValue('metadata', '{}');
    },
  },
  indexes: [
    { fields: ['tenant_key', 'campaign_id', 'invite_status'], name: 'autonomous_gap_candidates_tenant_campaign_status_idx' },
    { fields: ['tenant_key', 'contact_id', 'sent_at'], name: 'autonomous_gap_candidates_tenant_contact_sent_idx' },
    { fields: ['tenant_key', 'campaign_id', 'contact_id'], name: 'autonomous_gap_candidates_tenant_campaign_contact_uidx', unique: true },
  ],
});
