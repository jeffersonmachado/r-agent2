'use strict';

/**
 * Job handler da camada de integração.
 *
 * Não cria fila/worker/scheduler próprios (missão §14): os jobs entram no
 * `executionQueueService` canônico (retry, backoff, DLQ, concorrência por
 * tenant, idempotência e observabilidade já existentes).
 *
 * Kinds:
 * - integration_initial_sync     → varredura inicial completa da conexão
 * - integration_sync_resource    → sincronização de um recurso
 * - integration_process_webhook  → processa um evento de entrada persistido
 * - integration_reconcile        → reconciliação periódica (gap + overlap)
 */

const logger = require('../../utils/logger');
const { sanitizeError, redactDeep } = require('./integrationRedaction');
const inboundService = require('./integrationInboundEventService');

const JOB_KINDS = Object.freeze([
  'integration_initial_sync',
  'integration_sync_resource',
  'integration_process_webhook',
  'integration_reconcile',
]);

function isIntegrationJobKind(kind) {
  return JOB_KINDS.includes(String(kind || ''));
}

/**
 * Processa um evento de webhook persistido: o webhook é SINAL, então buscamos o
 * estado canônico no provedor e sincronizamos o registro afetado.
 */
async function processInboundEvent({ eventId, tenantId, deps = null }) {
  const d = deps || {
    inboundService,
    connectionService: require('./integrationConnectionService'),
    getProvider: require('./integrationRegistry').getProvider,
    syncResource: require('./integrationSyncService').syncResource,
  };

  const event = await d.inboundService.getEvent({ tenantId, eventId });
  if (!event) {
    throw Object.assign(new Error('integration_inbound_event_not_found'), { code: 'integration_inbound_event_not_found' });
  }

  const resourceMap = {
    entries: 'entries',
    members: 'members',
    memberships: 'memberships',
    sales: 'sales',
    receivables: 'receivables',
    prospects: 'prospects',
    plans: 'plans',
  };
  const resource = resourceMap[event.resource_type] || null;

  try {
    if (resource) {
      // A sincronização incremental da janela é idempotente e cobre o registro
      // sinalizado mesmo que o payload venha incompleto ou fora de ordem.
      await d.syncResource({
        tenantId: event.tenant_key,
        connectionId: event.connection_id,
        resource,
        mode: 'incremental',
      });
    }
    await d.inboundService.markProcessed({ eventId: event.id, tenantId: event.tenant_key });
    return { handled: true, resource };
  } catch (error) {
    await d.inboundService.markFailed({ eventId: event.id, tenantId: event.tenant_key, error });
    throw error;
  }
}

/**
 * @returns {Promise<boolean>} true quando o job pertence à integração (e foi tratado)
 */
async function handleIntegrationJob(job, deps = null) {
  const d = deps || {};
  const kind = job && job.kind;
  if (!isIntegrationJobKind(kind)) return false;

  const payload = (job && job.payload) || {};
  const tenantId = (job && job.tenant_key) || payload.tenantId;

  switch (kind) {
    case 'integration_initial_sync': {
      const { runInitialSync } = d.runInitialSync ? d : require('./integrationSyncService');
      await runInitialSync({ tenantId, connectionId: payload.connectionId, resources: payload.resources || undefined, deps: null });
      return true;
    }
    case 'integration_sync_resource': {
      const { syncResource } = d.syncResource ? d : require('./integrationSyncService');
      await syncResource({ tenantId, connectionId: payload.connectionId, resource: payload.resource, mode: payload.mode || 'incremental' });
      return true;
    }
    case 'integration_process_webhook': {
      await processInboundEvent({ eventId: payload.eventId, tenantId, deps: d.processInboundDeps || null });
      return true;
    }
    case 'integration_reconcile': {
      const { reconcileConnection } = d.reconcileConnection ? d : require('./integrationReconciliationService');
      await reconcileConnection({ tenantId, connectionId: payload.connectionId, resources: payload.resources || undefined });
      return true;
    }
    default:
      return false;
  }
}

/** Enfileira o job canônico (nunca executa inline em rota de webhook). */
async function enqueueIntegrationJob({ tenantId, kind, payload = {}, idempotencyKey = null, runAt = null }) {
  if (!isIntegrationJobKind(kind)) {
    throw Object.assign(new Error(`unsupported_integration_job_kind:${kind}`), { code: 'unsupported_integration_job_kind' });
  }
  const { enqueueJob } = require('../executionQueueService');
  return enqueueJob({ tenantId, kind, payload, idempotencyKey, runAt });
}

module.exports = {
  JOB_KINDS,
  isIntegrationJobKind,
  handleIntegrationJob,
  processInboundEvent,
  enqueueIntegrationJob,
};
