'use strict';

/**
 * IntegrationSyncStateService — cursor/watermark por conexão e recurso.
 *
 * Suporta: initial sync, incremental sync, retomada após falha, overlap
 * controlado (janela re-lida de propósito para capturar escrita tardia),
 * reprocessamento idempotente e detecção de lacuna (gap) na reconciliação.
 */

const { getSequelize } = require('../../db/sequelize');
const { IntegrationSyncState } = require('../../db/models');
const { IntegrationError, INTEGRATION_ERROR_CODES, sanitizeError } = require('./integrationRedaction');
const {
  makeId, dbAvailable, isUniqueViolation, optionalString, optionalDate,
} = require('./integrationDb');

const DEFAULT_OVERLAP_SECONDS = 3600;

const SYNC_STATUS = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  FAILED: 'failed',
});

function requireDb() {
  if (!dbAvailable()) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.DB_UNAVAILABLE, 'banco indisponível para integração');
  }
}

function scopeOf({ tenantId, connectionId, resourceType }) {
  const scope = {
    tenant_key: optionalString(tenantId, 255),
    connection_id: optionalString(connectionId, 255),
    resource_type: optionalString(resourceType, 64),
  };
  if (!scope.tenant_key || !scope.connection_id || !scope.resource_type) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'escopo de sync incompleto', scope);
  }
  return scope;
}

/** @returns {Promise<object>} estado (defaults quando ainda não existe) */
async function getState({ tenantId, connectionId, resourceType }) {
  const scope = scopeOf({ tenantId, connectionId, resourceType });
  if (!dbAvailable()) {
    return { ...scope, provider: null, status: SYNC_STATUS.IDLE, watermark_at: null, overlap_seconds: DEFAULT_OVERLAP_SECONDS, stats: {}, persisted: false };
  }
  const row = await IntegrationSyncState().findOne({ where: scope });
  if (!row) {
    return {
      ...scope,
      provider: null,
      status: SYNC_STATUS.IDLE,
      watermark_at: null,
      overlap_seconds: DEFAULT_OVERLAP_SECONDS,
      cursor: null,
      page_offset: 0,
      initial_sync_completed_at: null,
      stats: {},
      persisted: false,
    };
  }
  return { ...(row.toJSON ? row.toJSON() : row), persisted: true };
}

/** Cria o estado se ainda não existir (idempotente, seguro sob corrida). */
async function ensureState({ tenantId, connectionId, provider, resourceType, overlapSeconds = DEFAULT_OVERLAP_SECONDS }) {
  requireDb();
  const scope = scopeOf({ tenantId, connectionId, resourceType });
  const Model = IntegrationSyncState();
  const existing = await Model.findOne({ where: scope });
  if (existing) return existing.toJSON ? existing.toJSON() : existing;
  try {
    const row = await Model.create({
      id: makeId('isync'),
      ...scope,
      provider: String(provider || '').trim().toLowerCase(),
      status: SYNC_STATUS.IDLE,
      overlap_seconds: Number.isFinite(overlapSeconds) ? overlapSeconds : DEFAULT_OVERLAP_SECONDS,
    });
    return row.toJSON ? row.toJSON() : row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await Model.findOne({ where: scope });
      if (raced) return raced.toJSON ? raced.toJSON() : raced;
    }
    throw error;
  }
}

/**
 * Janela de leitura incremental: `[watermark - overlap, now]`.
 * O overlap existe para não perder registros que chegam com atraso no provedor.
 * Sem watermark (initial sync) a janela é aberta (`since = null`).
 */
function computeWindow({ state, now = new Date(), overlapSeconds = null } = {}) {
  const until = now instanceof Date ? now : new Date(now);
  const watermark = optionalDate(state && state.watermark_at);
  if (!watermark) return { since: null, until, isInitial: true };
  const overlap = Number.isFinite(overlapSeconds)
    ? overlapSeconds
    : (Number.isFinite(state.overlap_seconds) ? Number(state.overlap_seconds) : DEFAULT_OVERLAP_SECONDS);
  const since = new Date(watermark.getTime() - Math.max(0, overlap) * 1000);
  return { since, until, isInitial: false };
}

async function markRunning({ tenantId, connectionId, resourceType, runAt = new Date() }) {
  requireDb();
  const scope = scopeOf({ tenantId, connectionId, resourceType });
  const Model = IntegrationSyncState();
  await Model.update({ status: SYNC_STATUS.RUNNING, last_run_at: runAt }, { where: scope });
}

async function saveCursor({ tenantId, connectionId, resourceType, cursor = null, pageOffset = null }) {
  if (!dbAvailable()) return null;
  const scope = scopeOf({ tenantId, connectionId, resourceType });
  const update = { cursor: optionalString(cursor, 512) };
  if (pageOffset !== null) update.page_offset = Number(pageOffset) || 0;
  await IntegrationSyncState().update(update, { where: scope });
  return update;
}

async function recordSuccess({
  tenantId, connectionId, resourceType, watermarkAt = new Date(), stats = {}, initialSyncCompleted = false,
}) {
  requireDb();
  const scope = scopeOf({ tenantId, connectionId, resourceType });
  const update = {
    status: SYNC_STATUS.IDLE,
    watermark_at: optionalDate(watermarkAt) || new Date(),
    last_success_at: new Date(),
    last_error: null,
    cursor: null,
    page_offset: 0,
    stats: stats && typeof stats === 'object' ? stats : {},
  };
  if (initialSyncCompleted) update.initial_sync_completed_at = new Date();
  await IntegrationSyncState().update(update, { where: scope });
  return update;
}

async function recordFailure({ tenantId, connectionId, resourceType, error }) {
  const scope = scopeOf({ tenantId, connectionId, resourceType });
  const sanitized = sanitizeError(error);
  if (!dbAvailable()) return sanitized;
  // Watermark NÃO avança em falha: a próxima execução retoma do último ponto bom.
  await IntegrationSyncState().update(
    { status: SYNC_STATUS.FAILED, last_error: sanitized.message },
    { where: scope },
  );
  return sanitized;
}

module.exports = {
  SYNC_STATUS,
  DEFAULT_OVERLAP_SECONDS,
  getState,
  ensureState,
  computeWindow,
  markRunning,
  saveCursor,
  recordSuccess,
  recordFailure,
};
