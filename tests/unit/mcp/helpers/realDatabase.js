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

async function tryConnectDatabase({ attempts = 2, delayMs = 250, purgeStaleFixtures = true } = {}) {
  try {
    await sequelizeModule.connect(attempts, delayMs);
    if (purgeStaleFixtures) {
      // Autolimpeza da ORIGEM do vazamento: uma execução interrompida nunca roda
      // o `afterAll`, e as fixtures ficam no banco para sempre. Best-effort: se
      // falhar, a suíte não pode quebrar por causa da limpeza.
      try {
        await purgeStaleFixtureTenants();
      } catch (_) {
        /* best-effort */
      }
    }
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

/**
 * Formato EXATO dos tenants descartáveis criados por esta suíte:
 * `mcp-<slug>-<epoch13>-<rand6>` (ver `uniqueTenantKey`). O epoch embutido
 * permite decidir se a linha é SOBRA de uma execução anterior interrompida —
 * sem depender de mtime nem de julgamento humano.
 */
const FIXTURE_TENANT_RE = /^mcp-[a-z0-9-]+-(\d{13})-([a-z0-9]{6})$/;

/**
 * @param {string} tenantKey
 * @param {{now?: number, olderThanMs?: number}} [opts]
 * @returns {boolean} true se é fixture descartável E antiga o bastante para ser
 * considerada órfã (a execução que a criou não conseguiu limpar a si mesma).
 */
function isStaleFixtureTenant(tenantKey, { now = Date.now(), olderThanMs = 3600000 } = {}) {
  const match = FIXTURE_TENANT_RE.exec(String(tenantKey || ''));
  if (!match) return false;
  const createdAt = Number(match[1]);
  if (!Number.isFinite(createdAt)) return false;
  return now - createdAt > olderThanMs;
}

/**
 * Remove fixtures órfãs de execuções anteriores.
 *
 * Defeito real (2026-09-18): uma execução de Jest interrompida nunca roda o
 * `afterAll` que purga; 17 linhas ficaram ENABLED no banco real e uma delas
 * (endpoint loopback) abortava a composição MCP inteira no startup — o MCP
 * simplesmente não funcionava no runtime. O isolamento na fronteira
 * (`partitionConnectionsByPolicy`) já impede que isso derrube o runtime; isto
 * ataca a ORIGEM: o banco volta a ficar limpo sozinho na próxima suíte.
 *
 * Escopo fechado: só linhas que casam o padrão EXATO da fixture E mais antigas
 * que `olderThanMs`. Tenant real (ex.: `system`) nunca casa.
 *
 * @returns {Promise<string[]>} tenants removidos
 */
async function purgeStaleFixtureTenants({ olderThanMs = 3600000, now = Date.now() } = {}) {
  const getMcpConnectionModel = require('../../../../api/db/models/McpConnection');
  const Model = getMcpConnectionModel();
  const rows = await Model.findAll({});
  const stale = (rows || []).filter((row) => isStaleFixtureTenant(row.tenant_key, { now, olderThanMs }));
  for (const row of stale) {
    await Model.destroy({ where: { tenant_key: String(row.tenant_key) } });
  }
  return stale.map((row) => row.tenant_key);
}

module.exports = {
  DB_SKIP_REASON,
  FIXTURE_TENANT_RE,
  tryConnectDatabase,
  closeDatabase,
  uniqueTenantKey,
  purgeTenants,
  isStaleFixtureTenant,
  purgeStaleFixtureTenants,
};
