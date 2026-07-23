'use strict';

/**
 * Learning Core — Interaction Ingest Service.
 *
 * Recebe lotes de eventos de interação de usuário na UI (interactionTracker
 * do frontend), valida, sanitiza (sem PII — whitelist de campos) e persiste
 * no event ledger canônico como `learning.interaction.*`.
 *
 * Domínio separado do RAP Learn (aprendizado de máquina): aqui o sujeito é
 * o USUÁRIO. Convenções (ledger, tenant) são espelhadas, dados nunca misturados.
 *
 * O agregado `UserInteractionSession` é dado derivado (reconstruível a partir
 * do ledger, que é a fonte de verdade): falha na atualização dele é logada
 * de forma explícita, mas não derruba a ingestão. Falha do ledger propaga.
 */

const { appendEventV1 } = require('../../services/eventLedgerService');
const getUserInteractionSessionModel = require('../../db/models/UserInteractionSession');
const logger = require('../../utils/logger');

const MAX_BATCH_SIZE = 50;
const MAX_METADATA_BYTES = 2048;

const INTERACTION_TYPES = new Set([
  'navigation',
  'click',
  'api_call',
  'flow_completed',
  'flow_abandoned',
  'error',
]);

function cleanString(value, maxLen) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function cleanMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const json = JSON.stringify(value);
    if (json.length > MAX_METADATA_BYTES) return {};
    return JSON.parse(json);
  } catch (_) {
    return {};
  }
}

/**
 * Sanitização por whitelist: o tracker nunca envia valores de campos,
 * textos digitados ou payloads — apenas metadados estruturais de navegação.
 */
function sanitizeEvent(event = {}) {
  const type = cleanString(event.type, 40);
  if (!type || !INTERACTION_TYPES.has(type)) return null;

  const occurredAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) return null;

  return {
    type: `learning.interaction.${type}`,
    occurredAt,
    clientEventId: cleanString(event.clientEventId, 80),
    payload: {
      route: cleanString(event.route, 200),
      target: cleanString(event.target, 120),
      durationMs: cleanNumber(event.durationMs),
      status: cleanString(event.status, 40),
      errorCode: cleanString(event.errorCode, 80),
      flowId: cleanString(event.flowId, 120),
      metadata: cleanMetadata(event.metadata),
    },
  };
}

async function updateSessionAggregate({ tenantId, agentId, username, sessionId, events }) {
  const Model = getUserInteractionSessionModel();
  const routes = Array.from(new Set(events.map((e) => e.payload.route).filter(Boolean))).slice(0, 100);
  const now = new Date();

  const [session] = await Model.findOrCreate({
    where: { tenant_id: tenantId, session_id: sessionId },
    defaults: {
      tenant_id: tenantId,
      agentId: String(agentId),
      username: username || null,
      sessionId,
      startedAt: now,
      lastSeenAt: now,
      eventCount: 0,
      routesVisited: [],
      summary: {},
    },
  });

  const mergedRoutes = Array.from(new Set([...(session.routesVisited || []), ...routes])).slice(0, 200);
  await session.update({
    agentId: String(agentId),
    username: username || session.username,
    lastSeenAt: now,
    eventCount: Number(session.eventCount || 0) + events.length,
    routesVisited: mergedRoutes,
  });
}

/**
 * Ingere um lote de interações de um usuário autenticado.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string|number} args.agentId
 * @param {string} [args.username]
 * @param {string} args.sessionId
 * @param {Array} args.events
 * @returns {Promise<{accepted: number, rejected: number}>}
 */
async function ingestInteractionBatch({ tenantId, agentId, username, sessionId, events }) {
  const cleanSessionId = cleanString(sessionId, 80);
  if (!cleanSessionId) {
    const error = new Error('sessionId obrigatorio');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (!Array.isArray(events) || events.length === 0) {
    const error = new Error('events deve ser um array nao vazio');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (events.length > MAX_BATCH_SIZE) {
    const error = new Error(`lote excede o maximo de ${MAX_BATCH_SIZE} eventos`);
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const sanitized = events.map(sanitizeEvent).filter(Boolean);
  const rejected = events.length - sanitized.length;

  let accepted = 0;
  for (const event of sanitized) {
    await appendEventV1({
      tenantId,
      type: event.type,
      source: 'learning-core',
      occurredAt: event.occurredAt,
      correlationId: cleanSessionId,
      subject: { type: 'user_session', id: cleanSessionId },
      actor: { type: 'agent', id: String(agentId) },
      idempotencyKey: event.clientEventId ? `${cleanSessionId}:${event.clientEventId}` : null,
      payload: event.payload,
    });
    accepted += 1;
  }

  if (accepted > 0) {
    try {
      await updateSessionAggregate({
        tenantId,
        agentId,
        username,
        sessionId: cleanSessionId,
        events: sanitized,
      });
    } catch (error) {
      // Agregado derivado do ledger: falha é explícita no log, não silenciosa.
      logger.error('[learning-core] Falha ao atualizar agregado de sessao (ledger íntegro)', {
        tenantId,
        sessionId: cleanSessionId,
        error: error.message,
      });
    }

    // Tutor (níveis 0-1): avalia dificuldade e emite hint contextual via WS.
    // Best-effort: nunca derruba a ingestão; falhas são explícitas no log.
    try {
      const tutorService = require('./tutorService');
      await tutorService.evaluateAndMaybeHint({
        tenantId,
        agentId,
        sessionId: cleanSessionId,
        events: sanitized,
      });
    } catch (error) {
      logger.error('[learning-core] Falha ao avaliar hint do tutor (ingest íntegra)', {
        tenantId,
        sessionId: cleanSessionId,
        error: error.message,
      });
    }
  }

  return { accepted, rejected };
}

module.exports = {
  ingestInteractionBatch,
  INTERACTION_TYPES,
  MAX_BATCH_SIZE,
};
