'use strict';

const crypto = require('crypto');
const {
  FitnessClass,
  FitnessClassSchedule,
  FitnessMembership,
  FitnessAttendance,
  FitnessCheckin,
  FitnessMemberGoal,
  FitnessProfessional,
  FitnessResource,
  FitnessActivityProfessional,
  FitnessActivityResource,
  FitnessScheduleProfessional,
  FitnessScheduleResource,
  CrmContact,
  OperationalSchedule,
  AutonomousWaitingList,
} = require('../db/models');
const { getPreset } = require('../core/autonomous-scheduling/VerticalTemplateRegistry');
const kioskService = require('../channels/kiosk/KioskService');
const waitingListService = require('../core/autonomous-scheduling').waitingListService;
const { getInsights } = require('../core/autonomous-scheduling/PredictiveInsightsService');
const schedulingService = require('./schedulingService');
const { resolveOperationalAvailability } = require('./operationalAvailabilityService');

const PREFER_EXPLICIT_RELATIONS = true;

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(value, fallback = '') {
  const normalized = value == null ? fallback : String(value).trim();
  return normalized;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampInt(value, fallback = 0, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function startOfIsoWeek(date) {
  const value = new Date(date);
  const day = value.getUTCDay() || 7;
  if (day !== 1) {
    value.setUTCDate(value.getUTCDate() - (day - 1));
  }
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

function endOfIsoWeek(date) {
  const start = startOfIsoWeek(date);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  end.setUTCMilliseconds(-1);
  return end;
}

function toJson(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function mapClass(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    name: item.name,
    instructorId: item.instructor_id || null,
    category: item.category || '',
    operationMode: item.operation_mode || item.metadata?.operationMode || 'group_class',
    durationMinutes: Number(item.duration_minutes || 0),
    defaultCapacity: Number(item.default_capacity || 0),
    active: item.active !== false,
    metadata: item.metadata || {},
  };
}

function mapProfessional(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    name: item.name,
    roleType: item.role_type || 'instructor',
    specialties: ensureArray(item.specialties),
    active: item.active !== false,
    canGroupSessions: item.can_group_sessions !== false,
    canIndividualSessions: item.can_individual_sessions !== false,
    maxConcurrentSessions: Number(item.max_concurrent_sessions || 1),
    metadata: item.metadata || {},
  };
}

function mapResource(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    name: item.name,
    resourceType: item.resource_type || 'room',
    capacity: Number(item.capacity || 1),
    location: item.location || null,
    exclusiveUse: item.exclusive_use === true,
    active: item.active !== false,
    metadata: item.metadata || {},
  };
}

function mapActivityProfessional(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    activityId: item.activity_id,
    professionalId: item.professional_id,
    durationMinutes: item.duration_minutes == null ? null : Number(item.duration_minutes),
    defaultPrice: item.default_price == null ? null : Number(item.default_price),
    maxCapacityOverride: item.max_capacity_override == null ? null : Number(item.max_capacity_override),
    metadata: item.metadata || {},
  };
}

function mapActivityResource(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    activityId: item.activity_id,
    resourceId: item.resource_id,
    required: item.required !== false,
    quantity: Number(item.quantity || 1),
    exclusiveUse: item.exclusive_use === true,
    metadata: item.metadata || {},
  };
}

function buildScheduleRelationMaps(scheduleProfessionalRows = [], scheduleResourceRows = []) {
  const professionalsByScheduleId = new Map();
  for (const row of ensureArray(scheduleProfessionalRows).map(toJson)) {
    const scheduleId = safeStr(row.class_schedule_id);
    const professionalId = safeStr(row.professional_id);
    if (!scheduleId || !professionalId) continue;
    const bucket = professionalsByScheduleId.get(scheduleId) || [];
    if (!bucket.includes(professionalId)) bucket.push(professionalId);
    professionalsByScheduleId.set(scheduleId, bucket);
  }

  const resourcesByScheduleId = new Map();
  for (const row of ensureArray(scheduleResourceRows).map(toJson)) {
    const scheduleId = safeStr(row.class_schedule_id);
    const resourceId = safeStr(row.resource_id);
    if (!scheduleId || !resourceId) continue;
    const bucket = resourcesByScheduleId.get(scheduleId) || [];
    if (!bucket.includes(resourceId)) bucket.push(resourceId);
    resourcesByScheduleId.set(scheduleId, bucket);
  }

  return {
    professionalsByScheduleId,
    resourcesByScheduleId,
  };
}

async function loadScheduleRelationMaps({ tenantId, scheduleIds = [] }) {
  const targetIds = Array.from(new Set(ensureArray(scheduleIds).map((item) => safeStr(item)).filter(Boolean)));
  if (targetIds.length === 0) {
    return {
      professionalsByScheduleId: new Map(),
      resourcesByScheduleId: new Map(),
    };
  }

  const [scheduleProfessionalRows, scheduleResourceRows] = await Promise.all([
    FitnessScheduleProfessional().findAll({ where: { tenant_key: String(tenantId), class_schedule_id: targetIds } }),
    FitnessScheduleResource().findAll({ where: { tenant_key: String(tenantId), class_schedule_id: targetIds } }),
  ]);
  return buildScheduleRelationMaps(scheduleProfessionalRows, scheduleResourceRows);
}

