'use strict';

/**
 * Pure row→item mappers for the timeline endpoint.
 * All helpers are injected to keep this module stateless and easily testable.
 */

/**
 * Maps VerticalJourneyEvent rows to timeline items.
 *
 * @param {any[]} rows
 * @param {{toIso: Function, classifyJourneyStatus: Function}} deps
 * @returns {Object[]}
 */
function mapJourneyTimelineItems(rows, { toIso, classifyJourneyStatus }) {
  return rows.map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    return {
      timestamp: toIso(item.occurred_at),
      eventType: item.event_type,
      status: classifyJourneyStatus(item),
      origin: 'vertical_journey_events',
      vertical: item.vertical,
      subjectId: item.subject_id || null,
      customerId: item.customer_id || null,
      membershipId: item.membership_id || null,
      channel: item.channel || null,
      details: {
        triggeredBy: item.triggered_by || null,
        scheduleId: item.schedule_id || null,
        payload: item.payload || {},
      },
    };
  });
}

/**
 * Maps VerticalAttendance rows to check_in / check_out timeline items.
 *
 * @param {any[]} rows
 * @param {{toIso: Function}} deps
 * @returns {Object[]}
 */
function mapAttendanceTimelineItems(rows, { toIso }) {
  const items = [];
  for (const row of rows) {
    const item = row.toJSON ? row.toJSON() : row;
    if (item.checked_in_at) {
      items.push({
        timestamp: toIso(item.checked_in_at),
        eventType: 'check_in',
        status: 'success',
        origin: 'vertical_attendances',
        vertical: item.vertical,
        subjectId: item.subject_id || null,
        customerId: null,
        membershipId: item.membership_id || null,
        channel: null,
        details: {
          attendanceId: item.id,
          unitId: item.unit_id || null,
          deviceId: item.device_id || null,
          rawStatus: item.status,
        },
      });
    }
    if (item.checked_out_at) {
      items.push({
        timestamp: toIso(item.checked_out_at),
        eventType: 'check_out',
        status: item.status === 'absent' ? 'failed' : 'success',
        origin: 'vertical_attendances',
        vertical: item.vertical,
        subjectId: item.subject_id || null,
        customerId: null,
        membershipId: item.membership_id || null,
        channel: null,
        details: {
          attendanceId: item.id,
          durationMinutes: item.duration_minutes,
          rawStatus: item.status,
        },
      });
    }
  }
  return items;
}

/**
 * Maps EventLedger MembershipBillingStatusChanged rows to timeline items.
 *
 * @param {any[]} rows
 * @param {{toIso: Function, safeString: Function}} deps
 * @returns {Object[]}
 */
function mapMembershipTimelineItems(rows, { toIso, safeString }) {
  return rows.map((row) => {
    const item = row.toJSON ? row.toJSON() : row;
    const payload = item.payload || {};
    const inferredVertical = safeString(payload.vertical || '').toLowerCase();
    return {
      timestamp: toIso(item.occurred_at),
      eventType: 'membership_billing_status_changed',
      status: 'success',
      origin: 'event_ledger',
      vertical: inferredVertical === 'fitness' || inferredVertical === 'beauty' ? inferredVertical : 'fitness',
      subjectId: item.subject_id || payload.subjectId || null,
      customerId: payload.customerId || null,
      membershipId: item.correlation_id || payload.membershipId || null,
      channel: null,
      details: {
        fromStatus: payload.fromStatus || null,
        toStatus: payload.toStatus || null,
        reason: payload.reason || null,
        actor: item.actor_id || null,
      },
    };
  });
}

module.exports = {
  mapJourneyTimelineItems,
  mapAttendanceTimelineItems,
  mapMembershipTimelineItems,
};
