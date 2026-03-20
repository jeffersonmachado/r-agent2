'use strict';

const { Op } = require('sequelize');

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

function parseCalendarWindow(req) {
  const urlObj = new URL(req.url || '/', 'http://localhost');
  return {
    startDate: parseIsoDate(urlObj.searchParams.get('start')),
    endDate: parseIsoDate(urlObj.searchParams.get('end')),
  };
}

function validateBlockPayload(body) {
  const startAt = parseIsoDate(body?.startAt);
  const endAt = parseIsoDate(body?.endAt);
  if (!startAt || !endAt) return { valid: false, error: 'startAt e endAt sao obrigatorios' };
  if (endAt.getTime() <= startAt.getTime()) return { valid: false, error: 'endAt deve ser maior que startAt' };
  return { valid: true, startAt: startAt.toISOString(), endAt: endAt.toISOString() };
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

function createSchedulingSupportService({
  authService,
  departmentsService,
  scheduleService,
  MarketingLead,
}) {
  function listAllSchedules(tenantId) {
    if (typeof scheduleService._getTenantStore === 'function') {
      const store = scheduleService._getTenantStore(tenantId);
      return Array.from(store.values());
    }
    return scheduleService.listSchedules({ tenantId, limit: 200 }).items || [];
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

  return {
    async searchUsers(req, tenantId) {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const q = String(urlObj.searchParams.get('q') || '').trim().toLowerCase();
      const limit = normalizeLimit(urlObj.searchParams.get('limit'), { min: 1, max: 50, fallback: 10 });

      const users = await authService.listAgents(tenantId);
      const items = users
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

      return { items, total: items.length };
    },

    searchTeams(req, tenantId) {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const q = String(urlObj.searchParams.get('q') || '').trim().toLowerCase();
      const limit = normalizeLimit(urlObj.searchParams.get('limit'), { min: 1, max: 100, fallback: 20 });

      const items = departmentsService.listDepartments({ tenantId, activeOnly: true })
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

      return { items, total: items.length };
    },

    listSchedulePurposes(req, tenantId) {
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
      const items = [...defaultPurposes, ...dynamicPurposes]
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

      return { items, total: items.length };
    },

    async listCrmContacts(req, tenantId, logger) {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const phone = String(urlObj.searchParams.get('phone') || '').trim();
      const limit = normalizeLimit(urlObj.searchParams.get('limit'), { min: 1, max: 1000, fallback: 50 });
      const offset = normalizeOffset(urlObj.searchParams.get('offset'), 0);

      try {
        const LeadModel = typeof MarketingLead === 'function' ? MarketingLead() : MarketingLead;
        const where = { tenant_key: String(tenantId) };

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

        return { items: contacts, contacts, total: contacts.length };
      } catch (err) {
        logger.warn('[SchedulingSupportRoutes] Falha ao listar CRM contacts', {
          tenantId,
          error: err.message,
        });
        return { items: [], contacts: [], total: 0 };
      }
    },

    getMyCalendar(req, tenantId) {
      const resourceId = req?.agent?.id || req?.agent?.username || null;
      if (!resourceId) {
        return { ok: false, kind: 'bad_request', payload: { error: 'calendar_resource_not_found' } };
      }

      const { startDate, endDate } = parseCalendarWindow(req);
      const items = buildCalendarItems({ tenantId, resourceId, startDate, endDate });
      return { ok: true, payload: { resourceId, items, total: items.length } };
    },

    getResourceCalendar(req, tenantId) {
      const resourceId = decodeURIComponent(String(req.params.resourceId || ''));
      if (!resourceId) {
        return { ok: false, kind: 'bad_request', message: 'resourceId e obrigatorio' };
      }

      const { startDate, endDate } = parseCalendarWindow(req);
      const items = buildCalendarItems({ tenantId, resourceId, startDate, endDate });
      return { ok: true, payload: { resourceId, items, total: items.length } };
    },

    createCalendarBlock(req, tenantId, body) {
      const resourceId = decodeURIComponent(String(req.params.resourceId || ''));
      if (!resourceId) {
        return { ok: false, kind: 'bad_request', message: 'resourceId e obrigatorio' };
      }

      const validation = validateBlockPayload(body);
      if (!validation.valid) {
        return { ok: false, kind: 'bad_request', message: validation.error };
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

      return {
        ok: true,
        status: 201,
        payload: { item: mapBlockToCalendarItem(created) },
      };
    },

    deleteCalendarBlock(req, tenantId) {
      const resourceId = decodeURIComponent(String(req.params.resourceId || ''));
      const blockId = decodeURIComponent(String(req.params.blockId || ''));
      if (!resourceId || !blockId) {
        return { ok: false, kind: 'bad_request', message: 'resourceId e blockId sao obrigatorios' };
      }

      const existing = scheduleService.getSchedule({ tenantId, scheduleId: blockId });
      if (!existing || existing.contextType !== 'calendar_block' || String(existing.contextId || '') !== String(resourceId)) {
        return { ok: false, status: 404, payload: { error: 'calendar_block_not_found' } };
      }

      scheduleService.deleteSchedule({ tenantId, scheduleId: blockId });
      return { ok: true, payload: { ok: true } };
    },
  };
}

module.exports = {
  createSchedulingSupportService,
};
