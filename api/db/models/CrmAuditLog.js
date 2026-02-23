const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CrmAuditLog = null;

function getCrmAuditLogModel() {
  if (!CrmAuditLog) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, { get: () => { throw new Error('Sequelize não inicializado. Chame connect() primeiro.'); } });
    }

    CrmAuditLog = sequelize.define('CrmAuditLog', {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      tenant_key: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      user_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      entity_type: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      entity_id: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      changes: {
        type: DataTypes.JSONB,
        defaultValue: null,
      },
      timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    }, {
      tableName: 'crm_audit_logs',
      timestamps: false,
    });
  }

  return CrmAuditLog;
}

module.exports = getCrmAuditLogModel;