function mapSchedule(row, relationContext = null) {
  const item = toJson(row);
  const explicitProfessionalIds = ensureArray(relationContext?.professionalsByScheduleId?.get(String(item.id)));
  const explicitResourceIds = ensureArray(relationContext?.resourcesByScheduleId?.get(String(item.id)));
  const legacyProfessionalIds = ensureArray(item.metadata?.professionalIds);
  const legacyResourceIds = ensureArray(item.metadata?.resourceIds);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    classId: item.class_id,
    startAt: item.start_at ? new Date(item.start_at).toISOString() : null,
    endAt: item.end_at ? new Date(item.end_at).toISOString() : null,
    capacity: Number(item.capacity || 0),
    location: item.location || null,
    status: item.status || 'scheduled',
    operationalScheduleId: item.operational_schedule_id || null,
    professionalIds: PREFER_EXPLICIT_RELATIONS
      ? (explicitProfessionalIds.length > 0 ? explicitProfessionalIds : legacyProfessionalIds)
      : Array.from(new Set([...explicitProfessionalIds, ...legacyProfessionalIds])),
    resourceIds: PREFER_EXPLICIT_RELATIONS
      ? (explicitResourceIds.length > 0 ? explicitResourceIds : legacyResourceIds)
      : Array.from(new Set([...explicitResourceIds, ...legacyResourceIds])),
    metadata: item.metadata || {},
  };
}

function mapMembership(row) {
  const item = toJson(row);
  const metadata = item.metadata || {};
  return {
    id: item.id,
    tenantId: item.tenant_key,
    memberId: item.member_id,
    planName: item.plan_name,
    startDate: item.start_date || null,
    endDate: item.end_date || null,
    allowedClasses: ensureArray(item.allowed_classes),
    allowedCategories: ensureArray(metadata.allowedCategories),
    allowedWeeklyFrequency: item.allowed_weekly_frequency == null ? null : Number(item.allowed_weekly_frequency),
    active: item.active !== false,
    metadata,
  };
}

function mapAttendance(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    classScheduleId: item.class_schedule_id,
    memberId: item.member_id,
    status: item.status || 'booked',
    checkinTime: item.checkin_time ? new Date(item.checkin_time).toISOString() : null,
    bookingTime: item.booking_time ? new Date(item.booking_time).toISOString() : null,
    metadata: item.metadata || {},
  };
}

function mapCheckin(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    memberId: item.member_id,
    classScheduleId: item.class_schedule_id || null,
    source: item.source || 'manual',
    kioskSessionId: item.kiosk_session_id || null,
    checkedInAt: item.checked_in_at ? new Date(item.checked_in_at).toISOString() : null,
    metadata: item.metadata || {},
  };
}

function mapGoal(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    memberId: item.member_id,
    goalType: item.goal_type,
    targetValue: item.target_value || null,
    active: item.active !== false,
    metadata: item.metadata || {},
  };
}

function normalizeResourceRequirement(value) {
  return {
    resourceId: safeStr(value?.resourceId || value?.resource_id),
    quantity: clampInt(value?.quantity, 1, 1),
    exclusiveUse: value?.exclusiveUse === true || value?.exclusive_use === true,
    metadata: value?.metadata && typeof value.metadata === 'object' ? value.metadata : {},
  };
}

async function listClasses({ tenantId, activeOnly = false }) {
  const where = { tenant_key: String(tenantId) };
  if (activeOnly) where.active = true;
  const rows = await FitnessClass().findAll({ where, order: [['active', 'DESC'], ['name', 'ASC']] });
  return { ok: true, items: rows.map(mapClass) };
}

