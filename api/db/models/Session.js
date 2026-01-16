/**
 * Model Session - Sessões de autenticação por token
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let Session = null;

function getSessionModel() {
  if (!Session) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    Session = sequelize.define('Session', {
      token: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      user_agent: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      agent_snapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      last_activity_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    }, {
      tableName: 'sessions',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['user_id'], name: 'sessions_user_id_idx' },
        { fields: ['tenant_key'], name: 'sessions_tenant_key_idx' },
        { fields: ['expires_at'], name: 'sessions_expires_at_idx' },
        { fields: ['last_activity_at'], name: 'sessions_last_activity_at_idx' },
      ],
    });
  }

  return Session;
}

module.exports = getSessionModel;

