'use strict';

const { Op } = require('sequelize');
const {
  OperationalSchedule,
  ScheduleWorkingHour,
  ScheduleBlock,
  FitnessClassSchedule,
  FitnessProfessional,
  FitnessResource,
  FitnessScheduleProfessional,
  FitnessScheduleResource,
  BeautyScheduleProfessional,
} = require('../db/models');

function safeStr(value, fallback = '') {
  return String(value == null ? fallback : value).trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDateRequired(value, field) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error(`${field}_invalid`);
    err.code = `${field}_invalid`;
    throw err;
  }
  return parsed;
}

function toJson(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function normalizeScheduleStatus(value) {
  return safeStr(value).toLowerCase();
}

function minutesFromTime(raw) {
  const match = String(raw || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function mapOperationalSchedule(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    contextType: item.context_type,
    contextId: item.context_id,
    startAt: item.start_at ? new Date(item.start_at).toISOString() : null,
    endAt: item.end_at ? new Date(item.end_at).toISOString() : null,
    ownerId: item.owner_id || null,
    teamId: item.team_id || null,
    status: item.status || null,
    purpose: item.purpose || null,
    metadata: item.metadata || {},
  };
}

function mapFitnessSchedule(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    classId: item.class_id,
    operationalScheduleId: item.operational_schedule_id || null,
    startAt: item.start_at ? new Date(item.start_at).toISOString() : null,
    endAt: item.end_at ? new Date(item.end_at).toISOString() : null,
    status: item.status || null,
    capacity: Number(item.capacity || 0),
    metadata: item.metadata || {},
  };
}

function mapProfessional(row) {
  const item = toJson(row);
  return {
    id: item.id,
    name: item.name || null,
    maxConcurrentSessions: Number(item.max_concurrent_sessions || 1),
    active: item.active !== false,
  };
}

function mapResource(row) {
  const item = toJson(row);
  return {
    id: item.id,
    name: item.name || null,
    capacity: Math.max(1, Number(item.capacity || 1)),
    exclusiveUse: item.exclusive_use === true,
    active: item.active !== false,
  };
}

function mapBlockRow(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    scopeType: item.scope_type,
    scopeId: item.scope_id,
    startAt: item.start_at ? new Date(item.start_at).toISOString() : null,
    endAt: item.end_at ? new Date(item.end_at).toISOString() : null,
    reason: item.reason || null,
    active: item.active !== false,
    metadata: item.metadata || {},
  };
}

