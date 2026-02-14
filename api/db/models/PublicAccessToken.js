/**
 * Model PublicAccessToken - Tokens públicos (URL token) para telas públicas
 * (storefront, kiosk, panel, station).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let PublicAccessToken = null;

function getPublicAccessTokenModel() {
  if (!PublicAccessToken) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    PublicAccessToken = sequelize.define('PublicAccessToken', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      kind: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      location_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      token: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      meta: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      last_used_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rotated_from_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    }, {
      tableName: 'public_access_tokens',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['token'], name: 'public_access_tokens_token_uq', unique: true },
        { fields: ['tenant_key', 'kind'], name: 'public_access_tokens_tenant_key_kind_idx' },
        { fields: ['tenant_key', 'location_id'], name: 'public_access_tokens_tenant_key_location_id_idx' },
        { fields: ['tenant_key', 'kind', 'active'], name: 'public_access_tokens_tenant_kind_active_idx' },
        { fields: ['expires_at'], name: 'public_access_tokens_expires_at_idx' },
        { fields: ['last_used_at'], name: 'public_access_tokens_last_used_at_idx' },
      ],
    });
  }

  return PublicAccessToken;
}

module.exports = getPublicAccessTokenModel;

