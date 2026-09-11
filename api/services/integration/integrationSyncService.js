'use strict';

/**
 * IntegrationSyncService — orquestra a importação/sincronização read-only de um
 * provedor externo para os domínios canônicos do RAP.
 *
 * Fluxo:
 *   connection + credentials
 *     → provider adapter (DTO normalizado)
 *     → importer do recurso (domínio canônico)
 *     → IntegrationObjectLink (identidade) + IntegrationSyncState (cursor)
 *
 * Garantias:
 * - tenant sempre explícito e resolvido server-side;
 * - paginação com cursor persistido (retomada após falha);
 * - watermark só avança em sucesso;
 * - overlap controlado na janela incremental;
 * - idempotência em todos os importadores;
 * - métricas provider-neutral por execução.
 *
 * NÃO cria fila/worker/scheduler próprio: usa `executionQueueService` e o
 * scheduler canônico (ver `integrationJobHandler`).
 */

const { appendEventV1 } = require('../eventLedgerService');
const { getProvider } = require('./integrationRegistry');
const connectionService = require('./integrationConnectionService');
const syncStateService = require('./integrationSyncStateService');
const { IntegrationError, INTEGRATION_ERROR_CODES, sanitizeError, redactDeep } = require('./integrationRedaction');
const { createStats } = require('./importers/importerSupport');
const { importPerson } = require('./importers/memberImporter');
const { importMembership, mergePlanCatalog } = require('./importers/membershipImporter');
const { importEntry } = require('./importers/attendanceImporter');
const { importTransaction } = require('./importers/billingImporter');

/** Ordem de dependência do initial sync (missão §7). */
const RESOURCE_ORDER = Object.freeze(['plans', 'members', 'prospects', 'memberships', 'entries', 'sales', 'receivables']);

const IMPORTABLE_RESOURCES = Object.freeze(['members', 'prospects', 'memberships', 'entries', 'sales', 'receivables']);

/**
 * Recursos sincronizáveis. `plans` não tem importador de domínio (não existe
 * entidade canônica de plano no RAP): é sincronizado como catálogo curado e
 * limitado no estado de sync, para referência operacional.
 */
const SYNCABLE_RESOURCES = Object.freeze(['plans', ...IMPORTABLE_RESOURCES]);

function defaultDeps() {
  return {
    connectionService,
    syncStateService,
    getProvider,
    appendEventV1,
    importPerson,
    importMembership,
    importEntry,
    importTransaction,
    logger: require('../../utils/logger'),
  };
}

function assertTenant(tenantId) {
  if (!tenantId || String(tenantId).trim() === '') {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.TENANT_REQUIRED, 'tenantId é obrigatório para sincronizar');
  }
  return String(tenantId);
}

/** Executa o importador do recurso para um registro normalizado. */
async function importRecord({ resource, record, tenantId, connectionId, connection, stats, deps }) {
  const base = { record, tenantId, connectionId, connection, stats };
  switch (resource) {
    case 'members':
      return deps.importPerson({ ...base, resourceType: 'members' });
    case 'prospects':
      return deps.importPerson({ ...base, resourceType: 'prospects' });
    case 'memberships':
      return deps.importMembership(base);
    case 'entries':
      return deps.importEntry(base);
    case 'sales':
    case 'receivables':
      return deps.importTransaction({ ...base, resourceType: resource });
    default:
      throw new IntegrationError(INTEGRATION_ERROR_CODES.RESOURCE_UNSUPPORTED, `recurso sem importador: ${resource}`, { resource });
  }
}

/**
 * Sincroniza UM recurso de UMA conexão.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.connectionId
 * @param {string} params.resource
 * @param {'initial'|'incremental'} [params.mode]
 * @param {number} [params.maxPages]
 * @param {object} [params.deps] injeção para teste
 * @returns {Promise<{ status: string, resource: string, stats: object, pagesProcessed: number, watermarkAt: string|null }>}
 */
