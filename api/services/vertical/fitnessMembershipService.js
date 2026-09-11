'use strict';

/**
 * Fitness Membership Service
 *
 * Completes the Fitness membership domain:
 * - Plan lifecycle (active / grace_period / delinquent / blocked / cancelled)
 * - Grace period management (grace_until)
 * - Auto-block by billing_status
 * - Reactivation after regularisation
 * - Unit scope enforcement
 * - Frequency metadata tracking
 * - Operational history via billingOrchestrationService + event_ledger
 */

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const { AccessMembership, AccessSubject } = require('../../db/models');
const { updateBillingStatus, blockMembership, reactivateMembership, computeEffectiveBillingStatus, isAccessAllowedByBilling } = require('./billingOrchestrationService');
const { emitJourneyEvent } = require('./customerJourneyEngine');
const { appendEventV1 } = require('../eventLedgerService');
const { enqueueNotification } = require('../notificationService');
const { emitEvent } = require('../websocketService');
const logger = require('../../utils/logger');

const VERTICAL = 'fitness';

// Notifica páginas operacionais via WebSocket. Best-effort.
function emitMembershipUpdated({ tenantId, entityId = null, action }) {
  if (!tenantId) return;
  try {
    emitEvent('vertical.memberships.updated', { tenantId, entityId, action }, { tenantId: String(tenantId) });
  } catch (error) {
    logger.warn('[FitnessMembership] Falha ao emitir vertical.memberships.updated', {
      action,
      error: error && error.message ? error.message : String(error),
    });
  }
}

async function queueFitnessNotification({
  tenantId,
  channel = 'whatsapp',
  subjectId = null,
  membershipId = null,
  eventType,
  metadata = {},
}) {
  const normalizedChannel = String(channel || '').trim().toLowerCase();
  if (!normalizedChannel || normalizedChannel === 'internal') return;
  await enqueueNotification({
    tenantId,
    vertical: VERTICAL,
    channel: normalizedChannel,
    eventType,
    subjectId,
    membershipId,
    recipient: subjectId || null,
    metadata: { ...metadata, vertical: VERTICAL },
  }).catch(() => {});
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function dbAvailable() {
  return !!getSequelize();
}

// ── Membership CRUD extension ─────────────────────────────────────────────

/**
 * Get full membership enriched with computed effective status.
 */
async function getMembershipDetail({ tenantId, membershipId }) {
  if (!dbAvailable()) return null;
  const Model = AccessMembership();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: String(membershipId) } });
  if (!row) return null;
  const data = row.toJSON ? row.toJSON() : row;
  return {
    ...data,
    effectiveBillingStatus: computeEffectiveBillingStatus(data),
    accessAllowed: isAccessAllowedByBilling(data),
  };
}

/**
 * List memberships for a tenant (fitness vertical).
 */
async function listFitnessMemberships({ tenantId, billingStatus, status, limit = 100 } = {}) {
  if (!dbAvailable()) return { items: [], total: 0 };
  const where = { tenant_key: tenantId, vertical: VERTICAL };
  if (billingStatus) where.billing_status = billingStatus;
  if (status) where.status = status;

  const Model = AccessMembership();
  const rows = await Model.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(Number(limit) || 100, 500),
  }).catch(() => []);

  const items = rows.map((r) => {
    const d = r.toJSON ? r.toJSON() : r;
    return { ...d, effectiveBillingStatus: computeEffectiveBillingStatus(d), accessAllowed: isAccessAllowedByBilling(d) };
  });
  return { items, total: items.length };
}

/**
 * Campos de matrícula que o domínio pode persistir via updateMembershipDetails.
 * Fonte única para a rota, para o serviço e para o contrato versionado em
 * `config/model-field-contracts.json` (gate `validate:model-field-contracts`).
 * Todo campo aqui DEVE existir como atributo no model `AccessMembership`.
 */
const UPDATABLE_MEMBERSHIP_FIELDS = Object.freeze([
  'due_date',
  'renewal_at',
  'grace_until',
  'plan_type',
  'unit_scope',
  'plan_name',
  'start_at',
  'end_at',
  'metadata',
]);

/**
 * Aliases camelCase aceitos na borda HTTP. São traduzidos explicitamente para o
 * nome canônico — nunca descartados em silêncio.
 */
