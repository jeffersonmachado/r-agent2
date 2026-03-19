'use strict';

/**
 * Beauty Advanced Policy Rules
 *
 * Extends AccessPolicy for Beauty-specific restrictions:
 * - Room restriction  (metadata.room_ids)
 * - Resource restriction (metadata.resource_ids)
 * - Professional restriction (metadata.professional_ids)
 * - Appointment window validation (appointment must be active for access)
 *
 * Integrates with the existing accessDecisionService pipeline.
 * Returns a result compatible with REASON_CODES.
 */

const { REASON_CODES } = require('../../modules/access-control/constants');
const { listSchedules } = require('../scheduleService');

/**
 * Validate beauty-specific restrictions embedded in an AccessPolicy's metadata.
 *
 * @param {object} params
 * @param {object} params.policy     AccessPolicy row
 * @param {object} [params.subject]  AccessSubject row
 * @param {object} [params.membership] AccessMembership row
 * @param {string} [params.roomId]   room identifier from access request context
 * @param {string} [params.resourceId] resource identifier
 * @param {string} [params.professionalId] professional identifier
 * @param {object} [params.activeSchedule] active schedule from accessProfileAdapter (may be null)
 * @returns {{ allowed: boolean, reasonCode: string, reasonDetail?: string }}
 */
function validateBeautyPolicyRules({ policy, subject, membership, roomId, resourceId, professionalId, activeSchedule }) {
  if (!policy) return { allowed: true }; // no policy to restrict

  const meta = policy.metadata || {};

  // ── Room restriction ────────────────────────────────────────────────────
  if (meta.room_ids && Array.isArray(meta.room_ids) && meta.room_ids.length > 0 && roomId) {
    if (!meta.room_ids.includes(String(roomId))) {
      return { allowed: false, reasonCode: REASON_CODES.DENY_WRONG_UNIT, reasonDetail: `Room ${roomId} not allowed by policy` };
    }
  }

  // ── Resource restriction ────────────────────────────────────────────────
  if (meta.resource_ids && Array.isArray(meta.resource_ids) && meta.resource_ids.length > 0 && resourceId) {
    if (!meta.resource_ids.includes(String(resourceId))) {
      return { allowed: false, reasonCode: REASON_CODES.DENY_WRONG_UNIT, reasonDetail: `Resource ${resourceId} not allowed by policy` };
    }
  }

  // ── Professional restriction ────────────────────────────────────────────
  if (meta.professional_ids && Array.isArray(meta.professional_ids) && meta.professional_ids.length > 0 && professionalId) {
    if (!meta.professional_ids.includes(String(professionalId))) {
      return { allowed: false, reasonCode: REASON_CODES.DENY_WRONG_UNIT, reasonDetail: `Professional ${professionalId} not allowed by policy` };
    }
  }

  // ── Appointment window ──────────────────────────────────────────────────
  // If policy requires an active appointment for Beauty access
  if (meta.require_appointment === true) {
    if (!activeSchedule) {
      return { allowed: false, reasonCode: REASON_CODES.DENY_SCHEDULE_NOT_FOUND, reasonDetail: 'No active appointment for Beauty access' };
    }
    const now = Date.now();
    const start = new Date(activeSchedule.startAt || activeSchedule.start_at).getTime();
    const end = new Date(activeSchedule.endAt || activeSchedule.end_at).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || now < start || now > end) {
      return { allowed: false, reasonCode: REASON_CODES.DENY_OUTSIDE_SCHEDULE_WINDOW, reasonDetail: 'Current time is outside appointment window' };
    }
  }

  // ── Package / session gate ──────────────────────────────────────────────
  // policy.metadata.require_active_bundle: if true, deny access without active package
  if (meta.require_active_bundle === true && membership) {
    const hasBundle = membership.metadata?.has_active_bundle === true;
    if (!hasBundle) {
      return { allowed: false, reasonCode: REASON_CODES.DENY_MEMBERSHIP_INACTIVE, reasonDetail: 'No active session bundle/package. Please purchase or renew.' };
    }
  }

  return { allowed: true };
}

/**
 * Check if a beauty appointment is within its allowed window.
 * Standalone helper for use outside the access decision pipeline.
 *
 * @param {object} schedule – from scheduleService
 * @param {number} [toleranceMs=0] – tolerance in ms around window edges
 */
function isWithinAppointmentWindow(schedule, toleranceMs = 0) {
  if (!schedule) return false;
  const now = Date.now();
  const start = new Date(schedule.startAt || schedule.start_at).getTime();
  const end = new Date(schedule.endAt || schedule.end_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= (start - toleranceMs) && now <= (end + toleranceMs);
}

module.exports = {
  validateBeautyPolicyRules,
  isWithinAppointmentWindow,
};
