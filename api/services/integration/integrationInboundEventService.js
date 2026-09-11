'use strict';

/**
 * IntegrationInboundEventService — persistência deduplicada de eventos externos.
 *
 * O webhook é tratado como SINAL: é persistido, deduplicado e enfileirado; o
 * estado canônico é sempre buscado no provedor. Isso evita depender de payload
 * completo e de ordem de entrega.
 *
 * Segurança: `payload` é sanitizado antes de persistir (`redactDeep`) — nenhum
 * Authorization, token, PAN ou dado biométrico entra no banco.
 */

const { getSequelize } = require('../../db/sequelize');
const { IntegrationInboundEvent } = require('../../db/models');
const { Op } = require('sequelize');
const { IntegrationError, INTEGRATION_ERROR_CODES, sanitizeError, redactDeep } = require('./integrationRedaction');
const {
  makeId, dbAvailable, isUniqueViolation, deterministicKey, optionalString, optionalDate,
} = require('./integrationDb');

const PROCESSING_STATE = Object.freeze({
  RECEIVED: 'received',
  QUEUED: 'queued',
  PROCESSED: 'processed',
  FAILED: 'failed',
  DUPLICATE: 'duplicate',
});

/**
 * Chave de idempotência determinística do evento.
 * Ordem de preferência: id explícito do provedor; senão o par tipo+recurso.
 */
function buildIdempotencyKey({ provider, eventType, externalEventId = null, resourceType = null, externalResourceId = null }) {
  if (externalEventId) return deterministicKey(provider, 'event', externalEventId);
  return deterministicKey(provider, eventType, resourceType, externalResourceId);
}

/**
 * Registra (ou reconhece) um evento externo.
 *
 * @returns {Promise<{ event: object, duplicate: boolean }>}
 */
async function recordEvent({
  tenantId,
  connectionId,
  provider,
  eventType,
  externalEventId = null,
  resourceType = null,
  externalResourceId = null,
  payload = {},
  receivedAt = new Date(),
  metadata = {},
} = {}) {
  if (!dbAvailable()) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.DB_UNAVAILABLE, 'banco indisponível para integração');
  }
  const tenant = optionalString(tenantId, 255);
  const connection = optionalString(connectionId, 255);
  const providerId = optionalString(provider, 64);
  const type = optionalString(eventType, 96);
  if (!tenant || !connection || !providerId || !type) {
    throw new IntegrationError(INTEGRATION_ERROR_CODES.CONTRACT_VIOLATION, 'evento de entrada exige tenant, connection, provider e eventType');
  }

  const idempotencyKey = buildIdempotencyKey({
    provider: providerId, eventType: type, externalEventId, resourceType, externalResourceId,
  });
  const Model = IntegrationInboundEvent();
  const where = { tenant_key: tenant, provider: providerId, idempotency_key: idempotencyKey };

  const existing = await Model.findOne({ where });
  if (existing) {
    const plain = existing.toJSON ? existing.toJSON() : existing;
    // Reentrega: incrementa tentativa observada sem reprocessar estado.
    await existing.update({ attempts: Number(plain.attempts || 0) + 1 });
    return { event: { ...plain, attempts: Number(plain.attempts || 0) + 1 }, duplicate: true };
  }

  const record = {
    id: makeId('ievt'),
    tenant_key: tenant,
    connection_id: connection,
    provider: providerId,
    event_type: type,
    external_event_id: optionalString(externalEventId, 255),
    resource_type: optionalString(resourceType, 64),
    external_resource_id: optionalString(externalResourceId, 255),
    idempotency_key: idempotencyKey,
    payload: redactDeep(payload),
    received_at: optionalDate(receivedAt) || new Date(),
    processing_state: PROCESSING_STATE.RECEIVED,
    attempts: 1,
    metadata: metadata && typeof metadata === 'object' ? redactDeep(metadata) : {},
  };

  try {
    const row = await Model.create(record);
    return { event: row.toJSON ? row.toJSON() : row, duplicate: false };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await Model.findOne({ where });
      if (raced) {
        const plain = raced.toJSON ? raced.toJSON() : raced;
        return { event: plain, duplicate: true };
      }
    }
    throw error;
  }
}

async function transitionEvent({ eventId, tenantId, processingState, error = null, incrementAttempts = false }) {
  if (!dbAvailable()) return null;
  const where = { id: String(eventId) };
  if (tenantId) where.tenant_key = String(tenantId);
  const Model = IntegrationInboundEvent();
  const row = await Model.findOne({ where });
  if (!row) return null;
  const update = { processing_state: processingState };
  if (processingState === PROCESSING_STATE.PROCESSED) update.processed_at = new Date();
  if (error !== null) update.error = error ? String(sanitizeError(error).message).slice(0, 1000) : null;
  if (incrementAttempts) update.attempts = Number(row.attempts || 0) + 1;
  await row.update(update);
  return row.toJSON ? row.toJSON() : row;
}

const markQueued = (params) => transitionEvent({ ...params, processingState: PROCESSING_STATE.QUEUED });
const markProcessed = (params) => transitionEvent({ ...params, processingState: PROCESSING_STATE.PROCESSED });
const markFailed = (params) => transitionEvent({ ...params, processingState: PROCESSING_STATE.FAILED, incrementAttempts: true });

async function getEvent({ tenantId, eventId }) {
  if (!dbAvailable()) return null;
  const row = await IntegrationInboundEvent().findOne({ where: { id: String(eventId), tenant_key: String(tenantId) } });
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

async function listPendingEvents({ tenantId, connectionId = null, limit = 50 } = {}) {
  if (!dbAvailable()) return { items: [], total: 0 };
  const where = { tenant_key: String(tenantId), processing_state: { [Op.in]: [PROCESSING_STATE.RECEIVED, PROCESSING_STATE.QUEUED, PROCESSING_STATE.FAILED] } };
  if (connectionId) where.connection_id = String(connectionId);
  const rows = await IntegrationInboundEvent().findAll({
    where, order: [['received_at', 'ASC']], limit: Math.min(Number(limit) || 50, 500),
  });
  const items = rows.map((row) => (row.toJSON ? row.toJSON() : row));
  return { items, total: items.length };
}

module.exports = {
  PROCESSING_STATE,
  buildIdempotencyKey,
  recordEvent,
  transitionEvent,
  markQueued,
  markProcessed,
  markFailed,
  getEvent,
  listPendingEvents,
};
