/**
 * Model AuditEvent - Eventos de auditoria (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AuditEvent = null;

function getAuditEventModel() {
  if (!AuditEvent) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    AuditEvent = sequelize.define('AuditEvent', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      actor_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      username: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      resource: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      resource_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      details: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      ip_address: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    }, {
      tableName: 'audit_events',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'created_at'], name: 'audit_events_tenant_key_created_at_idx' },
        { fields: ['actor_user_id', 'created_at'], name: 'audit_events_actor_user_id_created_at_idx' },
        { fields: ['action'], name: 'audit_events_action_idx' },
        { fields: ['resource'], name: 'audit_events_resource_idx' },
      ],
    });
  }

  return AuditEvent;
}

module.exports = getAuditEventModel;

