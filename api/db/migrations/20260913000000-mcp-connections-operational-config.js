'use strict';

/**
 * Migration: config OPERACIONAL persistida das conexões MCP externas (§M6).
 *
 * Contexto: a tabela `mcp_connections` (migration 20260912000000) guardava
 * identidade, credencial por referência, ciclo de vida e saúde — mas NÃO a
 * config operacional. O resultado era um control plane incompleto: ao reiniciar,
 * a conexão voltava sem `allowedTools`, `toolCapabilityMap`, `toolPolicies`,
 * `endpointPolicy`, `quota`, `timeoutMs` nem `retryPolicy`. O runtime caía na
 * heurística por nome de tool e a política DECLARADA por tool era descartada —
 * exatamente o defeito registrado em `AI_MEMORY/...` (mutação declarada autônoma
 * voltava a exigir confirmação, e vice-versa).
 *
 * Invariantes:
 *   - `tool_capability_map` + `mapping_version`: o mapeamento
 *     tool-remota → capability CANÔNICA é persistente e VERSIONADO (§M8). A
 *     autoridade de execução continua sendo o Canonical Tool Registry; aqui só
 *     mora a configuração.
 *   - `discovered_tools`: último inventário REAL descoberto por `tools/list`
 *     (nunca inventário declarado pelo cliente).
 *   - Segredo continua fora: `credential_ref` e nada mais (§M4).
 *
 * Idempotente: cada coluna é criada apenas quando ainda não existe, então rodar
 * a migration num banco já migrado (ou parcialmente migrado) é seguro.
 */

const NEW_COLUMNS = [
  // Config operacional declarada (§M6).
  ['allowed_capabilities', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: false, defaultValue: [] })],
  ['allowed_tools', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: false, defaultValue: [] })],
  // §M8 — mapeamento tool remota → capability canônica, versionado.
  ['tool_capability_map', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: false, defaultValue: {} })],
  ['mapping_version', (Sequelize) => ({ type: Sequelize.STRING(32), allowNull: true })],
  // Política DECLARADA por tool (risco, side effect, confirmação, idempotência).
  ['tool_policies', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: false, defaultValue: {} })],
  // Política de endpoint (redirecionamentos, faixa privada, TLS) por conexão.
  ['endpoint_policy', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: false, defaultValue: {} })],
  // Quota local por tenant/conexão/tool (M49).
  ['quota', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: true })],
  ['timeout_ms', (Sequelize) => ({ type: Sequelize.INTEGER, allowNull: true })],
  ['retry_policy', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: false, defaultValue: {} })],
  // Último inventário REAL (`tools/list`) — não é inventário declarado (§M9).
  ['discovered_tools', (Sequelize) => ({ type: Sequelize.JSONB, allowNull: false, defaultValue: [] })],
  // Evidência de revalidação explícita de schema (§M12).
  ['schema_revalidated_at', (Sequelize) => ({ type: Sequelize.DATE, allowNull: true })],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const description = await queryInterface.describeTable('mcp_connections');
    for (const [column, build] of NEW_COLUMNS) {
      if (description[column]) continue;
      await queryInterface.addColumn('mcp_connections', column, build(Sequelize));
    }

    // Varredura do control plane por tenant + status (relatório de ecossistema).
    const { addIndexIfNotExists } = require('../migrations-helper');
    await addIndexIfNotExists(queryInterface, 'mcp_connections', ['tenant_key', 'status'], {
      name: 'mcp_connections_tenant_status_idx',
    });
  },

  async down(queryInterface) {
    const description = await queryInterface.describeTable('mcp_connections');
    for (const [column] of [...NEW_COLUMNS].reverse()) {
      if (!description[column]) continue;
      await queryInterface.removeColumn('mcp_connections', column);
    }
    await queryInterface.removeIndex('mcp_connections', 'mcp_connections_tenant_status_idx').catch(() => {});
  },
};
