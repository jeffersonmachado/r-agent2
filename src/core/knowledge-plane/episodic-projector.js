'use strict';

/**
 * Episodic Knowledge Projector — projeta eventos do Event Ledger
 * em conhecimento episódico sanitizado para o Knowledge Plane.
 *
 * Pipeline:
 *   Event Ledger → filter relevant → sanitize → project → knowledge record
 *
 * Regras:
 *  - Nunca indexar o Event Ledger bruto
 *  - Apenas eventos validados e relevantes
 *  - Sempre respeitar tenant, classification, sensitivity
 *  - Conteúdo sensitivo é redactado antes da projeção
 */

const { buildProvenance, SOURCE_KINDS } = require('./provenance');
const { KNOWLEDGE_TYPES } = require('./knowledge-router');

function defaultLogger() {
  try { return require('../../../api/utils/logger'); } catch (_) { return { info: () => {}, warn: () => {}, error: () => {} }; }
}

// ---------------------------------------------------------------------------
// Event type → Episodic Knowledge mapping
// ---------------------------------------------------------------------------

const SYSTEM_EVENT_TYPES = Object.freeze([
  'agent.execution.failed',
  'business.outcome.failed',
  'tool.execution.failed',
  'process.failed',
  'incident.detected',
  'deployment.completed',
  'release.completed',
  'regression.detected',
  'qa.failure',
  'root_cause.identified',
  'fix.validated',
]);

const OPERATIONAL_EVENT_TYPES = Object.freeze([
  'business.outcome.validated',
  'customer.journey.completed',
]);

/**
 * Projeta eventos do ledger em registros de conhecimento episódico.
 *
 * @param {Object} args
 * @param {Array} args.events - eventos do Event Ledger
 * @param {string} args.tenantId
 * @param {string} [args.domain] - SYSTEM ou OPERATIONAL
 * @param {Object} [args.deps] - dependências
 * @returns {Array} registros de conhecimento episódico
 */
function projectEpisodicKnowledge({ events = [], tenantId, domain = 'SYSTEM', deps = {} } = {}) {
  const log = deps.logger || defaultLogger();
  const records = [];

  for (const event of events) {
    if (!event || !event.type) continue;

    // Filtrar por tipo de evento relevante
    const isSystem = SYSTEM_EVENT_TYPES.includes(event.type);
    const isOperational = OPERATIONAL_EVENT_TYPES.includes(event.type);

    if (!isSystem && !isOperational) continue;

    // Tenant deve bater
    if (event.tenantId && event.tenantId !== tenantId) continue;

    // Sanitizar payload
    const sanitized = sanitizeEventPayload(event);

    // Construir registro de conhecimento
    const record = buildEpisodicRecord({
      event: sanitized,
      tenantId,
      domain: isSystem ? 'SYSTEM' : 'OPERATIONAL',
      log,
    });

    if (record) records.push(record);
  }

  return records;
}

/**
 * Sanitiza payload de evento — remove PII, secrets, tokens.
 */
function sanitizeEventPayload(event) {
  const payload = { ...(event.payload || {}) };

  // Redact campos sensíveis
  const SENSITIVE_KEYS = ['password', 'token', 'secret', 'credential', 'key', 'ssn', 'cpf', 'credit_card'];
  for (const key of Object.keys(payload)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sk) => lowerKey.includes(sk))) {
      payload[key] = '[redacted]';
    }
  }

  return {
    type: event.type,
    tenantId: event.tenantId || null,
    correlationId: event.correlationId || null,
    subject: sanitizeSubject(event.subject),
    actor: sanitizeActor(event.actor),
    payload,
    timestamp: event.timestamp || event.createdAt || new Date().toISOString(),
  };
}

function sanitizeSubject(subject) {
  if (!subject) return null;
  return {
    type: subject.type || null,
    id: subject.id ? `anon-${hashString(String(subject.id)).slice(0, 8)}` : null,
  };
}

