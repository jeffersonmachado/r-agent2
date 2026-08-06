'use strict';

/**
 * Billing / Membership Orchestration (shared: beauty + fitness)
 *
 * Manages the billing domain without requiring a real PSP:
 * - Plan status lifecycle (active → grace_period → delinquent → blocked → cancelled)
 * - Grace period management
 * - Operational block / unblock
 * - Session bundle consumtion (beauty/fitness packages)
 * - Status change history via event_ledger
 *
 * Integrates with AccessMembership (existing) and VerticalSessionBundle (new).
 */

const crypto = require('crypto');
const { getSequelize } = require('../../db/sequelize');
const { AccessMembership, VerticalSessionBundle } = require('../../db/models');
const { appendEventV1 } = require('../eventLedgerService');
const { emitEvent } = require('../websocketService');
const logger = require('../../utils/logger');

// ── Realtime (WebSocket) ──────────────────────────────────────────────────
// Notifica páginas operacionais verticais. Best-effort: falha no emit nunca
// bloqueia o write de billing/bundle.
function emitVerticalEvent(event, { tenantId, entityId = null, action, extra = {} }) {
  if (!tenantId) return;
  try {
    emitEvent(event, { tenantId, entityId, action, ...extra }, { tenantId: String(tenantId) });
  } catch (error) {
    logger.warn('[BillingOrchestration] Falha ao emitir evento vertical', {
      event,
      action,
      error: error && error.message ? error.message : String(error),
    });
  }
}

// ── Billing status machine ────────────────────────────────────────────────
// allowed transitions
const ALLOWED_TRANSITIONS = {
  active: ['grace_period', 'delinquent', 'blocked', 'cancelled'],
  grace_period: ['active', 'delinquent', 'blocked', 'cancelled'],
  trial: ['active', 'grace_period', 'delinquent', 'blocked', 'cancelled'],
  delinquent: ['active', 'grace_period', 'blocked', 'cancelled'],
  blocked: ['active', 'cancelled'],
  cancelled: ['active'],
  visitor: ['active', 'cancelled'],
};

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
}

function dbAvailable() {
  return !!getSequelize();
}

// ── Internal helpers ─────────────────────────────────────────────────────

async function emitBillingEvent({ tenantId, membershipId, fromStatus, toStatus, reason, actor = 'system', metadata = {} }) {
  await appendEventV1({
    tenantId,
    type: 'MembershipBillingStatusChanged',
    source: 'billing_orchestration',
    occurredAt: new Date(),
    correlationId: membershipId,
    subject: { type: 'access_membership', id: membershipId },
    actor: { type: 'system', id: actor },
    idempotencyKey: `billing_status:${membershipId}:${fromStatus}→${toStatus}:${Date.now()}`,
    payload: { membershipId, fromStatus, toStatus, reason, ...metadata },
  }).catch(() => {});
}

// ── Membership status management ─────────────────────────────────────────

/**
 * Get membership(s) for a subject.
 */
async function getMembershipForSubject({ tenantId, subjectId }) {
  if (!dbAvailable()) return null;
  const Model = AccessMembership();
  const rows = await Model.findAll({
    where: { tenant_key: tenantId, subject_id: String(subjectId) },
    order: [['created_at', 'DESC']],
    limit: 1,
  }).catch(() => []);
  const row = rows[0];
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

/**
 * Update billing_status of a membership with validation and audit.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.membershipId
 * @param {string} params.toStatus          target status
 * @param {string} [params.reason]          reason text for audit
 * @param {object} [params.extraFields]     e.g. { grace_until, due_date, renewal_at }
 * @param {string} [params.actor]           who triggered it
 * @returns {Promise<object>}  updated membership row
 */
async function updateBillingStatus({ tenantId, membershipId, toStatus, reason = '', extraFields = {}, actor = 'system' }) {
  if (!dbAvailable()) throw Object.assign(new Error('DB unavailable'), { code: 'db_unavailable' });

  const Model = AccessMembership();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: String(membershipId) } });
  if (!row) throw Object.assign(new Error('membership_not_found'), { code: 'membership_not_found' });

  const fromStatus = row.billing_status;
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    throw Object.assign(
      new Error(`Invalid billing status transition: ${fromStatus} → ${toStatus}`),
      { code: 'invalid_billing_transition', fromStatus, toStatus },
    );
  }

  await row.update({ billing_status: toStatus, ...extraFields });
  const updated = row.toJSON ? row.toJSON() : row;

  await emitBillingEvent({ tenantId, membershipId, fromStatus, toStatus, reason, actor });
  emitVerticalEvent('vertical.memberships.updated', {
    tenantId,
    entityId: membershipId,
    action: 'billing_status_changed',
    extra: { fromStatus, toStatus },
  });
  return updated;
}

