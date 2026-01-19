/**
 * Model TicketTag - trilha de tags (tenant_key-based)
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let TicketTag = null;

function getTicketTagModel() {
  if (!TicketTag) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    TicketTag = sequelize.define('TicketTag', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      ticket_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      tag: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      actor_user_id: {
        type: DataTypes.STRING,
        allowNull: true,
      },
    }, {
      tableName: 'ticket_tags',
      timestamps: false,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'ticket_id', 'created_at'], name: 'ticket_tags_tenant_ticket_created_idx' },
        { fields: ['tenant_key', 'tag'], name: 'ticket_tags_tenant_tag_idx' },
      ],
    });
  }

  return TicketTag;
}

module.exports = getTicketTagModel;

