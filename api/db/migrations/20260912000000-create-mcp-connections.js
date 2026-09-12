'use strict';

/**
 * Migration: mcp_connections — CONTROL PLANE PERSISTENTE de conexões MCP
 * externas (§M1, §M3–M12, §M20).
 *
 * Contexto: até 2026-09-12 as conexões externas do MCP viviam em
 * `config.get('mcp.connections')` (config estática) e no estado EM MEMÓRIA do
 * client hub. Isso não é control plane: não há ciclo de vida, histórico de
 * saúde, detecção de mudança de schema, auditoria por tenant nem
 * habilitar/desabilitar sem reiniciar o processo.
 *
 * Invariantes da tabela:
 *   - `credential_ref` é REFERÊNCIA (nome de variável/segredo gerenciado), nunca
 *     o segredo em claro (§M4);
 *   - identidade por tenant: `UNIQUE (tenant_key, name)` impede duplicação
 *     quando o bootstrap de config é importado mais de uma vez (§M7);
 *   - endpoints restritos são recusados na ESCRITA pela camada de serviço
 *     (política canônica em `src/core/mcp/endpoint-policy.js`), não por CHECK do
 *     banco: a política precisa ser reavaliada também após resolução DNS (§M20).
 *
 * Idempotente: cria apenas quando a tabela não existe.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    const normalized = tables.map((table) => (typeof table === 'string' ? table : table.tableName));
    if (normalized.includes('mcp_connections')) return;

    await queryInterface.createTable('mcp_connections', {
      id: { type: Sequelize.STRING(64), primaryKey: true, allowNull: false },
      tenant_key: { type: Sequelize.STRING, allowNull: false },
      name: { type: Sequelize.STRING, allowNull: false },
      endpoint: { type: Sequelize.STRING, allowNull: false },
      transport: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'http' },
      auth_type: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'bearer' },
      // Referência apenas. Nunca o segredo (§M4).
      credential_ref: { type: Sequelize.STRING, allowNull: true },
      enabled: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      classification_ceiling: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'PRODUCTION' },
      status: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'CONFIGURED' },
      last_discovery_at: { type: Sequelize.DATE, allowNull: true },
      last_health_at: { type: Sequelize.DATE, allowNull: true },
      last_success_at: { type: Sequelize.DATE, allowNull: true },
      last_failure_at: { type: Sequelize.DATE, allowNull: true },
      schema_fingerprint: { type: Sequelize.STRING(128), allowNull: true },
      consecutive_failures: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      last_error: { type: Sequelize.TEXT, allowNull: true },
      // origem: 'config-bootstrap' (importada da config legada) | 'control-plane'.
      source: { type: Sequelize.STRING(32), allowNull: false, defaultValue: 'control-plane' },
      metadata: { type: Sequelize.JSONB, allowNull: false, defaultValue: {} },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
    });

    const { addIndexIfNotExists } = require('../migrations-helper');

    // §M7: o bootstrap da config legada precisa ser idempotente.
    await addIndexIfNotExists(queryInterface, 'mcp_connections', ['tenant_key', 'name'], {
      name: 'mcp_connections_tenant_name_uq',
      unique: true,
    });
    // Carga do runtime: apenas conexões habilitadas de um tenant (§M6).
    await addIndexIfNotExists(queryInterface, 'mcp_connections', ['tenant_key', 'enabled'], {
      name: 'mcp_connections_tenant_enabled_idx',
    });
    // Varredura de saúde/lifecycle.
    await addIndexIfNotExists(queryInterface, 'mcp_connections', ['status'], {
      name: 'mcp_connections_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('mcp_connections');
  },
};