/**
 * Block a membership due to delinquency or manual action.
 */
async function blockMembership({ tenantId, membershipId, reason = 'delinquency', actor = 'system' }) {
  return updateBillingStatus({ tenantId, membershipId, toStatus: 'blocked', reason, actor });
}

/**
 * Unblock (reactivate) a membership after regularisation.
 */
async function reactivateMembership({ tenantId, membershipId, reason = 'payment_regularised', actor = 'system', renewalAt = null, dueDate = null }) {
  const extraFields = {};
  if (renewalAt) extraFields.renewal_at = new Date(renewalAt);
  if (dueDate) extraFields.due_date = new Date(dueDate);
  return updateBillingStatus({
    tenantId,
    membershipId,
    toStatus: 'active',
    reason,
    actor,
    extraFields,
  });
}

/**
 * Compute effective billing status considering grace_until.
 * Returns the operative status an access decision should use.
 */
function computeEffectiveBillingStatus(membership) {
  if (!membership) return 'cancelled';
  const status = membership.billing_status || 'cancelled';
  if (status === 'delinquent' && membership.grace_until) {
    const graceUntil = new Date(membership.grace_until);
    if (!Number.isNaN(graceUntil.getTime()) && graceUntil > new Date()) {
      return 'grace_period';
    }
  }
  return status;
}

/**
 * Check if membership allows access (operative billing check).
 */
function isAccessAllowedByBilling(membership) {
  const status = computeEffectiveBillingStatus(membership);
  return ['active', 'grace_period', 'trial', 'visitor'].includes(status);
}

// ── Session bundle management ─────────────────────────────────────────────

/**
 * Create a session bundle (package or subscription).
 */
async function createSessionBundle({ tenantId, vertical, subjectId, customerId = null, membershipId = null, bundleType = 'package', planName = null, totalSessions = null, startAt = null, endAt = null, dueDate = null, renewalAt = null, metadata = {} }) {
  if (!dbAvailable()) throw Object.assign(new Error('DB unavailable'), { code: 'db_unavailable' });

  const Model = VerticalSessionBundle();
  const id = makeId('vsb');
  const row = await Model.create({
    id,
    tenant_key: tenantId,
    vertical,
    subject_id: subjectId,
    customer_id: customerId,
    membership_id: membershipId,
    bundle_type: bundleType,
    plan_name: planName,
    total_sessions: totalSessions,
    used_sessions: 0,
    status: 'active',
    billing_status: 'active',
    start_at: startAt ? new Date(startAt) : null,
    end_at: endAt ? new Date(endAt) : null,
    due_date: dueDate ? new Date(dueDate) : null,
    renewal_at: renewalAt ? new Date(renewalAt) : null,
    metadata,
  });
  const bundle = row.toJSON ? row.toJSON() : row;
  emitVerticalEvent('vertical.bundles.updated', {
    tenantId,
    entityId: bundle.id || id,
    action: 'sold',
    extra: { vertical, subjectId },
  });
  return bundle;
}

/**
 * Consume one session from a bundle. Idempotent via correlationId.
 *
 * @param {object} params
 * @param {string} params.tenantId
 * @param {string} params.bundleId  – VerticalSessionBundle.id
 * @param {string} [params.correlationId] – e.g. attendance_id to prevent double-deduction
 * @returns {Promise<object>} updated bundle
 */
