'use strict';

const crypto = require('crypto');
const { KioskSession } = require('../../db/models');
const { newId, getJson } = require('../../core/autonomous-scheduling/shared');

async function startSession({ tenantId, kioskCode, contactId = null, ticketId = null, statusReason = 'session_started', metadata = {}, contextPayload = {} }) {
  const row = await KioskSession().create({
    id: newId('kiosk'),
    tenant_key: String(tenantId),
    kiosk_code: String(kioskCode || 'default'),
    session_token: crypto.randomUUID(),
    contact_id: contactId ? String(contactId) : null,
    ticket_id: ticketId ? String(ticketId) : null,
    status_reason: String(statusReason || 'session_started'),
    metadata_json: metadata,
    context_payload: contextPayload,
    status: 'open',
  });
  return { ok: true, session: getJson(row) };
}

async function markCheckin({ tenantId, sessionId, ticketId = null, statusReason = 'checked_in', contextPayload = null }) {
  const row = await KioskSession().findOne({
    where: { tenant_key: String(tenantId), id: String(sessionId) },
  });
  if (!row) return { ok: false, session: null };
  await row.update({
    ticket_id: ticketId ? String(ticketId) : row.ticket_id || null,
    status: 'checked_in',
    status_reason: String(statusReason || 'checked_in'),
    checkin_at: new Date(),
    ...(contextPayload ? { context_payload: contextPayload } : {}),
  });
  return { ok: true, session: getJson(row) };
}

async function closeSession({ tenantId, sessionId, statusReason = 'closed', contextPayload = null }) {
  const row = await KioskSession().findOne({
    where: { tenant_key: String(tenantId), id: String(sessionId) },
  });
  if (!row) return { ok: false, session: null };
  await row.update({
    status: 'closed',
    status_reason: String(statusReason || 'closed'),
    closed_at: new Date(),
    ...(contextPayload ? { context_payload: contextPayload } : {}),
  });
  return { ok: true, session: getJson(row) };
}

async function listRecentSessions({ tenantId, limit = 20, status = null }) {
  const where = { tenant_key: String(tenantId) };
  if (status) where.status = String(status);
  const rows = await KioskSession().findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
  });
  return { ok: true, items: rows.map(getJson) };
}

module.exports = {
  startSession,
  markCheckin,
  closeSession,
  listRecentSessions,
};
