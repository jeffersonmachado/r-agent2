/**
 * Model AuditLog - Logs de auditoria do sistema
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

// AuditLog será definido quando Sequelize estiver disponível
let AuditLog = null;

function getAuditLogModel() {
  if (!AuditLog) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }
    
    AuditLog = sequelize.define('AuditLog', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
      },
      tenant_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'tenants',
          key: 'id',
        },
        onDelete: 'SET NULL',
        comment: 'NULL para ações globais/system',
      },
      actor_user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
          model: 'users',
          key: 'id',
        },
        onDelete: 'SET NULL',
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Ação realizada (ex: "create", "update", "delete", "login")',
      },
      entity: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Entidade afetada (ex: "tenant", "user", "ai_config")',
      },
      entity_id: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'ID da entidade afetada',
      },
      meta: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'Metadados adicionais da ação',
      },
    }, {
      tableName: 'audit_logs',
      timestamps: true,
      underscored: true, // Usa snake_case para mapear createdAt -> created_at, updatedAt -> updated_at
      indexes: [
        {
          fields: ['tenant_id', 'created_at'],
        },
        {
          fields: ['actor_user_id'],
        },
        {
          fields: ['action'],
        },
        {
          fields: ['entity'],
        },
        {
          fields: ['created_at'],
        },
      ],
    });
  }
  return AuditLog;
}

module.exports = getAuditLogModel;
