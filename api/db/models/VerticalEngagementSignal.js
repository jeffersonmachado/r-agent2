const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let VerticalEngagementSignal = null;

function getVerticalEngagementSignalModel() {
  if (!VerticalEngagementSignal) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    VerticalEngagementSignal = sequelize.define('VerticalEngagementSignal', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: false },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      signal_type: { type: DataTypes.STRING, allowNull: false },
      score: { type: DataTypes.FLOAT, allowNull: true },
      last_attendance_at: { type: DataTypes.DATE, allowNull: true },
      days_since_last_visit: { type: DataTypes.INTEGER, allowNull: true },
      frequency_last_30d: { type: DataTypes.INTEGER, allowNull: true },
      action_taken: { type: DataTypes.STRING, allowNull: true },
      action_taken_at: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      computed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    }, {
      tableName: 'vertical_engagement_signals',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'subject_id', 'signal_type'], name: 'ves_tenant_subject_signal_idx' },
        { fields: ['tenant_key', 'vertical', 'signal_type', 'computed_at'], name: 'ves_tenant_vertical_signal_date_idx' },
      ],
    });
  }
  return VerticalEngagementSignal;
}

module.exports = getVerticalEngagementSignalModel;
