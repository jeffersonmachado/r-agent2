const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let VerticalSessionBundle = null;

function getVerticalSessionBundleModel() {
  if (!VerticalSessionBundle) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); },
      });
    }

    VerticalSessionBundle = sequelize.define('VerticalSessionBundle', {
      id: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
      tenant_key: { type: DataTypes.STRING, allowNull: false },
      vertical: { type: DataTypes.STRING, allowNull: false },
      subject_id: { type: DataTypes.STRING, allowNull: false },
      customer_id: { type: DataTypes.STRING, allowNull: true },
      membership_id: { type: DataTypes.STRING, allowNull: true },
      bundle_type: { type: DataTypes.STRING, allowNull: false, defaultValue: 'package' },
      plan_name: { type: DataTypes.STRING, allowNull: true },
      total_sessions: { type: DataTypes.INTEGER, allowNull: true },
      used_sessions: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      billing_status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
      start_at: { type: DataTypes.DATE, allowNull: true },
      end_at: { type: DataTypes.DATE, allowNull: true },
      due_date: { type: DataTypes.DATE, allowNull: true },
      renewal_at: { type: DataTypes.DATE, allowNull: true },
      grace_until: { type: DataTypes.DATE, allowNull: true },
      metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    }, {
      tableName: 'vertical_session_bundles',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'subject_id', 'status'], name: 'vsb_tenant_subject_status_idx' },
        { fields: ['tenant_key', 'vertical', 'billing_status'], name: 'vsb_tenant_vertical_billing_idx' },
      ],
    });
  }
  return VerticalSessionBundle;
}

module.exports = getVerticalSessionBundleModel;