const MEMBERSHIP_FIELD_ALIASES = Object.freeze({
  dueDate: 'due_date',
  renewalAt: 'renewal_at',
  graceUntil: 'grace_until',
  planType: 'plan_type',
  unitScope: 'unit_scope',
  planName: 'plan_name',
  startAt: 'start_at',
  endAt: 'end_at',
});

const DATE_MEMBERSHIP_FIELDS = Object.freeze(['due_date', 'renewal_at', 'grace_until', 'start_at', 'end_at']);
const STRING_MEMBERSHIP_FIELDS = Object.freeze(['plan_type', 'plan_name']);

function invalidMembershipFields(unknownFields) {
  return Object.assign(new Error(`invalid_membership_fields:${unknownFields.join(',')}`), {
    code: 'invalid_membership_fields',
    unknownFields,
    allowedFields: [...UPDATABLE_MEMBERSHIP_FIELDS],
  });
}

function invalidMembershipFieldValue(field, value) {
  return Object.assign(new Error(`invalid_field_value:${field}`), {
    code: 'invalid_field_value',
    field,
    value: value === undefined ? null : String(value),
  });
}

/**
 * Normaliza e VALIDA os campos recebidos. Nunca devolve um patch parcialmente
 * válido: ou todos os campos são aceitos e coerentes, ou a chamada falha.
 *
 * @returns {object} patch pronto para `row.update`
 * @throws {Error} `invalid_membership_fields` | `no_fields_to_update` | `invalid_field_value`
 */
function normalizeMembershipFields(fields) {
  const entries = Object.entries(fields || {});
  const unknown = [];
  const normalized = {};

  for (const [rawKey, rawValue] of entries) {
    if (rawValue === undefined) continue;
    const key = MEMBERSHIP_FIELD_ALIASES[rawKey] || rawKey;
    if (!UPDATABLE_MEMBERSHIP_FIELDS.includes(key)) {
      unknown.push(rawKey);
      continue;
    }
    if (DATE_MEMBERSHIP_FIELDS.includes(key)) {
      if (rawValue === null) {
        normalized[key] = null;
        continue;
      }
      const parsed = new Date(rawValue);
      if (Number.isNaN(parsed.getTime())) throw invalidMembershipFieldValue(key, rawValue);
      normalized[key] = parsed;
      continue;
    }
    if (STRING_MEMBERSHIP_FIELDS.includes(key)) {
      if (rawValue === null) {
        normalized[key] = null;
        continue;
      }
      if (typeof rawValue !== 'string' || rawValue.trim() === '') throw invalidMembershipFieldValue(key, rawValue);
      normalized[key] = rawValue.trim();
      continue;
    }
    if (key === 'unit_scope') {
      if (!Array.isArray(rawValue)) throw invalidMembershipFieldValue(key, rawValue);
      normalized[key] = rawValue;
      continue;
    }
    if (key === 'metadata') {
      if (rawValue === null || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
        throw invalidMembershipFieldValue(key, rawValue);
      }
      normalized[key] = rawValue;
    }
  }

  if (unknown.length > 0) throw invalidMembershipFields(unknown);
  if (Object.keys(normalized).length === 0) {
    throw Object.assign(new Error('no_fields_to_update'), {
      code: 'no_fields_to_update',
      allowedFields: [...UPDATABLE_MEMBERSHIP_FIELDS],
    });
  }
  return normalized;
}

/**
 * Update membership extended fields (due_date, renewal_at, grace_until, plan_type, unit_scope).
 *
 * Contrato: nenhum campo aceito é descartado em silêncio. Campo desconhecido ou
 * valor inválido gera erro explícito (códigos `invalid_membership_fields`,
 * `no_fields_to_update`, `invalid_field_value`) — a rota responde 400/422 em vez
 * de devolver 200 sem persistir.
 */
async function updateMembershipDetails({ tenantId, membershipId, fields }) {
  if (!dbAvailable()) throw Object.assign(new Error('DB unavailable'), { code: 'db_unavailable' });
  const update = normalizeMembershipFields(fields);

  const Model = AccessMembership();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: String(membershipId) } });
  if (!row) return null;
  await row.update(update);
  emitMembershipUpdated({ tenantId, entityId: membershipId, action: 'updated' });
  return row.toJSON ? row.toJSON() : row;
}

