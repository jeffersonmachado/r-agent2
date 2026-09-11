'use strict';

/**
 * IntegrationReconciliationService — reconciliação periódica.
 *
 * WEBHOOK NÃO SUBSTITUI RECONCILIAÇÃO (missão §16): alterações que não geram
 * webhook (especialmente financeiras) só aparecem por polling.
 *
 * Garantias:
 * - watermark + overlap (nada é perdido por escrita tardia no provedor);
 * - paginação paginada e retomável (delegada ao sync service);
 * - retry/idempotência no `executionQueueService` canônico;
 * - DETECÇÃO DE LACUNA: se o último sucesso está mais velho que o intervalo
 *   esperado, a reconciliação refaz a leitura COMPLETA do recurso em vez de
 *   confiar na janela incremental.
 */

const logger = require('../../utils/logger');
const { sanitizeError } = require('./integrationRedaction');

/** Recursos reconciliados por padrão (financeiro + presença são críticos). */
const DEFAULT_RESOURCES = Object.freeze(['entries', 'receivables', 'sales', 'memberships']);

/** Intervalo esperado entre execuções bem-sucedidas (default 6h, configurável). */
const DEFAULT_MAX_LAG_SECONDS = 6 * 60 * 60;

function defaultDeps() {
  return {
    syncResource: require('./integrationSyncService').syncResource,
    connectionService: require('./integrationConnectionService'),
    syncStateService: require('./integrationSyncStateService'),
    logger,
  };
}

/** Detecta lacuna: último sucesso ausente ou mais antigo que o intervalo esperado. */
function detectGap({ lastSuccessAt, now, maxLagSeconds }) {
  if (!lastSuccessAt) return { gap: true, reason: 'never_succeeded' };
  const last = lastSuccessAt instanceof Date ? lastSuccessAt : new Date(lastSuccessAt);
  if (Number.isNaN(last.getTime())) return { gap: true, reason: 'invalid_last_success' };
  const lagSeconds = Math.floor((now.getTime() - last.getTime()) / 1000);
  if (lagSeconds > maxLagSeconds) return { gap: true, reason: 'lag_exceeded', lagSeconds };
  return { gap: false, lagSeconds };
}

/**
 * Reconcilia uma conexão.
 *
 * @returns {Promise<{ status: string, resources: object[], gapsDetected: number }>}
 */
async function reconcileConnection({
  tenantId, connectionId, resources = DEFAULT_RESOURCES, maxLagSeconds = DEFAULT_MAX_LAG_SECONDS, now = new Date(), deps = null,
}) {
  const d = deps || defaultDeps();
  const results = [];
  let gapsDetected = 0;

  for (const resource of resources) {
    const state = await d.syncStateService.getState({ tenantId, connectionId, resourceType: resource });
    const gap = detectGap({ lastSuccessAt: state.last_success_at, now, maxLagSeconds });
    if (gap.gap) gapsDetected += 1;

    try {
      // Com lacuna, refaz a leitura completa (initial); sem lacuna, incremental
      // com overlap — que já cobre escrita tardia no provedor.
      const result = await d.syncResource({
        tenantId,
        connectionId,
        resource,
        mode: gap.gap ? 'initial' : 'incremental',
        now,
      });
      results.push({ resource, status: 'completed', gap: gap.gap, gapReason: gap.reason || null, stats: result.stats });
    } catch (error) {
      const sanitized = sanitizeError(error);
      if (d.logger && d.logger.warn) {
        d.logger.warn('[Integration] reconciliação falhou para recurso', {
          resource, code: sanitized.code, connectionId,
        });
      }
      results.push({ resource, status: 'failed', gap: gap.gap, gapReason: gap.reason || null, error: sanitized });
    }
  }

  const failed = results.filter((r) => r.status === 'failed').length;
  return {
    status: failed === 0 ? 'completed' : 'partial_failure',
    resources: results,
    gapsDetected,
    failed,
  };
}

module.exports = {
  reconcileConnection,
  detectGap,
  DEFAULT_RESOURCES,
  DEFAULT_MAX_LAG_SECONDS,
};