async function syncResource({
  tenantId, connectionId, resource, mode = 'incremental', maxPages = null, deps = null, now = new Date(),
}) {
  const d = deps || defaultDeps();
  const tenant = assertTenant(tenantId);
  const resourceName = String(resource);
  if (!SYNCABLE_RESOURCES.includes(resourceName)) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.RESOURCE_UNSUPPORTED, `recurso não sincronizável: ${resourceName}`, {
      resource: resourceName, syncable: [...SYNCABLE_RESOURCES],
    });
  }

  const connectionRow = await d.connectionService.getConnectionRow({ tenantId: tenant, connectionId });
  if (!connectionRow) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONNECTION_NOT_FOUND, 'conexão não encontrada', { connectionId });
  }
  const providerId = connectionRow.provider;
  const adapter = d.getProvider(providerId);
  const credentials = await d.connectionService.getDecryptedCredentials({ tenantId: tenant, connectionId: connectionRow.id });

  const state = await d.syncStateService.ensureState({ tenantId: tenant, connectionId: connectionRow.id, provider: providerId, resourceType: resourceName });
  const window = d.syncStateService.computeWindow({ state, now });
  // `initial` é uma leitura da BASE INTEIRA (reimportação real, portanto prova
  // de idempotência de verdade). `incremental` usa watermark + overlap.
  const since = mode === 'initial' ? null : (window.since ? window.since.toISOString() : null);
  const stats = createStats();
  const startedAt = new Date();

  await d.syncStateService.markRunning({ tenantId: tenant, connectionId: connectionRow.id, resourceType: resourceName, runAt: startedAt });
  await d.appendEventV1({
    tenantId: tenant,
    type: 'integration.sync.started',
    source: 'integration.sync',
    occurredAt: startedAt,
    correlationId: `${connectionRow.id}:${resourceName}`,
    subject: { type: 'integration_connection', id: String(connectionRow.id) },
    actor: { type: 'integration', id: providerId },
    idempotencyKey: `integration:sync_started:${connectionRow.id}:${resourceName}:${startedAt.toISOString()}`,
    payload: { provider: providerId, connectionId: connectionRow.id, resource: resourceName, mode, since },
  }).catch(() => {});

  let cursor = mode === 'incremental' && state.cursor ? state.cursor : null;
  let pagesProcessed = 0;
  let planCatalog = state.stats && state.stats.planCatalog ? state.stats.planCatalog : [];

  try {
    for (;;) {
      if (Number.isFinite(maxPages) && pagesProcessed >= maxPages) break;
      // eslint-disable-next-line no-await-in-loop
      const page = await adapter.fetchPage({
        connection: connectionRow,
        credentials,
        resource: resourceName,
        cursor,
        since,
      });
      pagesProcessed += 1;
      stats.pagesProcessed = pagesProcessed;

      if (resourceName === 'plans') {
        planCatalog = mergePlanCatalog(planCatalog, page.items);
        stats.fetched += page.items.length;
        stats.unchanged += page.items.length;
      } else {
        for (const item of page.items) {
          stats.fetched += 1;
          // eslint-disable-next-line no-await-in-loop
          const result = await importRecord({
            resource: resourceName,
            record: item,
            tenantId: tenant,
            connectionId: connectionRow.id,
            connection: connectionRow,
            stats,
            deps: d,
          });
          if (result && result.outcome === 'created') stats.created += 1;
          else if (result && result.outcome === 'updated') stats.updated += 1;
          else if (result && result.outcome === 'rejected') stats.rejected += 1;
          else stats.unchanged += 1;
        }
      }

      for (const rejected of page.rejected || []) {
        stats.fetched += 1;
        stats.rejected += 1;
      }

      // Persiste o cursor a cada página: uma falha posterior retoma daqui.
      // eslint-disable-next-line no-await-in-loop
      await d.syncStateService.saveCursor({
        tenantId: tenant, connectionId: connectionRow.id, resourceType: resourceName, cursor: page.nextCursor, pageOffset: pagesProcessed,
      });

      cursor = page.nextCursor;
      if (!page.hasMore) break;
    }

    const watermarkAt = window.until;
    const nextStats = {
      lastRun: {
        resource: resourceName,
        mode,
        pagesProcessed,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        fetched: stats.fetched,
        created: stats.created,
        updated: stats.updated,
        unchanged: stats.unchanged,
        rejected: stats.rejected,
        conflicts: stats.conflicts.length,
      },
      conflicts: stats.conflicts.slice(0, 50),
      ...(planCatalog.length > 0 ? { planCatalog } : {}),
    };

    await d.syncStateService.recordSuccess({
      tenantId: tenant,
      connectionId: connectionRow.id,
      resourceType: resourceName,
      watermarkAt,
      stats: nextStats,
      initialSyncCompleted: mode === 'initial',
    });
    await d.connectionService.markHealthy({ tenantId: tenant, connectionId: connectionRow.id, syncedAt: new Date() });
    await d.appendEventV1({
      tenantId: tenant,
      type: 'integration.sync.completed',
      source: 'integration.sync',
      occurredAt: new Date(),
      correlationId: `${connectionRow.id}:${resourceName}`,
      subject: { type: 'integration_connection', id: String(connectionRow.id) },
      actor: { type: 'integration', id: providerId },
      idempotencyKey: `integration:sync_completed:${connectionRow.id}:${resourceName}:${startedAt.toISOString()}`,
      payload: redactDeep({ provider: providerId, connectionId: connectionRow.id, resource: resourceName, mode, ...nextStats.lastRun }),
    }).catch(() => {});

    return {
      status: 'completed',
      resource: resourceName,
      stats: nextStats.lastRun,
      pagesProcessed,
      watermarkAt: watermarkAt.toISOString(),
    };
  } catch (error) {
    const sanitized = await d.syncStateService.recordFailure({
      tenantId: tenant, connectionId: connectionRow.id, resourceType: resourceName, error,
    });
    await d.connectionService.markFailed({ tenantId: tenant, connectionId: connectionRow.id, error });
    await d.appendEventV1({
      tenantId: tenant,
      type: 'integration.sync.failed',
      source: 'integration.sync',
      occurredAt: new Date(),
      correlationId: `${connectionRow.id}:${resourceName}`,
      subject: { type: 'integration_connection', id: String(connectionRow.id) },
      actor: { type: 'integration', id: providerId },
      idempotencyKey: null,
      payload: redactDeep({ provider: providerId, connectionId: connectionRow.id, resource: resourceName, mode, error: sanitized, pagesProcessed }),
    }).catch(() => {});
    throw error;
  }
}

/**
 * Initial sync completo da conexão, na ordem de dependência.
 * Para no primeiro recurso que falhar (não esconde falha parcial).
 */
async function runInitialSync({ tenantId, connectionId, resources = RESOURCE_ORDER, maxPages = null, deps = null }) {
  const d = deps || defaultDeps();
  const results = [];
  for (const resource of RESOURCE_ORDER.filter((r) => resources.includes(r))) {
    // eslint-disable-next-line no-await-in-loop
    const result = await syncResource({
      tenantId, connectionId, resource, mode: 'initial', maxPages, deps: d,
    });
    results.push(result);
  }
  return { status: 'completed', resources: results };
}

module.exports = {
  RESOURCE_ORDER,
  IMPORTABLE_RESOURCES,
  SYNCABLE_RESOURCES,
  syncResource,
  runInitialSync,
  importRecord,
  defaultDeps,
};
