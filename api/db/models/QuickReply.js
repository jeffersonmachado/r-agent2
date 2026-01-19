/**
 * Model QuickReply - Respostas rápidas (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let QuickReply = null;

function getQuickReplyModel() {
  if (!QuickReply) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        }
      });
    }

    QuickReply = sequelize.define('QuickReply', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      title: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      message: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      tags: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      category: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      usage_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      created_by: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    }, {
      tableName: 'quick_replies',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'active'], name: 'quick_replies_tenant_key_active_idx' },
        { fields: ['tenant_key', 'category'], name: 'quick_replies_tenant_key_category_idx' },
      ],
    });
  }

  return QuickReply;
}

module.exports = getQuickReplyModel;

