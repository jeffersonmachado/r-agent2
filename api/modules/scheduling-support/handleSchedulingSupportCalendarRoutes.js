'use strict';

const scheduleService = require('../../services/scheduleService');

function parseIsoDate(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function intersectsWindow(item, startDate, endDate) {
  const startAt = parseIsoDate(item?.startAt);
  const endAt = parseIsoDate(item?.endAt) || startAt;
  if (!startAt) return false;

  if (startDate && endAt && endAt.getTime() < startDate.getTime()) return false;
  if (endDate && startAt.getTime() > endDate.getTime()) return false;
  return true;
}

function listAllSchedules(tenantId) {
  if (typeof scheduleService._getTenantStore === 'function') {
    const store = scheduleService._getTenantStore(tenantId);
    return Array.from(store.values());
  }
  return scheduleService.listSchedules({ tenantId, limit: 200 }).items || [];
}

function mapScheduleToCalendarItem(schedule) {
  return {
    id: schedule.id,
    type: 'schedule',
    title: schedule.purpose || 'Agendamento',
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    status: schedule.status,
    contextType: schedule.contextType,
    contextId: schedule.contextId,
    ownerId: schedule.ownerId || null,
    teamId: schedule.teamId || null,
  };
}

function mapBlockToCalendarItem(schedule) {
  return {
    id: schedule.id,
    type: 'block',
    title: 'Indisponivel',
    startAt: schedule.startAt,
    endAt: schedule.endAt,
    reason: schedule?.metadata?.reason || schedule.notes || null,
    contextType: schedule.contextType,
    contextId: schedule.contextId,
  };
}

function buildCalendarItems({ tenantId, resourceId, startDate, endDate }) {
  const items = listAllSchedules(tenantId);
  const safeResourceId = String(resourceId || '');

  const appointments = items
    .filter((item) => item && item.contextType !== 'calendar_block')
    .filter((item) => {
      const ownerId = item.ownerId ? String(item.ownerId) : '';
      const teamId = item.teamId ? String(item.teamId) : '';
      const contextId = item.contextId ? String(item.contextId) : '';
      return ownerId === safeResourceId || teamId === safeResourceId || contextId === safeResourceId;
    })
    .filter((item) => intersectsWindow(item, startDate, endDate))
    .map(mapScheduleToCalendarItem);

  const blocks = items
    .filter((item) => item && item.contextType === 'calendar_block' && String(item.contextId || '') === safeResourceId)
    .filter((item) => intersectsWindow(item, startDate, endDate))
    .map(mapBlockToCalendarItem);

  return [...appointments, ...blocks].sort((a, b) => {
    const aTs = Date.parse(a.startAt || '') || 0;
    const bTs = Date.parse(b.startAt || '') || 0;
    return aTs - bTs;
  });
}

function validateBlockPayload(body) {
  const startAt = parseIsoDate(body?.startAt);
  const endAt = parseIsoDate(body?.endAt);
  if (!startAt || !endAt) return { valid: false, error: 'startAt e endAt sao obrigatorios' };
  if (endAt.getTime() <= startAt.getTime()) return { valid: false, error: 'endAt deve ser maior que startAt' };
  return { valid: true, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}

function parseCalendarWindow(req) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const startDate = parseIsoDate(urlObj.searchParams.get('start'));
  const endDate = parseIsoDate(urlObj.searchParams.get('end'));
  return { startDate, endDate };
}

async function handleSchedulingSupportCalendarRoutes(ctx) {
  const { req, res, method, pathname, deps, tenantId } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
  } = deps;

  if (method === 'GET' && pathname === '/api/calendar/me') {
    const resourceId = req?.agent?.id || req?.agent?.username || null;
    if (!resourceId) {
      sendJson(res, 400, { error: 'calendar_resource_not_found' });
      return true;
    }

    const { startDate, endDate } = parseCalendarWindow(req);
    const items = buildCalendarItems({ tenantId, resourceId, startDate, endDate });
    sendJson(res, 200, {
      resourceId,
      items,
      total: items.length,
    });
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/api/calendar/resource/')) {
    const resourceId = decodeURIComponent(pathname.slice('/api/calendar/resource/'.length));
    if (!resourceId) {
      badRequest(res, 'resourceId e obrigatorio');
      return true;
    }

    const { startDate, endDate } = parseCalendarWindow(req);
    const items = buildCalendarItems({ tenantId, resourceId, startDate, endDate });
    sendJson(res, 200, {
      resourceId,
      items,
      total: items.length,
    });
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/api/calendar/resource/') && pathname.endsWith('/blocks')) {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const resourceId = decodeURIComponent(pathname.slice('/api/calendar/resource/'.length, -'/blocks'.length));
    if (!resourceId) {
      badRequest(res, 'resourceId e obrigatorio');
      return true;
    }

    const body = await parseJsonBody(req);
    const validation = validateBlockPayload(body);
    if (!validation.valid) {
      badRequest(res, validation.error);
      return true;
    }

    const created = scheduleService.createSchedule({
      tenantId,
      payload: {
        contextType: 'calendar_block',
        contextId: resourceId,
        startAt: validation.startAt,
        endAt: validation.endAt,
        purpose: 'indisponibilidade',
        notes: String(body?.reason || '').trim() || null,
        metadata: {
          reason: String(body?.reason || '').trim() || null,
          source: 'calendar_resource_block',
        },
      },
    });

    sendJson(res, 201, {
      item: mapBlockToCalendarItem(created),
    });
    return true;
  }

  if (method === 'DELETE' && pathname.startsWith('/api/calendar/resource/') && pathname.includes('/blocks/')) {
    const seg = pathname.slice('/api/calendar/resource/'.length);
    const idx = seg.indexOf('/blocks/');
    const resourceId = decodeURIComponent(seg.slice(0, idx));
    const blockId = decodeURIComponent(seg.slice(idx + '/blocks/'.length));

    if (!resourceId || !blockId) {
      badRequest(res, 'resourceId e blockId sao obrigatorios');
      return true;
    }

    const existing = scheduleService.getSchedule({ tenantId, scheduleId: blockId });
    if (!existing || existing.contextType !== 'calendar_block' || String(existing.contextId || '') !== String(resourceId)) {
      sendJson(res, 404, { error: 'calendar_block_not_found' });
      return true;
    }

    scheduleService.deleteSchedule({ tenantId, scheduleId: blockId });
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

module.exports = {
  handleSchedulingSupportCalendarRoutes,
};
