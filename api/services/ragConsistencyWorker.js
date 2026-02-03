/**
 * Worker de consistência RAG (BD <-> Vector Store).
 *
 * Objetivo: reduzir ao máximo inconsistências inevitáveis em sistemas distribuídos:
 * - vector_ahead: vector store tem docs/chunks de documentos que já não existem no BD (órfãos)
 * - db_ahead: BD marca documentos como indexados mas o vector store está atrás/vazio
 *
 * Estratégia:
 * - Rodar periodicamente por tenant (best-effort, com lock para não sobrepor execuções)
 * - Comparar contagens (rápido) e só executar ações de correção quando necessário
 * - Auto-correções controladas por env vars (com defaults seguros)
 */
const logger = require('../utils/logger');
const { getSequelize } = require('../db/sequelize');
const { Tenant: TenantGetter, RagDocument: RagDocumentGetter } = require('../db/models');

// Lazy load para evitar ciclos
let ragDocumentsService = null;
function getRagDocumentsService() {
  if (!ragDocumentsService) ragDocumentsService = require('./ragDocumentsService');
  return ragDocumentsService;
}

function envBool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return defaultValue;
  return String(v).toLowerCase() === 'true' || String(v) === '1' || String(v).toLowerCase() === 'yes';
}

function envInt(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return defaultValue;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : defaultValue;
}

async function listTenantKeysBestEffort() {
  if (!getSequelize()) return [];
  const TenantModel = typeof TenantGetter === 'function' ? TenantGetter() : TenantGetter;
  const rows = await TenantModel.findAll({ attributes: ['tenant_key'] });
  return rows.map((r) => (r?.tenant_key ? String(r.tenant_key) : null)).filter(Boolean);
}

async function getDbIndexedCount(tenantKey) {
  if (!getSequelize()) return 0;
  const RagDocumentModel = typeof RagDocumentGetter === 'function' ? RagDocumentGetter() : RagDocumentGetter;
  // Conta apenas "indexed" (estado final), que é o que o UI compara com vector store docs
  return await RagDocumentModel.count({
    where: { tenant_key: tenantKey || null, index_status: 'indexed' },
  });
}

async function reconcileTenantOnce(tenantKey, options = {}) {
  const autoCleanOrphans = options.autoCleanOrphans !== false;
  const autoReindex = options.autoReindexDbAhead === true;

  const ragDocs = getRagDocumentsService();

  const actions = [];
  let dbIndexed = 0;
  try {
    dbIndexed = await getDbIndexedCount(tenantKey);
  } catch {
    dbIndexed = 0;
  }

  if (autoCleanOrphans) {
    try {
      const cleaned = await ragDocs.detectAndCleanOrphanedVectorDocuments(tenantKey);
      if ((cleaned.removedDocuments || 0) > 0 || (cleaned.removedChunks || 0) > 0) {
        actions.push({ type: 'clean_orphans', result: cleaned });
      }
    } catch (e) {
      actions.push({ type: 'clean_orphans_failed', error: e.message });
    }
  }

  // Health roda checagens internas e rebaixa indexed->failed quando não há chunks.
  const health = await ragDocs.getRagHealth(tenantKey, { autoRepair: false });
  if (health && health.ok && Array.isArray(health.warnings) && health.warnings.length > 0) {
    actions.push({ type: 'health_warnings', warnings: health.warnings });
  }

  // Auto reindex opcional quando há warning de indexed sem chunks.
  if (autoReindex && health?.ok && Array.isArray(health.warnings)) {
    const hasIndexedWithoutChunks = health.warnings.some((w) => w && w.code === 'RAG_INCONSISTENT_INDEXED_WITHOUT_CHUNKS');
    if (hasIndexedWithoutChunks) {
      try {
        const reindexed = await ragDocs.reindexAllNotIndexed(tenantKey, true);
        actions.push({ type: 'auto_reindex', result: reindexed });
      } catch (e) {
        actions.push({ type: 'auto_reindex_failed', error: e.message });
      }
    }
  }

  return { tenantId: tenantKey, dbIndexed, action: actions.length ? 'actions' : 'noop', actions };
}

let intervalHandle = null;
let running = false;

async function runOnce() {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;

  try {
    if (!getSequelize()) return { skipped: true, reason: 'db_unavailable' };

    const enabled = envBool('RAG_RECONCILE_ENABLED', true);
    if (!enabled) return { skipped: true, reason: 'disabled' };

    const autoCleanOrphans = envBool('RAG_RECONCILE_AUTO_CLEAN_ORPHANS', true);
    const autoReindexDbAhead = envBool('RAG_RECONCILE_AUTO_REINDEX_DB_AHEAD', true);
    const maxTenants = envInt('RAG_RECONCILE_MAX_TENANTS_PER_RUN', 3);

    const tenantKeys = await listTenantKeysBestEffort();
    if (tenantKeys.length === 0) return { skipped: false, tenants: 0, results: [] };

    const results = [];
    for (const tenantKey of tenantKeys.slice(0, Math.max(1, maxTenants))) {
      try {
        const r = await reconcileTenantOnce(tenantKey, { autoCleanOrphans, autoReindexDbAhead });
        results.push(r);
      } catch (e) {
        results.push({ tenantId: tenantKey, action: 'error', error: e.message });
      }
    }

    return { skipped: false, tenants: results.length, results };
  } finally {
    running = false;
  }
}

function startRagConsistencyWorker(options = {}) {
  const enabled = envBool('RAG_RECONCILE_ENABLED', true);
  if (!enabled) {
    logger.info('[RAGReconcile] Worker desabilitado via env');
    return { started: false, reason: 'disabled' };
  }
  if (intervalHandle) return { started: true, reason: 'already_started' };

  const intervalMs = Number.isFinite(options.intervalMs)
    ? options.intervalMs
    : envInt('RAG_RECONCILE_INTERVAL_MS', 5 * 60 * 1000); // 5 min

  // Primeiro run após um pequeno atraso para evitar competir com o bootstrap
  const initialDelayMs = envInt('RAG_RECONCILE_INITIAL_DELAY_MS', 25 * 1000);
  setTimeout(() => {
    runOnce().catch((e) => logger.warn('[RAGReconcile] runOnce falhou (ignored)', { error: e.message }));
  }, initialDelayMs);

  intervalHandle = setInterval(() => {
    runOnce().catch((e) => logger.warn('[RAGReconcile] runOnce falhou (ignored)', { error: e.message }));
  }, intervalMs);

  logger.info('[RAGReconcile] Worker iniciado', { intervalMs, initialDelayMs });
  return { started: true, intervalMs, initialDelayMs };
}

function stopRagConsistencyWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
  running = false;
}

module.exports = {
  startRagConsistencyWorker,
  stopRagConsistencyWorker,
  runOnce,
  // exportado para testes
  reconcileTenantOnce,
};

