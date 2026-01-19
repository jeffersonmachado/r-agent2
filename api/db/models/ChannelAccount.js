/**
 * Model ChannelAccount - Conexões de canais por tenant (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let ChannelAccount = null;

function getChannelAccountModel() {
  if (!ChannelAccount) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    ChannelAccount = sequelize.define('ChannelAccount', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      type: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'active',
      },
      external_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      config_encrypted: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    }, {
      tableName: 'channel_accounts',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'type'], name: 'channel_accounts_tenant_key_type_idx' },
        { fields: ['tenant_key', 'status'], name: 'channel_accounts_tenant_key_status_idx' },
        { fields: ['type', 'external_id'], name: 'channel_accounts_type_external_id_idx' },
      ],
    });
  }

  return ChannelAccount;
}

module.exports = getChannelAccountModel;

