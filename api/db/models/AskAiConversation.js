'use strict';

/**
 * Conversas do "Perguntar à IA" (Ask AI) — estado conversacional persistido.
 *
 * Contexto (auditoria 2026-09-11): o widget mantinha o histórico apenas no
 * estado React e enviava somente a pergunta atual. O backend não tinha noção
 * de conversa, então nenhuma pergunta de acompanhamento ("e a frequência
 * dele?") podia ser resolvida.
 *
 * Persistência obrigatória (sem fallback em memória): a conversa vive no
 * Postgres, escopada por tenant + usuário, com expiração por política de
 * retenção. O histórico do cliente NUNCA é autoritativo — o servidor reenvia
 * apenas a janela que ele mesmo persistiu.
 */

const { DataTypes } = require('sequelize');
const { getSequelize } = require('../sequelize');

let AskAiConversation = null;

function getAskAiConversationModel() {
  if (!AskAiConversation) {
    const sequelize = getSequelize();
    if (!sequelize) {
      return new Proxy({}, {
        get: () => {
          throw new Error('Sequelize nao inicializado. Chame connect() primeiro.');
        },
      });
    }

    AskAiConversation = sequelize.define('AskAiConversation', {
      id: { type: DataTypes.STRING(64), primaryKey: true },
      tenantKey: { type: DataTypes.STRING, allowNull: false, field: 'tenant_key' },
      userKey: { type: DataTypes.STRING, allowNull: false, field: 'user_key' },
      agentId: { type: DataTypes.STRING, allowNull: true, field: 'agent_id' },
      username: { type: DataTypes.STRING, allowNull: true },
      status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'active' },
      // Dica de contexto de tela do último turno. NUNCA é autoridade: cada
      // turno revalida posse/permissão antes de usar.
      context: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      messages: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      summary: { type: DataTypes.TEXT, allowNull: true },
      turnCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'turn_count' },
      lastActivityAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'last_activity_at' },
      expiresAt: { type: DataTypes.DATE, allowNull: true, field: 'expires_at' },
      createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
      updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    }, {
      tableName: 'ask_ai_conversations',
      timestamps: true,
      underscored: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      indexes: [
        { fields: ['tenant_key', 'user_key', 'last_activity_at'], name: 'ask_ai_conv_tenant_user_idx' },
        { fields: ['expires_at'], name: 'ask_ai_conv_expires_idx' },
      ],
    });
  }

  return AskAiConversation;
}

module.exports = getAskAiConversationModel;
