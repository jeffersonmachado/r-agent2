/**
 * Model CaseConversation - Link N:N entre Case (ticket) e ChannelConversation
 *
 * Um Case agrupa múltiplas conversas omnichannel do mesmo tenant.
 * Persistência dedicada (sem fallback em memória).
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let CaseConversation = null;

function getCaseConversationModel() {
  if (!CaseConversation) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize não inicializado. Chame connect() primeiro.');
        },
      });
    }

    CaseConversation = sequelize.define('CaseConversation', {
      id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
      },
      tenant_key: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      case_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      conversation_id: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
    }, {
      tableName: 'case_conversations',
      timestamps: true,
      underscored: true,
      indexes: [
        { fields: ['tenant_key', 'case_id'], name: 'case_conversations_tenant_key_case_id_idx' },
        { fields: ['tenant_key', 'conversation_id'], name: 'case_conversations_tenant_key_conversation_id_idx' },
        { fields: ['tenant_key', 'case_id', 'conversation_id'], name: 'case_conversations_unique_link', unique: true },
      ],
    });
  }

  return CaseConversation;
}

module.exports = getCaseConversationModel;