// ── Grace period ──────────────────────────────────────────────────────────

/**
 * Start grace period: set billing_status to delinquent + grace_until.
 */
async function startGracePeriod({ tenantId, membershipId, graceDays = 7, actor = 'system' }) {
  const graceUntil = new Date(Date.now() + graceDays * 86400000).toISOString();
  return updateBillingStatus({
    tenantId,
    membershipId,
    toStatus: 'delinquent',
    reason: `grace_period_started:${graceDays}_days`,
    actor,
    extraFields: { grace_until: graceUntil },
  });
}

/**
 * End grace period with block if still delinquent.
 */
async function endGracePeriodWithBlock({ tenantId, membershipId, actor = 'system' }) {
  return blockMembership({ tenantId, membershipId, reason: 'grace_period_expired', actor });
}

// ── Billing domain ────────────────────────────────────────────────────────

async function setDueDate({ tenantId, membershipId, dueDate, renewalAt = null, actor = 'system' }) {
  const fields = { due_date: new Date(dueDate) };
  if (renewalAt) fields.renewal_at = new Date(renewalAt);
  return updateMembershipDetails({ tenantId, membershipId, fields });
}

async function processMembershipRenewal({ tenantId, membershipId, renewalAt, renewalDate, actor = 'system' }) {
  const resolvedRenewalAt = renewalAt || renewalDate || new Date();
  const fields = { renewal_at: new Date(resolvedRenewalAt), grace_until: null };
  await updateMembershipDetails({ tenantId, membershipId, fields });
  const current = await getMembershipDetail({ tenantId, membershipId });
  if (!current) {
    const err = new Error('membership_not_found');
    err.code = 'membership_not_found';
    throw err;
  }
  return reactivateMembership({ tenantId, membershipId, reason: 'renewal', actor, renewalAt: resolvedRenewalAt });
}

// ── Access eligibility ────────────────────────────────────────────────────

/**
 * Get full access eligibility context for a subject.
 * @returns {{ allowed: boolean, reasonCode: string, membership: object|null }}
 */
async function getMembershipAccessStatus({ tenantId, subjectId }) {
  if (!dbAvailable()) return { allowed: false, reasonCode: 'db_unavailable', membership: null };

  const Model = AccessMembership();
  const row = await Model.findOne({
    where: { tenant_key: tenantId, subject_id: String(subjectId), vertical: VERTICAL },
    order: [['created_at', 'DESC']],
  }).catch(() => null);

  if (!row) return { allowed: false, reasonCode: 'membership_not_found', membership: null };

  const membership = row.toJSON ? row.toJSON() : row;
  const effectiveStatus = computeEffectiveBillingStatus(membership);
  const allowed = isAccessAllowedByBilling(membership);

  return {
    allowed,
    effectiveBillingStatus: effectiveStatus,
    reasonCode: allowed ? 'allowed' : `deny_billing_${effectiveStatus}`,
    membership: { ...membership, effectiveBillingStatus: effectiveStatus, accessAllowed: allowed },
  };
}

// ── Journey integration ───────────────────────────────────────────────────

async function sendWelcome({ tenantId, subjectId, membershipId, channel = 'internal', metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'welcome_sent',
    subjectId,
    membershipId,
    channel,
    triggeredBy: 'event',
    idempotencyKey: membershipId ? `fitness_welcome:${tenantId}:${membershipId}` : null,
    payload: metadata,
  });
  await queueFitnessNotification({ tenantId, channel, subjectId, membershipId, eventType: 'welcome_sent', metadata });
  return evt;
}

async function sendFrequencyAlert({ tenantId, subjectId, membershipId, channel = 'internal', metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'frequency_alert_sent',
    subjectId,
    membershipId,
    channel,
    triggeredBy: metadata.triggeredBy || 'engagement_engine',
    idempotencyKey: null, // allows repeated alerts
    payload: metadata,
  });
  await queueFitnessNotification({ tenantId, channel, subjectId, membershipId, eventType: 'frequency_alert_sent', metadata });
  return evt;
}