function overlapsRange(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

async function loadScheduleRelationMaps({ tenantId, scheduleIds = [] }) {
  const ids = Array.from(new Set(ensureArray(scheduleIds).map((item) => safeStr(item)).filter(Boolean)));
  if (ids.length === 0) {
    return {
      professionalsByScheduleId: new Map(),
      resourcesByScheduleId: new Map(),
      beautyProfessionalsByOperationalScheduleId: new Map(),
    };
  }

  const [professionalRows, resourceRows, beautyProfessionalRows] = await Promise.all([
    FitnessScheduleProfessional().findAll({
      where: { tenant_key: String(tenantId), class_schedule_id: { [Op.in]: ids } },
    }),
    FitnessScheduleResource().findAll({
      where: { tenant_key: String(tenantId), class_schedule_id: { [Op.in]: ids } },
    }),
    BeautyScheduleProfessional().findAll({
      where: { tenant_key: String(tenantId), operational_schedule_id: { [Op.in]: ids } },
    }),
  ]);

  const professionalsByScheduleId = new Map();
  for (const row of professionalRows.map(toJson)) {
    const bucket = professionalsByScheduleId.get(String(row.class_schedule_id)) || [];
    bucket.push(String(row.professional_id));
    professionalsByScheduleId.set(String(row.class_schedule_id), bucket);
  }

  const resourcesByScheduleId = new Map();
  for (const row of resourceRows.map(toJson)) {
    const bucket = resourcesByScheduleId.get(String(row.class_schedule_id)) || [];
    bucket.push({
      resourceId: String(row.resource_id),
      quantity: Math.max(1, Number(row.quantity || 1)),
      exclusiveUse: row.exclusive_use === true,
      metadata: row.metadata || {},
    });
    resourcesByScheduleId.set(String(row.class_schedule_id), bucket);
  }

  const beautyProfessionalsByOperationalScheduleId = new Map();
  for (const row of beautyProfessionalRows.map(toJson)) {
    const bucket = beautyProfessionalsByOperationalScheduleId.get(String(row.operational_schedule_id)) || [];
    bucket.push(String(row.beauty_professional_id));
    beautyProfessionalsByOperationalScheduleId.set(String(row.operational_schedule_id), bucket);
  }

  return { professionalsByScheduleId, resourcesByScheduleId, beautyProfessionalsByOperationalScheduleId };
}

async function resolveCentralAvailability({
  tenantId,
  startAt,
  endAt,
  timezone = 'UTC',
  mode = 'free',
  ownerId = null,
  teamId = null,
  excludeOperationalScheduleId = null,
}) {
  const start = parseDateRequired(startAt, 'start_at');
  const end = parseDateRequired(endAt, 'end_at');
  const normalizedMode = safeStr(mode || 'free').toLowerCase() || 'free';
  if (end.getTime() <= start.getTime()) {
    const err = new Error('invalid_time_range');
    err.code = 'invalid_time_range';
    throw err;
  }

  if (normalizedMode === 'free') {
    return {
      ok: true,
      available: true,
      reasons: [],
      mode: normalizedMode,
      timezone,
      conflicts: [],
      blocks: [],
      source: 'operational_free_mode',
    };
  }

  const scopeType = ownerId ? 'owner' : 'team';
  const scopeId = ownerId ? String(ownerId) : String(teamId || '');
  if (!scopeId) {
    const err = new Error('team_or_owner_required_for_team_based');
    err.code = 'team_or_owner_required_for_team_based';
    throw err;
  }

  const weekday = start.getDay();
  const [hoursRows, blockRows, reservationRows] = await Promise.all([
    ScheduleWorkingHour().findAll({
      where: {
        tenant_key: String(tenantId),
        scope_type: scopeType,
        scope_id: scopeId,
        weekday,
        enabled: true,
      },
    }),
    ScheduleBlock().findAll({
      where: {
        tenant_key: String(tenantId),
        scope_type: scopeType,
        scope_id: scopeId,
        active: true,
        start_at: { [Op.lt]: end },
        end_at: { [Op.gt]: start },
      },
      order: [['start_at', 'ASC']],
      limit: 20,
    }),
    OperationalSchedule().findAll({
      where: {
        tenant_key: String(tenantId),
        status: { [Op.in]: ['scheduled', 'in_progress'] },
        start_at: { [Op.lt]: end },
        end_at: { [Op.gt]: start },
        ...(scopeType === 'owner' ? { owner_id: scopeId } : {}),
        ...(scopeType === 'team' ? { team_id: scopeId } : {}),
        ...(excludeOperationalScheduleId ? { id: { [Op.ne]: String(excludeOperationalScheduleId) } } : {}),
      },
      order: [['start_at', 'ASC']],
      limit: 20,
    }),
  ]);

  const reasons = [];
  if (!Array.isArray(hoursRows) || hoursRows.length === 0) {
    reasons.push('outside_working_hours');
  } else {
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    const withinAnyWindow = hoursRows.some((row) => {
      const item = toJson(row);
      const startWindow = minutesFromTime(item.start_time);
      const endWindow = minutesFromTime(item.end_time);
      if (startWindow == null || endWindow == null) return false;
      return startMinutes >= startWindow && endMinutes <= endWindow;
    });
    if (!withinAnyWindow) reasons.push('outside_working_hours');
  }

  if (blockRows.length > 0) reasons.push('blocked_window');
  if (reservationRows.length > 0) reasons.push('schedule_conflict');

  return {
    ok: true,
    available: reasons.length === 0,
    reasons,
    mode: normalizedMode,
    timezone,
    scope: { type: scopeType, id: scopeId },
    conflicts: reservationRows.map(mapOperationalSchedule),
    blocks: blockRows.map(mapBlockRow),
    source: 'operational_schedule',
  };
}

async function resolveOperationalAvailability({
  tenantId,
  startAt,
  endAt,
  timezone = 'UTC',
  mode = 'free',
  ownerId = null,
  teamId = null,
  excludeOperationalScheduleId = null,
  excludeFitnessScheduleId = null,
  professionalIds = [],
  resourceRequirements = [],
}) {
  const start = parseDateRequired(startAt, 'start_at');
  const end = parseDateRequired(endAt, 'end_at');
  if (end.getTime() <= start.getTime()) {
    const err = new Error('invalid_time_range');
    err.code = 'invalid_time_range';
    throw err;
  }

  const targetProfessionalIds = Array.from(new Set(ensureArray(professionalIds).map((item) => safeStr(item)).filter(Boolean)));
  const targetResourceRequirements = Array.from(new Map(
    ensureArray(resourceRequirements)
      .map((item) => ({
        resourceId: safeStr(item?.resourceId || item?.resource_id),
        quantity: Math.max(1, Number(item?.quantity || 1)),
        exclusiveUse: item?.exclusiveUse === true || item?.exclusive_use === true,
      }))
      .filter((item) => item.resourceId)
      .map((item) => [item.resourceId, item]),
  ).values());

  const overlappingOperationalRows = await OperationalSchedule().findAll({
    where: {
      tenant_key: String(tenantId),
      start_at: { [Op.lt]: end },
      end_at: { [Op.gt]: start },
      ...(excludeOperationalScheduleId ? { id: { [Op.ne]: String(excludeOperationalScheduleId) } } : {}),
    },
    order: [['start_at', 'ASC']],
    limit: 200,
  });

  const shouldCheckCentral = safeStr(ownerId) || safeStr(teamId) || safeStr(mode).toLowerCase() === 'team_based';
  const centralAvailability = await resolveCentralAvailability({
    tenantId,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone,
    mode: shouldCheckCentral ? 'team_based' : 'free',
    ownerId: ownerId ? String(ownerId) : null,
    teamId: teamId ? String(teamId) : null,
    excludeOperationalScheduleId,
  });

  const overlappingFitnessRows = await FitnessClassSchedule().findAll({
    where: {
      tenant_key: String(tenantId),
      start_at: { [Op.lt]: end },
      end_at: { [Op.gt]: start },
    },
    order: [['start_at', 'ASC']],
    limit: 200,
  });

  const activeFitnessSchedules = overlappingFitnessRows
    .map(mapFitnessSchedule)
    .filter((item) => item.id !== safeStr(excludeFitnessScheduleId))
    .filter((item) => item.operationalScheduleId !== safeStr(excludeOperationalScheduleId))
    .filter((item) => !['cancelled', 'completed', 'canceled', 'done'].includes(normalizeScheduleStatus(item.status)))
    .filter((item) => item.startAt && item.endAt)
    .filter((item) => overlapsRange(start, end, new Date(item.startAt), new Date(item.endAt)));

  const relationMaps = await loadScheduleRelationMaps({
    tenantId,
    scheduleIds: activeFitnessSchedules.map((item) => item.id).concat(overlappingOperationalRows.map((item) => safeStr(item.id))),
  });

  const [professionalRows, resourceRows] = await Promise.all([
    targetProfessionalIds.length > 0
      ? FitnessProfessional().findAll({ where: { tenant_key: String(tenantId), id: { [Op.in]: targetProfessionalIds } } })
      : Promise.resolve([]),
    targetResourceRequirements.length > 0
      ? FitnessResource().findAll({ where: { tenant_key: String(tenantId), id: { [Op.in]: targetResourceRequirements.map((item) => item.resourceId) } } })
      : Promise.resolve([]),
  ]);

  const professionalsById = new Map(professionalRows.map((row) => {
    const item = mapProfessional(row);
    return [item.id, item];
  }));
  const resourcesById = new Map(resourceRows.map((row) => {
    const item = mapResource(row);
    return [item.id, item];
  }));

  const professionalConflicts = [];
  for (const professionalId of targetProfessionalIds) {
    const overlappingForProfessional = activeFitnessSchedules.filter((schedule) => {
      const explicitIds = ensureArray(relationMaps.professionalsByScheduleId.get(schedule.id)).map(String);
      const fallbackIds = ensureArray(schedule.metadata?.professionalIds).concat(schedule.metadata?.professionalId ? [schedule.metadata.professionalId] : []).map(String);
      const effectiveIds = explicitIds.length > 0 ? explicitIds : fallbackIds;
      return effectiveIds.includes(String(professionalId));
    }).concat(
      overlappingOperationalRows
        .map(mapOperationalSchedule)
        .filter((schedule) => {
          const explicitBeautyProfessionalIds = ensureArray(relationMaps.beautyProfessionalsByOperationalScheduleId.get(schedule.id)).map(String);
          const metadata = schedule.metadata || {};
          const metadataIds = ensureArray(metadata.professionalIds)
            .concat(ensureArray(metadata.beautyProfessionalIds))
            .concat(metadata.professionalId ? [metadata.professionalId] : [])
            .concat(metadata.beautyProfessionalId ? [metadata.beautyProfessionalId] : [])
            .map(String);
          const effectiveIds = explicitBeautyProfessionalIds.length > 0 ? explicitBeautyProfessionalIds : metadataIds;
          return effectiveIds.includes(String(professionalId));
        }),
    );
    const professional = professionalsById.get(String(professionalId)) || { id: professionalId, maxConcurrentSessions: 1, active: true };
    if (overlappingForProfessional.length >= Math.max(1, Number(professional.maxConcurrentSessions || 1))) {
      professionalConflicts.push({
        professionalId: String(professionalId),
        professionalName: professional.name || null,
        conflicts: overlappingForProfessional,
      });
    }
  }

  const resourceConflicts = [];
  for (const requirement of targetResourceRequirements) {
    const resource = resourcesById.get(String(requirement.resourceId)) || {
      id: requirement.resourceId,
      capacity: 1,
      exclusiveUse: requirement.exclusiveUse === true,
      active: true,
    };
    const overlappingForResource = activeFitnessSchedules.flatMap((schedule) => {
      const explicit = ensureArray(relationMaps.resourcesByScheduleId.get(schedule.id));
      const fallback = ensureArray(schedule.metadata?.resourceIds).map((resourceId) => ({
        resourceId: String(resourceId),
        quantity: 1,
        exclusiveUse: false,
      }));
      return (explicit.length > 0 ? explicit : fallback)
        .filter((item) => String(item.resourceId) === String(requirement.resourceId))
        .map((item) => ({ schedule, quantity: Math.max(1, Number(item.quantity || 1)), exclusiveUse: item.exclusiveUse === true }));
    }).concat(
      overlappingOperationalRows
        .map(mapOperationalSchedule)
        .flatMap((schedule) => {
          const metadata = schedule.metadata || {};
          const fallback = ensureArray(metadata.resourceRequirements).map((item) => ({
            schedule,
            quantity: Math.max(1, Number(item.quantity || 1)),
            exclusiveUse: item.exclusiveUse === true || item.exclusive_use === true,
            resourceId: String(item.resourceId || item.resource_id || ''),
          })).filter((item) => item.resourceId);
          return fallback
            .filter((item) => item.resourceId === String(requirement.resourceId))
            .map((item) => ({ schedule: item.schedule, quantity: item.quantity, exclusiveUse: item.exclusiveUse }));
        }),
    );
    const concurrentQuantity = overlappingForResource.reduce((sum, item) => sum + item.quantity, 0);
    const exclusiveHit = resource.exclusiveUse === true
      || requirement.exclusiveUse === true
      || overlappingForResource.some((item) => item.exclusiveUse === true);
    if ((exclusiveHit && overlappingForResource.length > 0) || (concurrentQuantity + requirement.quantity) > Math.max(1, Number(resource.capacity || 1))) {
      resourceConflicts.push({
        resourceId: String(requirement.resourceId),
        resourceName: resource.name || null,
        requestedQuantity: requirement.quantity,
        concurrentQuantity,
        capacity: Math.max(1, Number(resource.capacity || 1)),
        conflicts: overlappingForResource.map((item) => item.schedule),
      });
    }
  }

  const reasons = Array.from(new Set([
    ...ensureArray(centralAvailability.reasons),
    ...(professionalConflicts.length > 0 ? ['professional_conflict'] : []),
    ...(resourceConflicts.length > 0 ? ['resource_conflict'] : []),
  ]));

  return {
    ok: true,
    available: reasons.length === 0,
    reasons,
    centralAvailability,
    professionalConflicts,
    resourceConflicts,
    targetProfessionalIds,
    targetResourceRequirements,
  };
}

module.exports = {
  resolveCentralAvailability,
  resolveOperationalAvailability,
};
