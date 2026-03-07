'use strict';

const schedulingService = require('../../services/schedulingService');
const kioskSessionService = require('./KioskSessionService');
const kioskQueueService = require('./QueueService');

async function createSession({ tenantId, kioskCode, contactId = null, ticketId = null, metadata = {}, contextPayload = {} }) {
  return kioskSessionService.startSession({
    tenantId,
    kioskCode,
    contactId,
    ticketId,
    statusReason: 'session_started',
    metadata,
    contextPayload,
  });
}

async function checkin({ tenantId, kioskCode, contactId = null, reason = 'checkin', contextPayload = {} }) {
  const ticketOut = await kioskQueueService.createQueueTicket({
    tenantId,
    contactId,
    reason,
    kioskCode,
  });
  const sessionOut = await kioskSessionService.startSession({
    tenantId,
    kioskCode,
    contactId,
    ticketId: ticketOut?.ticket?.id || null,
    statusReason: 'checked_in',
    metadata: { reason, source: 'kiosk' },
    contextPayload: {
      ...contextPayload,
      reason,
      ticketId: ticketOut?.ticket?.id || null,
    },
  });
  await kioskSessionService.markCheckin({
    tenantId,
    sessionId: sessionOut.session.id,
    ticketId: ticketOut?.ticket?.id || null,
    statusReason: 'checked_in',
    contextPayload: {
      ...contextPayload,
      reason,
      ticketId: ticketOut?.ticket?.id || null,
    },
  });
  return {
    ok: true,
    session: sessionOut.session,
    queueTicket: ticketOut.ticket,
  };
}

async function closeSession({ tenantId, sessionId, statusReason = 'closed', contextPayload = {} }) {
  return kioskSessionService.closeSession({ tenantId, sessionId, statusReason, contextPayload });
}

async function listRecentSessions({ tenantId, limit = 20, status = null }) {
  return kioskSessionService.listRecentSessions({ tenantId, limit, status });
}

async function availabilityLookup({ tenantId, ownerId = null, teamId = null, startAt, endAt, timezone = 'UTC' }) {
  const out = await schedulingService.getAvailability({
    tenantId,
    mode: ownerId || teamId ? 'team_based' : 'free',
    ownerId,
    teamId,
    startAt,
    endAt,
    timezone,
  });
  return { ok: true, ...out };
}

module.exports = {
  createSession,
  checkin,
  closeSession,
  listRecentSessions,
  availabilityLookup,
};
