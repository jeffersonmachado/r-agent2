/**
 * Model SupportMediaAsset - Armazena anexos de suporte no banco (binário)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let SupportMediaAsset = null;

function getSupportMediaAssetModel() {
  if (!SupportMediaAsset) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    SupportMediaAsset = sequelize.define('SupportMediaAsset', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      storage_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      original_name: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      mime_type: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      size_bytes: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      source: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      data: {
        type: DataTypes.BLOB('long'),
        allowNull: false,
      },
    }, {
      tableName: 'support_media_assets',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_id', 'storage_name'], name: 'support_media_assets_tenant_storage_uq', unique: true },
        { fields: ['tenant_id'], name: 'support_media_assets_tenant_idx' },
      ],
    });
  }

  return SupportMediaAsset;
}

module.exports = getSupportMediaAssetModel;