function sanitizeActor(actor) {
  if (!actor) return null;
  return {
    type: actor.type || actor.principalType || null,
    id: actor.id || actor.principalId ? `anon-${hashString(String(actor.id || actor.principalId)).slice(0, 8)}` : null,
    classification: actor.classification || null,
  };
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Constrói registro de conhecimento episódico a partir de evento sanitizado.
 */
function buildEpisodicRecord({ event, tenantId, domain, log }) {
  const eventType = event.type || 'unknown';

  // Mapear tipo de evento → knowledge type
  const knowledgeType = KNOWLEDGE_TYPES.EPISODIC;

  // Texto descritivo do evento
  const description = formatEventDescription(event);

  const provenance = buildProvenance({
    sourceKind: domain === 'SYSTEM' ? SOURCE_KINDS.INCIDENT_RECORD : SOURCE_KINDS.PROCEDURE,
    sourceRef: `event:${event.correlationId || event.type}`,
    sourceVersion: '1.0.0',
    knowledgeType,
    retrievalPurposes: domain === 'SYSTEM' ? ['INCIDENT_ANALYSIS', 'DIAGNOSIS'] : ['CUSTOMER_SERVICE'],
    domain,
    classification: domain === 'SYSTEM' ? 'SUPPORT' : 'PRODUCTION',
    sensitivity: domain === 'SYSTEM' ? 'restricted' : 'internal',
    tenant: tenantId,
    lastValidatedAt: event.timestamp,
  });

  return Object.freeze({
    id: `episodic:${tenantId}:${event.correlationId || event.type}:${Date.now()}`,
    tenantId,
    domain,
    classification: provenance.classification,
    sensitivity: provenance.sensitivity,
    knowledgeType,
    retrievalPurposes: provenance.retrievalPurposes,
    content: description,
    eventType,
    eventTimestamp: event.timestamp,
    provenance,
  });
}

function formatEventDescription(event) {
  const type = event.type || 'unknown';
  const payload = event.payload || {};
  const subject = event.subject || {};

  const templates = {
    'agent.execution.failed': `Agent execution failed: intent=${payload.intent || 'unknown'}, error=${payload.error || 'unknown'}`,
    'business.outcome.failed': `Business outcome failed: outcome=${payload.outcome || 'unknown'}, reason=${payload.reason || 'unknown'}`,
    'business.outcome.validated': `Business outcome validated: outcome=${payload.outcome || 'unknown'}, evidence=${JSON.stringify(payload.evidence || {})}`,
    'tool.execution.failed': `Tool execution failed: toolId=${payload.toolId || 'unknown'}, error=${payload.error || 'unknown'}`,
    'process.failed': `Process failed: instanceId=${payload.processInstanceId || 'unknown'}, error=${payload.error || 'unknown'}`,
    'deployment.completed': `Deployment completed: version=${payload.version || 'unknown'}, components=${JSON.stringify(payload.components || [])}`,
    'release.completed': `Release completed: releaseId=${payload.releaseId || 'unknown'}, status=${payload.status || 'unknown'}`,
    'incident.detected': `Incident detected: type=${payload.incidentType || 'unknown'}, severity=${payload.severity || 'unknown'}`,
    'root_cause.identified': `Root cause identified: incident=${payload.incidentId || 'unknown'}, cause=${payload.rootCause || 'unknown'}`,
    'fix.validated': `Fix validated: incident=${payload.incidentId || 'unknown'}, test=${payload.testId || 'unknown'}`,
    'customer.journey.completed': `Customer journey completed: journey=${payload.journey || 'unknown'}`,
  };

  return templates[type] || `Event: ${type} (${JSON.stringify({ subject: subject.type, payload: Object.keys(payload).join(',') })})`;
}

module.exports = {
  projectEpisodicKnowledge,
  sanitizeEventPayload,
  SYSTEM_EVENT_TYPES,
  OPERATIONAL_EVENT_TYPES,
};