async function consumeSession({ tenantId, bundleId, correlationId = null }) {
  if (!dbAvailable()) throw Object.assign(new Error('DB unavailable'), { code: 'db_unavailable' });

  const Model = VerticalSessionBundle();
  const row = await Model.findOne({ where: { tenant_key: tenantId, id: String(bundleId) } });
  if (!row) throw Object.assign(new Error('session_bundle_not_found'), { code: 'session_bundle_not_found' });

  const bundle = row.toJSON ? row.toJSON() : row;

  // Check if already exhausted
  if (bundle.status === 'exhausted') {
    throw Object.assign(new Error('session_bundle_exhausted'), { code: 'session_bundle_exhausted' });
  }
  // Check expiry
  if (bundle.end_at && new Date(bundle.end_at) < new Date()) {
    const msg = 'session_bundle_expired';
    await row.update({ status: 'expired' }).catch(() => {});
    throw Object.assign(new Error(msg), { code: msg });
  }

  const newUsed = bundle.used_sessions + 1;
  const newStatus = bundle.total_sessions !== null && newUsed >= bundle.total_sessions ? 'exhausted' : 'active';
  await row.update({ used_sessions: newUsed, status: newStatus });

  emitVerticalEvent('vertical.bundles.updated', {
    tenantId,
    entityId: bundleId,
    action: 'used',
    extra: { vertical: bundle.vertical, usedSessions: newUsed, totalSessions: bundle.total_sessions, status: newStatus },
  });

  // Audit append (best-effort)
  await appendEventV1({
    tenantId,
    type: 'SessionBundleConsumed',
    source: 'billing_orchestration',
    occurredAt: new Date(),
    correlationId: correlationId || bundleId,
    subject: { type: 'vertical_session_bundle', id: bundleId },
    actor: { type: 'system', id: 'attendance' },
    idempotencyKey: correlationId ? `session_consumed:${bundleId}:${correlationId}` : null,
    payload: { bundleId, usedSessions: newUsed, totalSessions: bundle.total_sessions, status: newStatus },
  }).catch(() => {});

  return { ...bundle, used_sessions: newUsed, status: newStatus };
}

/**
 * Get the active session bundle for a subject in a vertical.
 */
async function getActiveBundle({ tenantId, vertical, subjectId }) {
  if (!dbAvailable()) return null;
  const Model = VerticalSessionBundle();
  const row = await Model.findOne({
    where: { tenant_key: tenantId, vertical, subject_id: String(subjectId), status: 'active' },
    order: [['created_at', 'DESC']],
  }).catch(() => null);
  return row ? (row.toJSON ? row.toJSON() : row) : null;
}

/**
 * Get session balance summary for a subject.
 */
async function getSessionBalance({ tenantId, vertical, subjectId }) {
  const bundle = await getActiveBundle({ tenantId, vertical, subjectId });
  if (!bundle) return { hasBundle: false, remaining: 0, total: null, used: 0, status: null };

  const remaining = bundle.total_sessions !== null
    ? Math.max(0, bundle.total_sessions - bundle.used_sessions)
    : null; // null = unlimited (subscription)

  return {
    hasBundle: true,
    bundleId: bundle.id,
    bundleType: bundle.bundle_type,
    planName: bundle.plan_name,
    remaining,
    total: bundle.total_sessions,
    used: bundle.used_sessions,
    status: bundle.status,
    billingStatus: bundle.billing_status,
    endAt: bundle.end_at,
    renewalAt: bundle.renewal_at,
    graceUntil: bundle.grace_until,
  };
}

module.exports = {
  ALLOWED_TRANSITIONS,
  getMembershipForSubject,
  updateBillingStatus,
  blockMembership,
  reactivateMembership,
  computeEffectiveBillingStatus,
  isAccessAllowedByBilling,
  createSessionBundle,
  consumeSession,
  getActiveBundle,
  getSessionBalance,
};
