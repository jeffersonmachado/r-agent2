const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let VerticalAttendance = null;

function getVerticalAttendanceModel() {
  if (!VerticalAttendance) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    VerticalAttendance = sequelize.define('VerticalAttendance', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: false },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      access_decision_id: { type: DataTypes.STRING, allowNull: true },
      unit_id: { type: DataTypes.STRING, allowNull: true },
      device_id: { type: DataTypes.STRING, allowNull: true },
      checked_in_at: { type: DataTypes.DATE, allowNull: true },
      checked_out_at: { type: DataTypes.DATE, allowNull: true },
      duration_minutes: { type: DataTypes.INTEGER, allowNull: true },
      session_bundle_id: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'open' },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'vertical_attendances',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'subject_id', 'checked_in_at'], name: 'va_tenant_subject_checkin_idx' },
        { fields: ['tenant_key', 'membership_id', 'checked_in_at'], name: 'va_tenant_membership_checkin_idx' },
        { fields: ['tenant_key', 'vertical', 'checked_in_at'], name: 'va_tenant_vertical_checkin_idx' },
      ],
    });
  }
  return VerticalAttendance;
}

module.exports = getVerticalAttendanceModel;