async function sendReturnCampaign({ tenantId, subjectId, membershipId, channel = 'internal', correlationId, metadata = {} }) {
  const evt = await emitJourneyEvent({
    tenantId,
    vertical: VERTICAL,
    eventType: 'return_campaign_sent',
    subjectId,
    membershipId,
    channel,
    triggeredBy: 'engagement_engine',
    correlationId,
    idempotencyKey: correlationId ? `fitness_return:${tenantId}:${correlationId}` : null,
    payload: metadata,
  });
  await queueFitnessNotification({ tenantId, channel, subjectId, membershipId, eventType: 'return_campaign_sent', metadata });
  return evt;
}

async function detectChurnRisk({ tenantId, subjectId, membershipId, daysSinceLastVisit = 0, frequency30d = 0, billingStatus = 'active', metadata = {} }) {
  // Compute churn risk score (0–1)
  const inactivityScore = Math.min(daysSinceLastVisit / 60, 1);
  const frequencyScore = Math.max(0, 1 - frequency30d / 8);
  const billingPenalty = ['blocked', 'cancelled', 'delinquent'].includes(billingStatus) ? 0.3 : 0;
  const score = parseFloat(Math.min(1, inactivityScore * 0.6 + frequencyScore * 0.3 + billingPenalty).toFixed(4));
  const isChurnRisk = score >= 0.5;

  if (isChurnRisk) {
    emitJourneyEvent({
      tenantId,
      vertical: VERTICAL,
      eventType: 'churn_risk_detected',
      subjectId,
      membershipId,
      triggeredBy: 'engagement_engine',
      payload: { score, daysSinceLastVisit, frequency30d, ...metadata },
    }).catch(() => {});
  }

  return { score, isChurnRisk, daysSinceLastVisit, frequency30d };
}

// ── Billing history ───────────────────────────────────────────────────────

/**
 * Get audit trail of billing status changes for a membership.
 * Reads from event_ledger; returns chronological list of changes.
 * @returns {Promise<{items: object[], total: number}>}
 */
async function getMembershipBillingHistory({ tenantId, membershipId, limit = 50 }) {
  if (!dbAvailable()) return { items: [], total: 0 };
  const { EventLedger } = require('../../db/models');
  const { Op } = require('sequelize');
  const Model = EventLedger();
  if (!Model) return { items: [], total: 0 };

  const rows = await Model.findAll({
    where: {
      tenant_key: tenantId,
      type: 'MembershipBillingStatusChanged',
      correlation_id: String(membershipId),
    },
    order: [['occurred_at', 'DESC']],
    limit: Math.min(Number(limit) || 50, 200),
  }).catch(() => []);

  const items = rows.map((r) => {
    const d = r.toJSON ? r.toJSON() : r;
    return {
      id: d.id,
      occurredAt: d.occurred_at,
      fromStatus: d.payload?.fromStatus,
      toStatus: d.payload?.toStatus,
      reason: d.payload?.reason,
      actor: d.actor?.id || 'system',
    };
  });
  return { items, total: items.length };
}

async function createRecurringMembershipCharge({
  tenantId,
  membershipId,
  subjectId = null,
  customerId = null,
  customerName = null,
  customerEmail = null,
  customerPhone = null,
  customerDocument = null,
  amount,
  dueDate,
  cycle = 'MONTHLY',
  provider = null,
  idempotencyKey = null,
  metadata = {},
}) {
  const billingService = require('../billingService');
  return billingService.createCharge({
    tenantId,
    vertical: VERTICAL,
    type: 'subscription',
    membershipId,
    subjectId,
    customerId,
    customerName,
    customerEmail,
    customerPhone,
    customerDocument,
    amount,
    dueDate,
    cycle,
    provider,
    idempotencyKey,
    metadata,
  });
}

module.exports = {
  getMembershipDetail,
  listFitnessMemberships,
  updateMembershipDetails,
  UPDATABLE_MEMBERSHIP_FIELDS,
  MEMBERSHIP_FIELD_ALIASES,
  startGracePeriod,
  endGracePeriodWithBlock,
  setDueDate,
  processMembershipRenewal,
  getMembershipAccessStatus,
  getMembershipBillingHistory,
  sendWelcome,
  sendFrequencyAlert,
  sendReturnCampaign,
  detectChurnRisk,
  createRecurringMembershipCharge,
  blockMembership,
  reactivateMembership,
};
