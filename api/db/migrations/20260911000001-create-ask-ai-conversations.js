'use strict';

/**
 * Cria a tabela de conversas do "Perguntar à IA".
 *
 * Contexto: até 2026-09-11 o widget mantinha o histórico apenas em memória do
 * React e o backend recebia somente a pergunta atual — nenhuma pergunta de
 * acompanhamento podia ser resolvida. O estado conversacional passa a ser
 * persistido (sem fallback em memória), escopado por tenant + usuário, com
 * expiração por política de retenção.
 *
 * Idempotente: usa `createTable` somente quando a tabela não existe.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((table) => (typeof table === 'string' ? table : table.tableName));
    if (normalized.includes('ask_ai_conversations')) return;

    await queryInterface.createTable('ask_ai_conversations', {
      id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      user_key: { type: Sequelize.STRING, allowNull: false },
      agent_id: { type: Sequelize.STRING, allowNull: true },
      username: { type: Sequelize.STRING, allowNull: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'active' },
      context: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      messages: { type: Sequelize.JSONB, allowNull: false, defaultValue: [] },
      summary: { type: Sequelize.TEXT, allowNull: true },
      turn_count: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_activity_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      expires_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    const { addIndexIfNotExists } = require('../migrations-helper');
    await addIndexIfNotExists(
      queryInterface,
      'ask_ai_conversations',
      ['tenant_key', 'user_key', 'last_activity_at'],
      { name: 'ask_ai_conv_tenant_user_idx' },
    );
    await addIndexIfNotExists(
      queryInterface,
      'ask_ai_conversations',
      ['expires_at'],
      { name: 'ask_ai_conv_expires_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ask_ai_conversations');
  },
};