async function saveClass({ tenantId, id = null, payload = {} }) {
  const name = safeStr(payload.name);
  if (!name) throw new Error('fitness_class_name_required');
  const Model = FitnessClass();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const normalized = {
    tenant_key: String(tenantId),
    name,
    instructor_id: safeStr(payload.instructorId || payload.instructor_id) || null,
    category: safeStr(payload.category) || null,
    operation_mode: safeStr(payload.operationMode || payload.operation_mode, 'group_class') || 'group_class',
    duration_minutes: clampInt(payload.durationMinutes || payload.duration_minutes, 60, 1),
    default_capacity: clampInt(payload.defaultCapacity || payload.default_capacity, 1, 1),
    active: payload.active !== false,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitcls'), ...normalized });
  return { ok: true, item: mapClass(row) };
}

async function listProfessionals({ tenantId, activeOnly = false }) {
  const where = { tenant_key: String(tenantId) };
  if (activeOnly) where.active = true;
  const rows = await FitnessProfessional().findAll({ where, order: [['active', 'DESC'], ['name', 'ASC']] });
  return { ok: true, items: rows.map(mapProfessional) };
}

async function saveProfessional({ tenantId, id = null, payload = {} }) {
  const name = safeStr(payload.name);
  if (!name) throw new Error('fitness_professional_name_required');
  const Model = FitnessProfessional();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const normalized = {
    tenant_key: String(tenantId),
    name,
    role_type: safeStr(payload.roleType || payload.role_type, 'instructor') || 'instructor',
    specialties: ensureArray(payload.specialties).map((item) => safeStr(item)).filter(Boolean),
    active: payload.active !== false,
    can_group_sessions: payload.canGroupSessions !== false,
    can_individual_sessions: payload.canIndividualSessions !== false,
    max_concurrent_sessions: clampInt(payload.maxConcurrentSessions || payload.max_concurrent_sessions, 1, 1),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitpro'), ...normalized });
  return { ok: true, item: mapProfessional(row) };
}

async function listResources({ tenantId, activeOnly = false }) {
  const where = { tenant_key: String(tenantId) };
  if (activeOnly) where.active = true;
  const rows = await FitnessResource().findAll({ where, order: [['active', 'DESC'], ['name', 'ASC']] });
  return { ok: true, items: rows.map(mapResource) };
}

async function saveResource({ tenantId, id = null, payload = {} }) {
  const name = safeStr(payload.name);
  if (!name) throw new Error('fitness_resource_name_required');
  const Model = FitnessResource();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const normalized = {
    tenant_key: String(tenantId),
    name,
    resource_type: safeStr(payload.resourceType || payload.resource_type, 'room') || 'room',
    capacity: clampInt(payload.capacity, 1, 1),
    location: safeStr(payload.location) || null,
    exclusive_use: payload.exclusiveUse === true || payload.exclusive_use === true,
    active: payload.active !== false,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitres'), ...normalized });
  return { ok: true, item: mapResource(row) };
}

async function listActivityProfessionals({ tenantId, activityId = null }) {
  const where = { tenant_key: String(tenantId) };
  if (activityId) where.activity_id = String(activityId);
  const rows = await FitnessActivityProfessional().findAll({ where, order: [['activity_id', 'ASC'], ['professional_id', 'ASC']] });
  return { ok: true, items: rows.map(mapActivityProfessional) };
}

async function saveActivityProfessional({ tenantId, activityId, professionalId, payload = {} }) {
  if (!activityId || !professionalId) throw new Error('fitness_activity_professional_ids_required');
  const Model = FitnessActivityProfessional();
  const existing = await Model.findOne({
    where: { tenant_key: String(tenantId), activity_id: String(activityId), professional_id: String(professionalId) },
  });
  const normalized = {
    tenant_key: String(tenantId),
    activity_id: String(activityId),
    professional_id: String(professionalId),
    duration_minutes: payload.durationMinutes == null ? null : clampInt(payload.durationMinutes, null, 1),
    default_price: payload.defaultPrice == null ? null : Number(payload.defaultPrice),
    max_capacity_override: payload.maxCapacityOverride == null ? null : clampInt(payload.maxCapacityOverride, null, 1),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitactpro'), ...normalized });
  return { ok: true, item: mapActivityProfessional(row) };
}

async function listActivityResources({ tenantId, activityId = null }) {
  const where = { tenant_key: String(tenantId) };
  if (activityId) where.activity_id = String(activityId);
  const rows = await FitnessActivityResource().findAll({ where, order: [['activity_id', 'ASC'], ['resource_id', 'ASC']] });
  return { ok: true, items: rows.map(mapActivityResource) };
}

async function saveActivityResource({ tenantId, activityId, resourceId, payload = {} }) {
  if (!activityId || !resourceId) throw new Error('fitness_activity_resource_ids_required');
  const Model = FitnessActivityResource();
  const existing = await Model.findOne({
    where: { tenant_key: String(tenantId), activity_id: String(activityId), resource_id: String(resourceId) },
  });
  const normalized = {
    tenant_key: String(tenantId),
    activity_id: String(activityId),
    resource_id: String(resourceId),
    required: payload.required !== false,
    quantity: clampInt(payload.quantity, 1, 1),
    exclusive_use: payload.exclusiveUse === true || payload.exclusive_use === true,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitactres'), ...normalized });
  return { ok: true, item: mapActivityResource(row) };
}

async function loadActivityRequirements({ tenantId, classId, requestedProfessionalIds = [], requestedResourceIds = [] }) {
  const [activityProfessionalsOut, activityResourcesOut] = await Promise.all([
    listActivityProfessionals({ tenantId, activityId: classId }),
    listActivityResources({ tenantId, activityId: classId }),
  ]);

  const effectiveProfessionalIds = Array.from(new Set([
    ...ensureArray(requestedProfessionalIds).map((item) => safeStr(item)).filter(Boolean),
    ...ensureArray(activityProfessionalsOut.items).map((item) => safeStr(item.professionalId)).filter(Boolean),
  ]));

  const explicitRequirements = ensureArray(requestedResourceIds).map((item) => normalizeResourceRequirement(item));
  const activityRequirements = ensureArray(activityResourcesOut.items)
    .filter((item) => item.required !== false)
    .map((item) => normalizeResourceRequirement(item));

  const effectiveResourceRequirements = Array.from(new Map(
    [...explicitRequirements, ...activityRequirements]
      .filter((item) => item.resourceId)
      .map((item) => [item.resourceId, item]),
  ).values());

  return {
    effectiveProfessionalIds,
    effectiveResourceRequirements,
  };
}

async function syncScheduleRelations({
  tenantId,
  classScheduleId,
  operationalScheduleId = null,
  professionalIds = [],
  resourceRequirements = [],
}) {
  await FitnessScheduleProfessional().destroy({
    where: { tenant_key: String(tenantId), class_schedule_id: String(classScheduleId) },
  });
  await FitnessScheduleResource().destroy({
    where: { tenant_key: String(tenantId), class_schedule_id: String(classScheduleId) },
  });

  const professionalRows = Array.from(new Set(ensureArray(professionalIds).map((item) => safeStr(item)).filter(Boolean)))
    .map((professionalId) => ({
      id: newId('fitschpro'),
      tenant_key: String(tenantId),
      class_schedule_id: String(classScheduleId),
      operational_schedule_id: operationalScheduleId ? String(operationalScheduleId) : null,
      professional_id: professionalId,
    }));
  if (professionalRows.length > 0) {
    await FitnessScheduleProfessional().bulkCreate(professionalRows);
  }

  const resourceRows = ensureArray(resourceRequirements)
    .map((item) => normalizeResourceRequirement(item))
    .filter((item) => item.resourceId)
    .map((item) => ({
      id: newId('fitschres'),
      tenant_key: String(tenantId),
      class_schedule_id: String(classScheduleId),
      operational_schedule_id: operationalScheduleId ? String(operationalScheduleId) : null,
      resource_id: item.resourceId,
      quantity: item.quantity,
      exclusive_use: item.exclusiveUse === true,
      metadata: item.metadata || {},
    }));
  if (resourceRows.length > 0) {
    await FitnessScheduleResource().bulkCreate(resourceRows);
  }
}

async function syncOperationalScheduleForFitness({
  tenantId,
  classScheduleId,
  classItem,
  payload,
  operationalScheduleId = null,
  professionalIds = [],
  resourceRequirements = [],
}) {
  const startAt = parseDate(payload.startAt || payload.start_at);
  const endAt = parseDate(payload.endAt || payload.end_at);
  const metadata = {
    ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
    verticalTemplate: 'fitness',
    fitnessClassId: classItem.id,
    fitnessClassScheduleId: String(classScheduleId),
    operationMode: classItem.operationMode || 'group_class',
    professionalIds: ensureArray(professionalIds),
    resourceIds: ensureArray(resourceRequirements).map((item) => item.resourceId),
    resourceRequirements: ensureArray(resourceRequirements).map((item) => ({
      resourceId: item.resourceId,
      quantity: item.quantity,
      exclusiveUse: item.exclusiveUse === true,
    })),
    location: safeStr(payload.location) || null,
  };

  const scheduleInput = {
    contextType: 'custom',
    contextId: `fitness:${classScheduleId}`,
    channel: 'internal',
    mode: 'free',
    origin: 'system',
    startAt: startAt ? startAt.toISOString() : payload.startAt,
    endAt: endAt ? endAt.toISOString() : payload.endAt,
    purpose: classItem.name,
    notes: safeStr(payload.location) ? `Fitness ${payload.location}` : null,
    status: 'scheduled',
    metadata,
  };

  if (operationalScheduleId) {
    const out = await schedulingService.rescheduleSchedule({
      tenantId,
      scheduleId: operationalScheduleId,
      input: scheduleInput,
      actor: {},
    });
    return out.schedule;
  }

  const out = await schedulingService.createSchedule({
    tenantId,
    input: scheduleInput,
    actor: {},
  });
  return out.schedule;
}

async function resolveScheduleAvailability({ tenantId, classId, startAt, endAt, professionalIds = [], resourceIds = [], currentScheduleId = null }) {
  const [requirements, classRow, existingRow] = await Promise.all([
    loadActivityRequirements({ tenantId, classId, requestedProfessionalIds: professionalIds, requestedResourceIds: resourceIds }),
    FitnessClass().findOne({ where: { tenant_key: String(tenantId), id: String(classId) } }),
    currentScheduleId
      ? FitnessClassSchedule().findOne({ where: { tenant_key: String(tenantId), id: String(currentScheduleId) } })
      : Promise.resolve(null),
  ]);
  const targetClass = classRow ? mapClass(classRow) : null;
  const operationalAvailability = await resolveOperationalAvailability({
    tenantId,
    startAt,
    endAt,
    excludeFitnessScheduleId: currentScheduleId ? String(currentScheduleId) : null,
    excludeOperationalScheduleId: existingRow?.operational_schedule_id || null,
    professionalIds: requirements.effectiveProfessionalIds,
    resourceRequirements: requirements.effectiveResourceRequirements,
  });
  return {
    ok: true,
    available: operationalAvailability.available,
    classItem: targetClass,
    effectiveProfessionalIds: requirements.effectiveProfessionalIds,
    effectiveResourceIds: requirements.effectiveResourceRequirements.map((item) => item.resourceId),
    effectiveResourceRequirements: requirements.effectiveResourceRequirements,
    professionalConflicts: operationalAvailability.professionalConflicts,
    resourceConflicts: operationalAvailability.resourceConflicts,
    operationalAvailability,
    reasons: operationalAvailability.reasons,
  };
}

async function listSchedules({ tenantId, classId = null, status = null }) {
  const where = { tenant_key: String(tenantId) };
  if (classId) where.class_id = String(classId);
  if (status) where.status = String(status);
  const rows = await FitnessClassSchedule().findAll({ where, order: [['start_at', 'ASC']] });
  const relationContext = await loadScheduleRelationMaps({
    tenantId,
    scheduleIds: rows.map((row) => toJson(row).id),
  });
  return { ok: true, items: rows.map((row) => mapSchedule(row, relationContext)) };
}

async function saveSchedule({ tenantId, id = null, payload = {} }) {
  const classId = safeStr(payload.classId || payload.class_id);
  const startAt = parseDate(payload.startAt || payload.start_at);
  const endAt = parseDate(payload.endAt || payload.end_at);
  if (!classId) throw new Error('fitness_schedule_class_required');
  if (!startAt || !endAt || endAt <= startAt) throw new Error('fitness_schedule_time_invalid');
  const classOut = await FitnessClass().findOne({ where: { tenant_key: String(tenantId), id: classId } });
  if (!classOut) throw new Error('fitness_class_not_found');
  const classItem = mapClass(classOut);
  const requestedProfessionalIds = ensureArray(payload.professionalIds || payload.professional_ids).map((item) => safeStr(item)).filter(Boolean);
  const requestedResourceIds = ensureArray(payload.resourceRequirements || payload.resource_requirements).length > 0
    ? ensureArray(payload.resourceRequirements || payload.resource_requirements)
    : ensureArray(payload.resourceIds || payload.resource_ids).map((item) => ({ resourceId: safeStr(item) })).filter((item) => item.resourceId);
  const availability = await resolveScheduleAvailability({
    tenantId,
    classId,
    startAt,
    endAt,
    professionalIds: requestedProfessionalIds,
    resourceIds: requestedResourceIds,
    currentScheduleId: id ? String(id) : null,
  });
  if (!availability.available) {
    throw new Error(availability.reasons[0] || 'fitness_schedule_unavailable');
  }
  const Model = FitnessClassSchedule();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const operationalSchedule = existing?.operational_schedule_id
    ? await syncOperationalScheduleForFitness({
      tenantId,
      classScheduleId: existing.id,
      classItem,
      payload,
      operationalScheduleId: existing.operational_schedule_id,
      professionalIds: availability.effectiveProfessionalIds,
      resourceRequirements: availability.effectiveResourceRequirements,
    })
    : null;
  const normalized = {
    tenant_key: String(tenantId),
    class_id: classId,
    start_at: startAt,
    end_at: endAt,
    capacity: clampInt(payload.capacity, classItem.defaultCapacity || 1, 1),
    location: safeStr(payload.location) || null,
    status: safeStr(payload.status, 'scheduled') || 'scheduled',
    operational_schedule_id: operationalSchedule?.id
      || existing?.operational_schedule_id
      || safeStr(payload.operationalScheduleId || payload.operational_schedule_id)
      || null,
    metadata: {
      ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
      professionalIds: availability.effectiveProfessionalIds,
      resourceIds: availability.effectiveResourceRequirements.map((item) => item.resourceId),
      resourceRequirements: availability.effectiveResourceRequirements.map((item) => ({
        resourceId: item.resourceId,
        quantity: item.quantity,
        exclusiveUse: item.exclusiveUse === true,
      })),
      operationMode: classItem.operationMode || 'group_class',
    },
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitsch'), ...normalized });
  const nextOperationalSchedule = normalized.operational_schedule_id
    ? operationalSchedule
    : await syncOperationalScheduleForFitness({
      tenantId,
      classScheduleId: row.id,
      classItem,
      payload,
      operationalScheduleId: row.operational_schedule_id,
      professionalIds: availability.effectiveProfessionalIds,
      resourceRequirements: availability.effectiveResourceRequirements,
    });
  if (!row.operational_schedule_id && nextOperationalSchedule?.id) {
    await row.update({ operational_schedule_id: String(nextOperationalSchedule.id) });
  }
  await syncScheduleRelations({
    tenantId,
    classScheduleId: row.id,
    operationalScheduleId: nextOperationalSchedule?.id || row.operational_schedule_id || null,
    professionalIds: availability.effectiveProfessionalIds,
    resourceRequirements: availability.effectiveResourceRequirements,
  });
  return {
    ok: true,
    item: mapSchedule(row, {
      professionalsByScheduleId: new Map([[String(row.id), availability.effectiveProfessionalIds]]),
      resourcesByScheduleId: new Map([[String(row.id), availability.effectiveResourceRequirements.map((item) => item.resourceId)]]),
    }),
  };
}

async function listMemberships({ tenantId, activeOnly = false }) {
  const where = { tenant_key: String(tenantId) };
  if (activeOnly) where.active = true;
  const rows = await FitnessMembership().findAll({ where, order: [['active', 'DESC'], ['updated_at', 'DESC']] });
  return { ok: true, items: rows.map(mapMembership) };
}

async function saveMembership({ tenantId, id = null, payload = {} }) {
  const memberId = safeStr(payload.memberId || payload.member_id);
  const planName = safeStr(payload.planName || payload.plan_name);
  const startDate = safeStr(payload.startDate || payload.start_date);
  if (!memberId) throw new Error('fitness_membership_member_required');
  if (!planName) throw new Error('fitness_membership_plan_required');
  if (!startDate) throw new Error('fitness_membership_start_required');
  const Model = FitnessMembership();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? { ...payload.metadata } : {};
  if (Array.isArray(payload.allowedCategories || payload.allowed_categories)) {
    metadata.allowedCategories = ensureArray(payload.allowedCategories || payload.allowed_categories)
      .map((item) => safeStr(item))
      .filter(Boolean);
  }
  const normalized = {
    tenant_key: String(tenantId),
    member_id: memberId,
    plan_name: planName,
    start_date: startDate,
    end_date: safeStr(payload.endDate || payload.end_date) || null,
    allowed_classes: ensureArray(payload.allowedClasses || payload.allowed_classes).map((item) => safeStr(item)).filter(Boolean),
    allowed_weekly_frequency: payload.allowedWeeklyFrequency == null ? null : clampInt(payload.allowedWeeklyFrequency || payload.allowed_weekly_frequency, null, 1),
    active: payload.active !== false,
    metadata,
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitmem'), ...normalized });
  return { ok: true, item: mapMembership(row) };
}

async function listAttendance({ tenantId, classScheduleId = null, memberId = null }) {
  const where = { tenant_key: String(tenantId) };
  if (classScheduleId) where.class_schedule_id = String(classScheduleId);
  if (memberId) where.member_id = String(memberId);
  const rows = await FitnessAttendance().findAll({ where, order: [['updated_at', 'DESC']] });
  return { ok: true, items: rows.map(mapAttendance) };
}

async function resolveBookingEligibility({ tenantId, classScheduleId, memberId, currentAttendanceId = null, requestedStatus = 'booked' }) {
  const normalizedStatus = safeStr(requestedStatus, 'booked').toLowerCase();
  const constrainedStatuses = new Set(['booked', 'checked_in', 'attended']);
  if (!constrainedStatuses.has(normalizedStatus)) {
    return { ok: true, eligible: true, reasons: [] };
  }

  const [scheduleRow, membershipRows, attendanceRows] = await Promise.all([
    FitnessClassSchedule().findOne({ where: { tenant_key: String(tenantId), id: String(classScheduleId) } }),
    FitnessMembership().findAll({ where: { tenant_key: String(tenantId), member_id: String(memberId), active: true }, order: [['updated_at', 'DESC']] }),
    FitnessAttendance().findAll({ where: { tenant_key: String(tenantId), class_schedule_id: String(classScheduleId) } }),
  ]);

  if (!scheduleRow) {
    throw new Error('fitness_schedule_not_found');
  }

  const relationContext = await loadScheduleRelationMaps({ tenantId, scheduleIds: [classScheduleId] });
  const schedule = mapSchedule(scheduleRow, relationContext);
  const memberships = membershipRows.map(mapMembership);
  const relevantMembership = memberships.find((item) => {
    const startDate = item.startDate ? new Date(`${item.startDate}T00:00:00.000Z`) : null;
    const endDate = item.endDate ? new Date(`${item.endDate}T23:59:59.999Z`) : null;
    const sessionStart = schedule.startAt ? new Date(schedule.startAt) : new Date();
    if (startDate && sessionStart < startDate) return false;
    if (endDate && sessionStart > endDate) return false;
    return true;
  }) || null;

  if (!relevantMembership) {
    return { ok: true, eligible: false, reasons: ['membership_missing'], schedule, membership: null };
  }

  if (Array.isArray(relevantMembership.allowedClasses) && relevantMembership.allowedClasses.length > 0 && !relevantMembership.allowedClasses.includes(schedule.classId)) {
    return { ok: true, eligible: false, reasons: ['membership_class_not_allowed'], schedule, membership: relevantMembership };
  }
  const classRow = await FitnessClass().findOne({ where: { tenant_key: String(tenantId), id: String(schedule.classId) } });
  const classItem = classRow ? mapClass(classRow) : null;
  if (classItem && Array.isArray(relevantMembership.allowedCategories) && relevantMembership.allowedCategories.length > 0) {
    if (!relevantMembership.allowedCategories.includes(String(classItem.category || ''))) {
      return { ok: true, eligible: false, reasons: ['membership_category_not_allowed'], schedule, membership: relevantMembership, classItem };
    }
  }

  const activeAttendances = attendanceRows
    .map(mapAttendance)
    .filter((item) => item.id !== currentAttendanceId && constrainedStatuses.has(String(item.status || '').toLowerCase()));
  if (activeAttendances.length >= Number(schedule.capacity || 0)) {
    return { ok: true, eligible: false, reasons: ['schedule_full'], schedule, membership: relevantMembership };
  }

  const weeklyLimit = Number(relevantMembership.allowedWeeklyFrequency || 0);
  if (weeklyLimit > 0) {
    const sessionStart = schedule.startAt ? new Date(schedule.startAt) : new Date();
    const weekStart = startOfIsoWeek(sessionStart);
    const weekEnd = endOfIsoWeek(sessionStart);
    const weeklyAttendances = await FitnessAttendance().findAll({
      where: { tenant_key: String(tenantId), member_id: String(memberId) },
      order: [['booking_time', 'DESC']],
    });
    const countThisWeek = weeklyAttendances
      .map(mapAttendance)
      .filter((item) => item.id !== currentAttendanceId)
      .filter((item) => constrainedStatuses.has(String(item.status || '').toLowerCase()))
      .filter((item) => {
        const stamp = item.bookingTime || item.checkinTime;
        if (!stamp) return false;
        const date = new Date(stamp);
        return date >= weekStart && date <= weekEnd;
      })
      .length;
    if (countThisWeek >= weeklyLimit) {
      return { ok: true, eligible: false, reasons: ['membership_weekly_limit_reached'], schedule, membership: relevantMembership };
    }
  }

  return { ok: true, eligible: true, reasons: [], schedule, membership: relevantMembership };
}

async function saveAttendance({ tenantId, classScheduleId, memberId, payload = {} }) {
  if (!classScheduleId || !memberId) throw new Error('fitness_attendance_ids_required');
  const Model = FitnessAttendance();
  const existing = await Model.findOne({
    where: { tenant_key: String(tenantId), class_schedule_id: String(classScheduleId), member_id: String(memberId) },
  });
  const status = safeStr(payload.status, existing?.status || 'booked') || 'booked';
  const eligibility = await resolveBookingEligibility({
    tenantId,
    classScheduleId,
    memberId,
    currentAttendanceId: existing?.id || null,
    requestedStatus: status,
  });
  if (!eligibility.eligible) {
    if ((eligibility.reasons || []).includes('schedule_full') && payload.autoJoinWaitingList === true) {
      const classRow = await FitnessClass().findOne({ where: { tenant_key: String(tenantId), id: String(eligibility.schedule?.classId || '') } });
      const classItem = classRow ? mapClass(classRow) : null;
      const waitingListOut = await waitingListService.addWaitingEntry({
        tenantId,
        contactId: String(memberId),
        contextType: 'fitness_class',
        contextId: String(classScheduleId),
        desiredChannel: 'whatsapp',
        serviceType: classItem?.name || eligibility.schedule?.classId || null,
        preferredWeekdays: [],
        preferredTimeWindows: [],
        priority: 60,
        metadata: {
          source: 'fitness_auto_waiting_list',
          classId: eligibility.schedule?.classId || null,
          classScheduleId: String(classScheduleId),
          reason: 'schedule_full',
        },
      });
      return {
        ok: true,
        waitlisted: true,
        reason: 'schedule_full',
        waitingListItem: waitingListOut.item,
      };
    }
    const primaryReason = eligibility.reasons[0] || 'fitness_booking_not_allowed';
    throw new Error(primaryReason);
  }
  const normalized = {
    tenant_key: String(tenantId),
    class_schedule_id: String(classScheduleId),
    member_id: String(memberId),
    status,
    checkin_time: parseDate(payload.checkinTime || payload.checkin_time) || existing?.checkin_time || null,
    booking_time: parseDate(payload.bookingTime || payload.booking_time) || existing?.booking_time || new Date(),
    metadata: {
      ...(existing?.metadata || {}),
      ...(payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {}),
      bookingValidation: {
        reasons: eligibility.reasons,
        membershipId: eligibility.membership?.id || null,
        scheduleId: eligibility.schedule?.id || null,
      },
    },
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitatt'), ...normalized });
  return { ok: true, item: mapAttendance(row) };
}

async function listGoals({ tenantId, memberId = null, activeOnly = false }) {
  const where = { tenant_key: String(tenantId) };
  if (memberId) where.member_id = String(memberId);
  if (activeOnly) where.active = true;
  const rows = await FitnessMemberGoal().findAll({ where, order: [['updated_at', 'DESC']] });
  return { ok: true, items: rows.map(mapGoal) };
}

async function saveGoal({ tenantId, id = null, payload = {} }) {
  const memberId = safeStr(payload.memberId || payload.member_id);
  const goalType = safeStr(payload.goalType || payload.goal_type);
  if (!memberId) throw new Error('fitness_goal_member_required');
  if (!goalType) throw new Error('fitness_goal_type_required');
  const Model = FitnessMemberGoal();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const normalized = {
    tenant_key: String(tenantId),
    member_id: memberId,
    goal_type: goalType,
    target_value: safeStr(payload.targetValue || payload.target_value) || null,
    active: payload.active !== false,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('fitgoal'), ...normalized });
  return { ok: true, item: mapGoal(row) };
}

async function recordCheckin({ tenantId, memberId, classScheduleId = null, source = 'manual', kioskCode = 'default', payload = {} }) {
  if (!memberId) throw new Error('fitness_checkin_member_required');
  let kioskOut = null;
  if (String(source) === 'kiosk') {
    kioskOut = await kioskService.checkin({
      tenantId,
      kioskCode,
      contactId: memberId,
      reason: payload.reason || 'fitness_checkin',
      contextPayload: {
        fitness: true,
        classScheduleId: classScheduleId || null,
      },
    });
  }

  if (classScheduleId) {
    await saveAttendance({
      tenantId,
      classScheduleId,
      memberId,
      payload: {
        status: 'checked_in',
        checkinTime: payload.checkedInAt || new Date(),
        bookingTime: payload.bookingTime || new Date(),
        metadata: { source: String(source) },
      },
    });
  }

  const row = await FitnessCheckin().create({
    id: newId('fitcheck'),
    tenant_key: String(tenantId),
    member_id: String(memberId),
    class_schedule_id: classScheduleId ? String(classScheduleId) : null,
    source: String(source || 'manual'),
    kiosk_session_id: kioskOut?.session?.id || null,
    checked_in_at: parseDate(payload.checkedInAt) || new Date(),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  });
  return {
    ok: true,
    item: mapCheckin(row),
    kioskSession: kioskOut?.session || null,
    queueTicket: kioskOut?.queueTicket || null,
  };
}

async function listCheckins({ tenantId, memberId = null }) {
  const where = { tenant_key: String(tenantId) };
  if (memberId) where.member_id = String(memberId);
  const rows = await FitnessCheckin().findAll({ where, order: [['checked_in_at', 'DESC']] });
  return { ok: true, items: rows.map(mapCheckin) };
}

async function listRetentionCandidates({ tenantId }) {
  const preset = getPreset('fitness');
  const inactivityWindowDays = Number(preset?.retentionThreshold || preset?.inactivityWindowDays || 14);
  const thresholdMs = inactivityWindowDays * 24 * 60 * 60 * 1000;
  const [attendanceRows, membershipRows, contactRows] = await Promise.all([
    FitnessAttendance().findAll({ where: { tenant_key: String(tenantId) }, order: [['checkin_time', 'DESC']] }),
    FitnessMembership().findAll({ where: { tenant_key: String(tenantId), active: true }, order: [['updated_at', 'DESC']] }),
    CrmContact().findAll({ where: { tenant_key: String(tenantId), status: 'active' }, order: [['updated_at', 'DESC']], limit: 200 }),
  ]);
  const latestAttendanceByMember = new Map();
  for (const row of attendanceRows.map(mapAttendance)) {
    if (!row.memberId || latestAttendanceByMember.has(row.memberId) || !row.checkinTime) continue;
    latestAttendanceByMember.set(row.memberId, row);
  }
  const contactsById = new Map(contactRows.map((row) => {
    const item = toJson(row);
    return [String(item.id), item];
  }));
  const now = Date.now();
  const items = membershipRows.map(mapMembership)
    .map((membership) => {
      const latest = latestAttendanceByMember.get(membership.memberId) || null;
      const lastPresenceMs = latest?.checkinTime ? new Date(latest.checkinTime).getTime() : 0;
      return {
        ...membership,
        lastAttendanceAt: latest?.checkinTime || null,
        inactiveDays: lastPresenceMs ? Math.floor((now - lastPresenceMs) / (24 * 60 * 60 * 1000)) : null,
        contact: contactsById.get(String(membership.memberId)) || null,
      };
    })
    .filter((item) => item.inactiveDays == null || (now - new Date(item.lastAttendanceAt || 0).getTime()) >= thresholdMs)
    .sort((a, b) => Number(b.inactiveDays || 9999) - Number(a.inactiveDays || 9999))
    .slice(0, 20);
  return { ok: true, items };
}

async function listUpsellCandidates({ tenantId }) {
  const [membershipOut, attendanceOut] = await Promise.all([
    listMemberships({ tenantId, activeOnly: true }),
    listAttendance({ tenantId }),
  ]);
  const attendanceByMember = new Map();
  for (const item of attendanceOut.items || []) {
    const current = attendanceByMember.get(item.memberId) || 0;
    if (['booked', 'checked_in', 'attended'].includes(String(item.status || '').toLowerCase())) {
      attendanceByMember.set(item.memberId, current + 1);
    }
  }
  return {
    ok: true,
    items: (membershipOut.items || [])
      .filter((item) => Number(item.allowedWeeklyFrequency || 0) > 0)
      .map((item) => ({
        ...item,
        bookedCount: Number(attendanceByMember.get(item.memberId) || 0),
      }))
      .filter((item) => item.bookedCount >= Math.max(1, Number(item.allowedWeeklyFrequency || 0) - 1))
      .slice(0, 20),
  };
}

async function getDashboard({ tenantId }) {
  const [classesOut, schedulesOut, membershipsOut, attendanceOut, goalsOut, checkinsOut, waitingRows, operationalRows, retentionOut, upsellOut, professionalsOut, resourcesOut, activityProfessionalsOut, activityResourcesOut, predictiveOut, scheduleProfessionalRows, scheduleResourceRows] = await Promise.all([
    listClasses({ tenantId, activeOnly: false }),
    listSchedules({ tenantId }),
    listMemberships({ tenantId, activeOnly: false }),
    listAttendance({ tenantId }),
    listGoals({ tenantId, activeOnly: false }),
    listCheckins({ tenantId }),
    AutonomousWaitingList().findAll({ where: { tenant_key: String(tenantId), active: true }, order: [['updated_at', 'DESC']], limit: 100 }),
    OperationalSchedule().findAll({ where: { tenant_key: String(tenantId) }, order: [['start_at', 'DESC']], limit: 100 }),
    listRetentionCandidates({ tenantId }),
    listUpsellCandidates({ tenantId }),
    listProfessionals({ tenantId, activeOnly: false }),
    listResources({ tenantId, activeOnly: false }),
    listActivityProfessionals({ tenantId }),
    listActivityResources({ tenantId }),
    getInsights({ tenantId, verticalTemplate: 'fitness', serviceType: 'fitness_session' }).catch(() => ({ ok: false })),
    FitnessScheduleProfessional().findAll({ where: { tenant_key: String(tenantId) } }),
    FitnessScheduleResource().findAll({ where: { tenant_key: String(tenantId) } }),
  ]);

  const classes = classesOut.items || [];
  const classIds = new Set(classes.map((item) => item.id));
  const classNames = new Set(classes.map((item) => safeStr(item.name).toLowerCase()).filter(Boolean));
  const attendance = attendanceOut.items || [];
  const attendanceBySchedule = new Map();
  for (const item of attendance) {
    const bucket = attendanceBySchedule.get(item.classScheduleId) || [];
    bucket.push(item);
    attendanceBySchedule.set(item.classScheduleId, bucket);
  }

  const relationContext = buildScheduleRelationMaps(scheduleProfessionalRows, scheduleResourceRows);

  const schedules = (schedulesOut.items || []).map((item) => {
    const attendees = attendanceBySchedule.get(item.id) || [];
    return {
      ...item,
      professionalIds: ensureArray(relationContext.professionalsByScheduleId.get(item.id)).length > 0
        ? relationContext.professionalsByScheduleId.get(item.id)
        : ensureArray(item.professionalIds),
      resourceIds: ensureArray(relationContext.resourcesByScheduleId.get(item.id)).length > 0
        ? relationContext.resourcesByScheduleId.get(item.id)
        : ensureArray(item.resourceIds),
      bookedCount: attendees.filter((entry) => ['booked', 'checked_in', 'attended'].includes(entry.status)).length,
      checkedInCount: attendees.filter((entry) => ['checked_in', 'attended'].includes(entry.status)).length,
      remainingCapacity: Math.max(0, Number(item.capacity || 0) - attendees.filter((entry) => ['booked', 'checked_in', 'attended'].includes(entry.status)).length),
    };
  });

  const waitingList = waitingRows.map((row) => toJson(row)).filter((item) => {
    const serviceType = safeStr(item.service_type).toLowerCase();
    return classIds.has(item.context_id) || classIds.has(item.service_type) || classNames.has(serviceType) || String(item.context_type || '').toLowerCase() === 'fitness_class';
  });
  const operationalScheduleIds = new Set(schedules.map((item) => safeStr(item.operationalScheduleId)).filter(Boolean));
  const recentSchedules = operationalRows.map((row) => toJson(row)).filter((item) => {
    const metadata = item.metadata || {};
    const vertical = safeStr(metadata.verticalTemplate).toLowerCase();
    const classId = safeStr(metadata.fitnessClassId || metadata.classId);
    const purpose = safeStr(item.purpose).toLowerCase();
    return operationalScheduleIds.has(String(item.id)) || vertical === 'fitness' || classIds.has(classId) || classNames.has(purpose);
  }).slice(0, 12);
  const schedulesByProfessional = (professionalsOut.items || []).map((professional) => ({
    professional,
    schedules: schedules.filter((item) => ensureArray(item.professionalIds).includes(professional.id)),
  }));
  const schedulesByResource = (resourcesOut.items || []).map((resource) => ({
    resource,
    schedules: schedules.filter((item) => ensureArray(item.resourceIds).includes(resource.id)),
  }));
  const idleResources = schedulesByResource
    .filter((entry) => (entry.schedules || []).length === 0)
    .map((entry) => entry.resource);
  const operationalConflicts = schedules
    .filter((item) => Number(item.remainingCapacity || 0) === 0)
    .map((item) => ({
      scheduleId: item.id,
      classId: item.classId,
      reason: 'capacity_full',
      resourceIds: item.resourceIds,
      professionalIds: item.professionalIds,
    }));

  return {
    ok: true,
    summary: {
      classesTotal: classes.length,
      classesActive: classes.filter((item) => item.active).length,
      schedulesTotal: schedules.length,
      membershipsActive: (membershipsOut.items || []).filter((item) => item.active).length,
      attendanceTotal: attendance.length,
      checkinsTotal: (checkinsOut.items || []).length,
      waitingListFitness: waitingList.length,
      retentionCandidates: (retentionOut.items || []).length,
      idleResources: idleResources.length,
      upsellCandidates: (upsellOut.items || []).length,
    },
    classes,
    schedules,
    memberships: membershipsOut.items || [],
    attendance,
    goals: goalsOut.items || [],
    checkins: checkinsOut.items || [],
    waitingList,
    recentSchedules,
    retentionCandidates: retentionOut.items || [],
    upsellCandidates: upsellOut.items || [],
    professionals: professionalsOut.items || [],
    resources: resourcesOut.items || [],
    activityProfessionals: activityProfessionalsOut.items || [],
    activityResources: activityResourcesOut.items || [],
    schedulesByProfessional,
    schedulesByResource,
    idleResources,
    operationalConflicts,
    predictiveInsights: predictiveOut.ok ? predictiveOut.insights : null,
  };
}

module.exports = {
  listClasses,
  saveClass,
  listProfessionals,
  saveProfessional,
  listResources,
  saveResource,
  listActivityProfessionals,
  saveActivityProfessional,
  listActivityResources,
  saveActivityResource,
  resolveScheduleAvailability,
  listSchedules,
  saveSchedule,
  listMemberships,
  saveMembership,
  listAttendance,
  resolveBookingEligibility,
  saveAttendance,
  listGoals,
  saveGoal,
  listCheckins,
  recordCheckin,
  listRetentionCandidates,
  listUpsellCandidates,
  getDashboard,
};
