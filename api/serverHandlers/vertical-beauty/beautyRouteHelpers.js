const { getSequelize } = require('../../db/sequelize');

const VERTICAL = 'beauty';

function dbAvailable() {
  return !!getSequelize();
}

function safeString(value, fallback = '') {
  if (value == null) return fallback;
  try {
    return String(value);
  } catch (_) {
    return fallback;
  }
}

function safeLower(value) {
  return safeString(value, '').trim().toLowerCase();
}

function normalizeDay(rawDate) {
  const input = safeString(rawDate || '', '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  return new Date().toISOString().slice(0, 10);
}

function dayWindow(day) {
  const start = new Date(`${day}T00:00:00`);
  const end = new Date(`${day}T23:59:59.999`);
  return { start, end };
}

function isInsideWindow(value, start, end) {
  if (!value) return false;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return false;
  return dt >= start && dt <= end;
}

function resolveBeautyScheduleStatus(schedule) {
  const raw = safeLower(schedule?.status);
  const confirmation = safeLower(schedule?.confirmationStatus);

  if (raw === 'cancelled' || raw === 'declined') return 'cancelado';
  if (raw === 'done' || raw === 'completed') return 'concluido';
  if (raw === 'no_show' || raw === 'no-show') return 'no-show';
  if (raw === 'in_progress' || raw === 'in-progress') return 'em atendimento';
  if (confirmation === 'confirmed') return 'confirmado';
  return 'pendente';
}

function mapAgendaItem(schedule) {
  const metadata = schedule?.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {};
  const status = resolveBeautyScheduleStatus(schedule);
  return {
    id: schedule.id,
    scheduleId: schedule.id,
    startAt: schedule.startAt || null,
    endAt: schedule.endAt || null,
    status,
    rawStatus: schedule.status || null,
    confirmationStatus: schedule.confirmationStatus || null,
    clientName: metadata.customerName || metadata.clientName || metadata.name || schedule.contactId || schedule.contextId || 'Cliente',
    clientId: metadata.customerId || schedule.contactId || schedule.contextId || null,
    subjectId: metadata.subjectId || schedule.contextId || schedule.contactId || null,
    professionalId: metadata.professionalId || schedule.ownerId || schedule.teamId || null,
    professionalName: metadata.professionalName || schedule.ownerId || schedule.teamId || 'Nao definido',
    service: metadata.service || metadata.serviceName || schedule.purpose || 'servico',
    notes: schedule.notes || null,
    contextType: schedule.contextType || null,
    contextId: schedule.contextId || null,
    metadata,
  };
}

function parseCustomerTokens({ subjectId, customerId }) {
  const out = new Set();
  if (subjectId) out.add(safeString(subjectId));
  if (customerId) out.add(safeString(customerId));
  return Array.from(out);
}

function scheduleMatchesCustomer(schedule, tokens) {
  if (!tokens.length) return false;
  const metadata = schedule?.metadata && typeof schedule.metadata === 'object' ? schedule.metadata : {};
  const values = [
    schedule?.contextId,
    schedule?.contactId,
    metadata.subjectId,
    metadata.customerId,
    metadata.clientId,
  ].map((v) => safeString(v, '')).filter(Boolean);

  return tokens.some((token) => values.includes(token));
}

function normalizeJourneyStatus(statusValue) {
  const value = safeLower(statusValue || '');
  if (value === 'failed' || value === 'error') return 'failed';
  if (value === 'pending') return 'pending';
  return 'success';
}

function ensureAuth(req, res, deps) {
  const { requireAuth, sendJson, requireTenant } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }
  const tenantId = requireTenant(req, res);
  if (!tenantId) return false;
  return true;
}

function tenantId(req) {
  return req.tenantId || req.agent?.tenantId || null;
}

module.exports = {
  VERTICAL,
  dbAvailable,
  safeString,
  safeLower,
  normalizeDay,
  dayWindow,
  isInsideWindow,
  mapAgendaItem,
  parseCustomerTokens,
  scheduleMatchesCustomer,
  normalizeJourneyStatus,
  ensureAuth,
  tenantId,
};
