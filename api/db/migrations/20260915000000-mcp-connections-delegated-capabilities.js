'use strict';

/**
 * Migration: delegação EXPLÍCITA de escopo das conexões MCP externas.
 *
 * `delegated_capabilities` (JSONB, lista nominal de capabilities canônicas):
 * a conexão declara QUAIS capabilities autorizam o uso do seu escopo
 * (`mcp.t<tenantToken>.<connection>`) por portadores da permissão da
 * capability — é a política que permite a um consumidor capability-neutral
 * (ex.: research principal) alcançar o provider externo sem wildcard `mcp.*`
 * e sem conhecer o nome da conexão (ver `src/core/mcp/connection-delegation.js`).
 *
 * Sem esta coluna, a delegação declarada não sobrevivia ao restart: o runtime
 * recarrega as conexões do banco (§M6) e a config operacional precisa voltar
 * completa.
 *
 * Idempotente: a coluna é criada apenas quando ainda não existe.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const description = await queryInterface.describeTable('mcp_connections');
    if (description.delegated_capabilities) return;
    await queryInterface.addColumn('mcp_connections', 'delegated_capabilities', {
      type: Sequelize.JSONB,
      allowNull: false,
      defaultValue: [],
    });
  },

  async down(queryInterface) {
    const description = await queryInterface.describeTable('mcp_connections');
    if (!description.delegated_capabilities) return;
    await queryInterface.removeColumn('mcp_connections', 'delegated_capabilities');
  },
};
