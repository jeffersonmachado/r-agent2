'use strict';

/**
 * Helper de teste: Postgres REAL via Sequelize (sem dublê).
 *
 * Os testes de persistência do MCP Control Plane DEVEM falar com o banco
 * configurado (`.env` → `DATABASE_URL`). Um harness de JSON persistido não
 * provaria nada sobre o contrato do model, do índice único ou do tipo JSONB — que
 * são exatamente as partes que já quebraram.
 *
 * Se o banco não estiver acessível, o teste é PULADO de forma explícita e
 * reportada (`DB_SKIP_REASON`), nunca silenciosamente "verde".
 */

const sequelizeModule = require('../../../../api/db/sequelize');

const DB_SKIP_REASON = 'postgres_unreachable';

async function tryConnectDatabase({ attempts = 2, delayMs = 250 } = {}) {
  try {
    await sequelizeModule.connect(attempts, delayMs);
    return { available: true, reason: null };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

async function closeDatabase() {
  try {
    await sequelizeModule.close();
  } catch (_) {
    /* best-effort: a suíte não deve falhar por isso */
  }
}

/**
 * Tenant de teste único por execução — evita colisão com dados reais e com
 * execuções paralelas, e permite limpeza determinística.
 */
function uniqueTenantKey(prefix = 'mcp-contract') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Remove TODAS as linhas dos tenants usados pelo teste. */
async function purgeTenants(tenantKeys = []) {
  // O model exporta a FACTORY direto (convenção de `api/db/models`).
  const getMcpConnectionModel = require('../../../../api/db/models/McpConnection');
  const Model = getMcpConnectionModel();
  for (const tenantKey of tenantKeys) {
    await Model.destroy({ where: { tenant_key: String(tenantKey) } });
  }
}

module.exports = {
  DB_SKIP_REASON,
  tryConnectDatabase,
  closeDatabase,
  uniqueTenantKey,
  purgeTenants,
};
