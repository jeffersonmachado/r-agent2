'use strict';

const { Op } = require('sequelize');
const authService = require('../../services/authService');
const departmentsService = require('../../services/departmentsService');
const scheduleService = require('../../services/scheduleService');
const { MarketingLead } = require('../../db/models');

function toLower(value) {
  return String(value || '').toLowerCase();
}

function normalizeLimit(value, { min = 1, max = 50, fallback = 20 } = {}) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeOffset(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

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

async function handleUsersSearch({ req, res, deps, tenantId }) {
  const { sendJson } = deps;
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const q = String(urlObj.searchParams.get('q') || '').trim().toLowerCase();
  const limit = normalizeLimit(urlObj.searchParams.get('limit'), { min: 1, max: 50, fallback: 10 });

  const users = await authService.listAgents(tenantId);
  const filtered = users
    .filter((user) => {
      if (!q) return true;
      return [user.id, user.name, user.email, user.username, user.status, user.role]
        .map(toLower)
        .some((value) => value.includes(q));
    })
    .slice(0, limit)
    .map((user) => ({
      id: user.id,
      name: user.name || user.username || user.email || user.id,
      email: user.email || null,
      username: user.username || null,
      status: user.status || (user.active === false ? 'inactive' : 'active'),
      role: user.role || null,
    }));

  sendJson(res, 200, {
    items: filtered,
    total: filtered.length,
  });
}

function handleTeamsSearch({ req, res, deps, tenantId }) {
  const { sendJson } = deps;
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const q = String(urlObj.searchParams.get('q') || '').trim().toLowerCase();
  const limit = normalizeLimit(urlObj.searchParams.get('limit'), { min: 1, max: 100, fallback: 20 });

  const teams = departmentsService.listDepartments({ tenantId, activeOnly: true })
    .filter((team) => {
      if (!q) return true;
      return [team.id, team.name, team.description]
        .map(toLower)
        .some((value) => value.includes(q));
    })
    .slice(0, limit)
    .map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description || null,
      color: team.color || null,
      active: team.active !== false,
    }));

  sendJson(res, 200, {
    items: teams,
    total: teams.length,
  });
}

function handleSchedulePurposes({ req, res, deps, tenantId }) {
  const { sendJson } = deps;
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const search = String(urlObj.searchParams.get('search') || '').trim().toLowerCase();
  const limit = normalizeLimit(urlObj.searchParams.get('limit'), { min: 1, max: 100, fallback: 20 });

  const defaultPurposes = [
    'avaliacao',
    'consulta',
    'retorno',
    'atendimento',
    'procedimento',
    'aula_experimental',
    'treino',
    'reuniao',
    'compromisso',
  ];

  const dynamicPurposes = listAllSchedules(tenantId)
    .map((item) => String(item?.purpose || '').trim())
    .filter(Boolean);

  const seen = new Set();
  const merged = [...defaultPurposes, ...dynamicPurposes]
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .filter((value) => (search ? value.toLowerCase().includes(search) : true))
    .slice(0, limit)
    .map((value) => ({
      value,
      label: value.replace(/_/g, ' '),
    }));

  sendJson(res, 200, {
    items: merged,
    total: merged.length,
  });
}

async function handleCrmContacts({ req, res, deps, tenantId }) {
  const { sendJson, logger } = deps;
  const urlObj = new URL(req.url || '/', 'http://localhost');
  const phone = String(urlObj.searchParams.get('phone') || '').trim();
  const limit = normalizeLimit(urlObj.searchParams.get('limit'), { min: 1, max: 1000, fallback: 50 });
  const offset = normalizeOffset(urlObj.searchParams.get('offset'), 0);

  try {
    const LeadModel = typeof MarketingLead === 'function' ? MarketingLead() : MarketingLead;
    const where = {
      tenant_key: String(tenantId),
    };

    if (phone) {
      where.phone = {
        [Op.iLike]: `%${phone.replace(/\D/g, '')}%`,
      };
    }

    const rows = await LeadModel.findAll({
      where,
      order: [['updated_at', 'DESC'], ['created_at', 'DESC']],
      limit,
      offset,
    });

    const contacts = (rows || []).map((row) => {
      const item = row.toJSON ? row.toJSON() : row;
      return {
        id: item.id,
        name: item.name || null,
        email: item.email || null,
        phone: item.phone || null,
        stage: item.stage || null,
        score: item.score,
        externalId: item.external_id || null,
        lastSeenAt: item.last_seen_at || null,
        attributes: item.attributes || {},
      };
    });

    sendJson(res, 200, {
      items: contacts,
      contacts,
      total: contacts.length,
    });
    return;
  } catch (err) {
    logger.warn('[SchedulingSupportRoutes] Falha ao listar CRM contacts', {
      tenantId,
      error: err.message,
    });
    sendJson(res, 200, {
      items: [],
      contacts: [],
      total: 0,
    });
  }
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

async function handleSchedulingSupportRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
  } = deps;

  const isSupportedPath = (
    pathname.startsWith('/api/calendar')
    || pathname === '/api/users/search'
    || pathname === '/api/teams/search'
    || pathname === '/api/schedule-purposes'
    || pathname === '/api/crm/contacts'
  );

  if (!isSupportedPath) return false;

  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return true;
  }

  const tenantId = requireTenant(req, res);
  if (!tenantId) return true;

  if (method === 'GET' && pathname === '/api/users/search') {
    await handleUsersSearch({ req, res, deps, tenantId });
    return true;
  }

  if (method === 'GET' && pathname === '/api/teams/search') {
    handleTeamsSearch({ req, res, deps, tenantId });
    return true;
  }

  if (method === 'GET' && pathname === '/api/schedule-purposes') {
    handleSchedulePurposes({ req, res, deps, tenantId });
    return true;
  }

  if (method === 'GET' && pathname === '/api/crm/contacts') {
    await handleCrmContacts({ req, res, deps, tenantId });
    return true;
  }

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
  handleSchedulingSupportRoutes,
};
