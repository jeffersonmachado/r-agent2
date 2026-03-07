'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  BeautyProfessional,
  BeautyService,
  BeautyServiceProfessional,
  BeautyServiceComposition,
  BeautyLoyalty,
  BeautyClientPreference,
  BeautyScheduleProfessional,
  BeautyScheduleService,
  CrmContact,
  OperationalSchedule,
  AutonomousWaitingList,
} = require('../db/models');
const { getPreset } = require('../core/autonomous-scheduling/VerticalTemplateRegistry');
const { getInsights } = require('../core/autonomous-scheduling/PredictiveInsightsService');
const schedulingService = require('./schedulingService');
const { resolveOperationalAvailability } = require('./operationalAvailabilityService');
const { appendEventV1 } = require('./eventLedgerService');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(value, fallback = '') {
  const normalized = value == null ? fallback : String(value).trim();
  return normalized;
}

function clampInt(value, fallback = 0, min = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.trunc(parsed));
}

function clampMoney(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Number(parsed.toFixed(2));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function toJson(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function mapProfessional(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    name: item.name,
    specialty: item.specialty || '',
    specialties: ensureArray(item.specialties || item.metadata?.specialties),
    maxDailySessions: item.max_daily_sessions == null ? null : Number(item.max_daily_sessions),
    workingHours: item.working_hours || item.metadata?.workingHours || {},
    scheduleRef: item.schedule_ref || null,
    active: item.active !== false,
    metadata: item.metadata || {},
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null,
  };
}

function mapService(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    name: item.name,
    category: item.category || '',
    defaultDuration: Number(item.default_duration || 0),
    defaultPrice: Number(item.default_price || 0),
    active: item.active !== false,
    metadata: item.metadata || {},
    createdAt: item.created_at || item.createdAt || null,
    updatedAt: item.updated_at || item.updatedAt || null,
  };
}

function mapAssignment(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    serviceId: item.service_id,
    professionalId: item.professional_id,
    durationMinutes: item.duration_minutes == null ? null : Number(item.duration_minutes),
    priceAmount: item.price_amount == null ? null : Number(item.price_amount),
    active: item.active !== false,
    metadata: item.metadata || {},
  };
}

function mapComposition(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    parentServiceId: item.parent_service_id,
    childServiceId: item.child_service_id,
    sequence: Number(item.sequence || 1),
    optional: item.optional === true,
  };
}

function mapLoyalty(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    contactId: item.contact_id,
    visits: Number(item.visits || 0),
    points: Number(item.points || 0),
    lastVisitAt: item.last_visit_at ? new Date(item.last_visit_at).toISOString() : null,
    segment: item.segment || null,
    metadata: item.metadata || {},
  };
}

function mapPreference(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    contactId: item.contact_id,
    preferredProfessionalId: item.preferred_professional_id || null,
    preferredServices: ensureArray(item.preferred_services),
    preferredDays: ensureArray(item.preferred_days),
    preferredTimeRanges: ensureArray(item.preferred_time_ranges),
  };
}

function mapScheduleProfessional(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    operationalScheduleId: item.operational_schedule_id,
    beautyProfessionalId: item.beauty_professional_id,
  };
}

function mapScheduleService(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    operationalScheduleId: item.operational_schedule_id,
    beautyServiceId: item.beauty_service_id,
  };
}

async function listProfessionals({ tenantId, activeOnly = false }) {
  const where = { tenant_key: String(tenantId) };
  if (activeOnly) where.active = true;
  const rows = await BeautyProfessional().findAll({
    where,
    order: [['active', 'DESC'], ['name', 'ASC']],
  });
  return { ok: true, items: rows.map(mapProfessional) };
}

async function saveProfessional({ tenantId, id = null, payload = {} }) {
  const name = safeStr(payload.name);
  if (!name) throw new Error('beauty_professional_name_required');
  const Model = BeautyProfessional();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const normalized = {
    tenant_key: String(tenantId),
    name,
    specialty: safeStr(payload.specialty) || null,
    specialties: ensureArray(payload.specialties).map((item) => safeStr(item)).filter(Boolean),
    max_daily_sessions: payload.maxDailySessions == null ? null : clampInt(payload.maxDailySessions, null, 1),
    working_hours: payload.workingHours && typeof payload.workingHours === 'object' ? payload.workingHours : {},
    schedule_ref: safeStr(payload.scheduleRef || payload.schedule_ref) || null,
    active: payload.active !== false,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('beautypro'), ...normalized });
  return { ok: true, item: mapProfessional(row) };
}

async function listServices({ tenantId, activeOnly = false, includeAssignments = false, includeCompositions = false }) {
  const where = { tenant_key: String(tenantId) };
  if (activeOnly) where.active = true;
  const rows = await BeautyService().findAll({
    where,
    order: [['active', 'DESC'], ['name', 'ASC']],
  });
  const items = rows.map(mapService);
  if (!includeAssignments && !includeCompositions) return { ok: true, items };

  const [assignmentsOut, compositionsOut] = await Promise.all([
    includeAssignments ? listAssignments({ tenantId, activeOnly: false }) : Promise.resolve({ items: [] }),
    includeCompositions ? listCompositions({ tenantId }) : Promise.resolve({ items: [] }),
  ]);

  const assignmentsByService = new Map();
  for (const item of assignmentsOut.items || []) {
    const bucket = assignmentsByService.get(item.serviceId) || [];
    bucket.push(item);
    assignmentsByService.set(item.serviceId, bucket);
  }
  const compositionsByParent = new Map();
  for (const item of compositionsOut.items || []) {
    const bucket = compositionsByParent.get(item.parentServiceId) || [];
    bucket.push(item);
    compositionsByParent.set(item.parentServiceId, bucket);
  }
  return {
    ok: true,
    items: items.map((item) => ({
      ...item,
      assignments: assignmentsByService.get(item.id) || [],
      composition: compositionsByParent.get(item.id) || [],
    })),
  };
}

async function saveService({ tenantId, id = null, payload = {} }) {
  const name = safeStr(payload.name);
  if (!name) throw new Error('beauty_service_name_required');
  const Model = BeautyService();
  const existing = id ? await Model.findOne({ where: { tenant_key: String(tenantId), id: String(id) } }) : null;
  const normalized = {
    tenant_key: String(tenantId),
    name,
    category: safeStr(payload.category) || null,
    default_duration: clampInt(payload.defaultDuration || payload.default_duration, 30, 1),
    default_price: clampMoney(payload.defaultPrice || payload.default_price, 0),
    active: payload.active !== false,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('beautysvc'), ...normalized });
  return { ok: true, item: mapService(row) };
}

async function listAssignments({ tenantId, serviceId = null, professionalId = null, activeOnly = false }) {
  const where = { tenant_key: String(tenantId) };
  if (serviceId) where.service_id = String(serviceId);
  if (professionalId) where.professional_id = String(professionalId);
  if (activeOnly) where.active = true;
  const rows = await BeautyServiceProfessional().findAll({
    where,
    order: [['professional_id', 'ASC'], ['service_id', 'ASC']],
  });
  return { ok: true, items: rows.map(mapAssignment) };
}

async function saveAssignment({ tenantId, serviceId, professionalId, payload = {} }) {
  if (!serviceId || !professionalId) throw new Error('beauty_assignment_ids_required');
  const Model = BeautyServiceProfessional();
  const existing = await Model.findOne({
    where: {
      tenant_key: String(tenantId),
      service_id: String(serviceId),
      professional_id: String(professionalId),
    },
  });
  const normalized = {
    tenant_key: String(tenantId),
    service_id: String(serviceId),
    professional_id: String(professionalId),
    duration_minutes: payload.durationMinutes == null ? null : clampInt(payload.durationMinutes, null, 1),
    price_amount: payload.priceAmount == null ? null : clampMoney(payload.priceAmount, 0),
    active: payload.active !== false,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('beautyassign'), ...normalized });
  return { ok: true, item: mapAssignment(row) };
}

async function listCompositions({ tenantId, parentServiceId = null }) {
  const where = { tenant_key: String(tenantId) };
  if (parentServiceId) where.parent_service_id = String(parentServiceId);
  const rows = await BeautyServiceComposition().findAll({
    where,
    order: [['parent_service_id', 'ASC'], ['sequence', 'ASC']],
  });
  return { ok: true, items: rows.map(mapComposition) };
}

async function replaceCompositions({ tenantId, parentServiceId, items = [] }) {
  if (!parentServiceId) throw new Error('beauty_parent_service_required');
  const Model = BeautyServiceComposition();
  await Model.destroy({
    where: { tenant_key: String(tenantId), parent_service_id: String(parentServiceId) },
  });
  const normalized = ensureArray(items)
    .map((item, index) => ({
      id: newId('beautycmp'),
      tenant_key: String(tenantId),
      parent_service_id: String(parentServiceId),
      child_service_id: safeStr(item.childServiceId || item.child_service_id),
      sequence: clampInt(item.sequence, index + 1, 1),
      optional: item.optional === true,
    }))
    .filter((item) => item.child_service_id);
  if (normalized.length > 0) {
    await Model.bulkCreate(normalized);
  }
  return listCompositions({ tenantId, parentServiceId });
}

async function upsertLoyalty({ tenantId, contactId, payload = {} }) {
  if (!contactId) throw new Error('beauty_contact_id_required');
  const Model = BeautyLoyalty();
  const existing = await Model.findOne({ where: { tenant_key: String(tenantId), contact_id: String(contactId) } });
  const normalized = {
    tenant_key: String(tenantId),
    contact_id: String(contactId),
    visits: clampInt(payload.visits, existing ? Number(existing.visits || 0) : 0, 0),
    points: clampInt(payload.points, existing ? Number(existing.points || 0) : 0, 0),
    last_visit_at: parseDate(payload.lastVisitAt || payload.last_visit_at),
    segment: safeStr(payload.segment) || null,
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('beautyloy'), ...normalized });
  return { ok: true, item: mapLoyalty(row) };
}

async function upsertPreference({ tenantId, contactId, payload = {} }) {
  if (!contactId) throw new Error('beauty_contact_id_required');
  const Model = BeautyClientPreference();
  const existing = await Model.findOne({ where: { tenant_key: String(tenantId), contact_id: String(contactId) } });
  const normalized = {
    tenant_key: String(tenantId),
    contact_id: String(contactId),
    preferred_professional_id: safeStr(payload.preferredProfessionalId || payload.preferred_professional_id) || null,
    preferred_services: ensureArray(payload.preferredServices || payload.preferred_services).map((item) => safeStr(item)).filter(Boolean),
    preferred_days: ensureArray(payload.preferredDays || payload.preferred_days).map((item) => clampInt(item, null, 0)).filter((item) => item != null),
    preferred_time_ranges: ensureArray(payload.preferredTimeRanges || payload.preferred_time_ranges).filter((item) => item && typeof item === 'object'),
  };
  const row = existing
    ? await existing.update(normalized)
    : await Model.create({ id: newId('beautypref'), ...normalized });
  return { ok: true, item: mapPreference(row) };
}

function buildServiceLookups(services, assignments, compositions) {
  const servicesById = new Map(services.map((item) => [item.id, item]));
  const assignmentsByKey = new Map(assignments.map((item) => [`${item.serviceId}:${item.professionalId}`, item]));
  const childrenByParent = new Map();
  for (const item of compositions) {
    const bucket = childrenByParent.get(item.parentServiceId) || [];
    bucket.push(item);
    childrenByParent.set(item.parentServiceId, bucket);
  }
  return { servicesById, assignmentsByKey, childrenByParent };
}

function resolveSingleService({ serviceId, professionalId, lookups, seen = new Set() }) {
  const service = lookups.servicesById.get(serviceId);
  if (!service || seen.has(serviceId)) return [];
  const nextSeen = new Set(seen);
  nextSeen.add(serviceId);
  const composition = (lookups.childrenByParent.get(serviceId) || []).sort((a, b) => a.sequence - b.sequence);
  if (composition.length === 0) return [service];
  return composition.flatMap((item) => resolveSingleService({
    serviceId: item.childServiceId,
    professionalId,
    lookups,
    seen: nextSeen,
  }));
}

async function resolveBundle({ tenantId, serviceIds = [], professionalId = null }) {
  const [servicesOut, assignmentsOut, compositionsOut] = await Promise.all([
    listServices({ tenantId, activeOnly: false }),
    listAssignments({ tenantId, professionalId, activeOnly: false }),
    listCompositions({ tenantId }),
  ]);
  const lookups = buildServiceLookups(servicesOut.items || [], assignmentsOut.items || [], compositionsOut.items || []);
  const resolvedServices = ensureArray(serviceIds)
    .map((item) => safeStr(item))
    .filter(Boolean)
    .flatMap((serviceId) => resolveSingleService({ serviceId, professionalId, lookups }));

  const lineItems = resolvedServices.map((service) => {
    const assignment = professionalId ? lookups.assignmentsByKey.get(`${service.id}:${professionalId}`) || null : null;
    return {
      serviceId: service.id,
      serviceName: service.name,
      durationMinutes: assignment?.durationMinutes ?? service.defaultDuration,
      priceAmount: assignment?.priceAmount ?? service.defaultPrice,
      category: service.category || null,
    };
  });

  return {
    ok: true,
    bundle: {
      professionalId: professionalId || null,
      items: lineItems,
      totalDurationMinutes: lineItems.reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0),
      totalPriceAmount: Number(lineItems.reduce((sum, item) => sum + Number(item.priceAmount || 0), 0).toFixed(2)),
    },
  };
}

async function listReactivationCandidates({ tenantId, skipSync = false }) {
  if (!skipSync) {
    await syncLoyaltyFromSchedules({ tenantId });
  }
  const [loyaltyRows, contactRows] = await Promise.all([
    BeautyLoyalty().findAll({ where: { tenant_key: String(tenantId) }, order: [['last_visit_at', 'ASC']] }),
    CrmContact().findAll({ where: { tenant_key: String(tenantId), status: 'active' }, order: [['updated_at', 'DESC']], limit: 100 }),
  ]);
  const preset = getPreset('beauty');
  const windowDays = Number(preset?.revenueDefaults?.reactivationWindowDays || 45);
  const thresholdMs = windowDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const contactsById = new Map(contactRows.map((row) => {
    const item = toJson(row);
    return [String(item.id), item];
  }));
  const items = loyaltyRows.map(mapLoyalty)
    .filter((item) => item.lastVisitAt && (nowMs - new Date(item.lastVisitAt).getTime()) >= thresholdMs)
    .map((item) => ({
      ...item,
      contact: contactsById.get(String(item.contactId)) || null,
      inactiveDays: Math.floor((nowMs - new Date(item.lastVisitAt).getTime()) / (24 * 60 * 60 * 1000)),
    }))
    .sort((a, b) => b.inactiveDays - a.inactiveDays)
    .slice(0, 20);
  return { ok: true, items };
}

function overlapsRange(startAt, endAt, slotStart, slotEnd) {
  return startAt < slotEnd && endAt > slotStart;
}

function buildLegacyBeautyContext({ schedule, professionalMap = new Map(), serviceMap = new Map(), serviceIds = new Set(), serviceNames = new Set() }) {
  const metadata = schedule.metadata || {};
  const targetProfessionalIds = Array.from(new Set(
    ensureArray(metadata.beautyProfessionalIds)
      .concat(metadata.beautyProfessionalId ? [metadata.beautyProfessionalId] : [])
      .concat(metadata.professionalId ? [metadata.professionalId] : [])
      .map((item) => safeStr(item))
      .filter(Boolean),
  ));
  const scheduleRef = safeStr(metadata.scheduleRef);
  const bundleItems = ensureArray(metadata.bundle?.items);
  const beautyServiceIds = Array.from(new Set(
    bundleItems.map((item) => safeStr(item.serviceId)).filter(Boolean)
      .concat(metadata.beautyServiceId ? [metadata.beautyServiceId] : [])
      .concat(metadata.serviceId ? [metadata.serviceId] : []),
  ));
  const vertical = safeStr(metadata.verticalTemplate).toLowerCase();
  const purpose = safeStr(schedule.purpose).toLowerCase();
  const inferredServiceIds = vertical === 'beauty'
    ? beautyServiceIds.length > 0
      ? beautyServiceIds
      : Array.from(serviceIds).filter((serviceId) => {
        const service = serviceMap.get(String(serviceId));
        return service && safeStr(service.name).toLowerCase() === purpose;
      })
    : beautyServiceIds;

  const professionals = targetProfessionalIds
    .map((id) => professionalMap.get(String(id)) || null)
    .filter(Boolean);
  const services = inferredServiceIds
    .map((id) => serviceMap.get(String(id)) || null)
    .filter(Boolean);

  return {
    source: 'metadata',
    professionalIds: targetProfessionalIds,
    serviceIds: inferredServiceIds,
    professionals,
    services,
    primaryProfessionalId: targetProfessionalIds[0] || null,
    primaryServiceId: inferredServiceIds[0] || null,
    scheduleRef: scheduleRef || null,
    vertical,
    purpose,
  };
}

function matchBeautySchedule({ schedule, professional = null, serviceIds = new Set(), serviceNames = new Set(), context = null }) {
  const resolved = context || buildLegacyBeautyContext({ schedule, serviceIds, serviceNames });
  const targetProfessionalId = safeStr(resolved.primaryProfessionalId);
  const targetProfessionalIds = ensureArray(resolved.professionalIds).map((item) => safeStr(item)).filter(Boolean);
  const beautyServiceIds = ensureArray(resolved.serviceIds).map((item) => safeStr(item)).filter(Boolean);
  const scheduleRef = safeStr(resolved.scheduleRef);
  const professionalMatch = !professional
    || targetProfessionalId === professional.id
    || targetProfessionalIds.includes(professional.id)
    || (professional.scheduleRef && scheduleRef === professional.scheduleRef);

  const serviceMatch = resolved.vertical === 'beauty'
    || beautyServiceIds.some((serviceId) => serviceIds.has(serviceId))
    || serviceNames.has(safeStr(resolved.purpose).toLowerCase());

  return professionalMatch && serviceMatch;
}

async function fetchExplicitBeautyContextMap({ tenantId, scheduleIds = [], professionalsOut = null, servicesOut = null }) {
  const uniqueScheduleIds = Array.from(new Set(ensureArray(scheduleIds).map((item) => safeStr(item)).filter(Boolean)));
  if (uniqueScheduleIds.length === 0) return new Map();

  const [professionalRows, serviceRows] = await Promise.all([
    BeautyScheduleProfessional().findAll({
      where: { tenant_key: String(tenantId), operational_schedule_id: uniqueScheduleIds },
      order: [['created_at', 'ASC']],
    }),
    BeautyScheduleService().findAll({
      where: { tenant_key: String(tenantId), operational_schedule_id: uniqueScheduleIds },
      order: [['created_at', 'ASC']],
    }),
  ]);

  const rawProfessionals = (professionalsOut?.items || []);
  const rawServices = (servicesOut?.items || []);
  const professionalMap = new Map(rawProfessionals.map((item) => [String(item.id), item]));
  const serviceMap = new Map(rawServices.map((item) => [String(item.id), item]));
  const out = new Map();

  for (const row of professionalRows.map(mapScheduleProfessional)) {
    const bucket = out.get(row.operationalScheduleId) || {
      source: 'explicit',
      professionalIds: [],
      serviceIds: [],
      professionals: [],
      services: [],
      primaryProfessionalId: null,
      primaryServiceId: null,
      scheduleRef: null,
      vertical: 'beauty',
      purpose: null,
    };
    if (!bucket.professionalIds.includes(row.beautyProfessionalId)) {
      bucket.professionalIds.push(row.beautyProfessionalId);
      const professional = professionalMap.get(String(row.beautyProfessionalId)) || null;
      if (professional) bucket.professionals.push(professional);
      if (!bucket.primaryProfessionalId) bucket.primaryProfessionalId = row.beautyProfessionalId;
      if (!bucket.scheduleRef && professional?.scheduleRef) bucket.scheduleRef = professional.scheduleRef;
    }
    out.set(row.operationalScheduleId, bucket);
  }
  for (const row of serviceRows.map(mapScheduleService)) {
    const bucket = out.get(row.operationalScheduleId) || {
      source: 'explicit',
      professionalIds: [],
      serviceIds: [],
      professionals: [],
      services: [],
      primaryProfessionalId: null,
      primaryServiceId: null,
      scheduleRef: null,
      vertical: 'beauty',
      purpose: null,
    };
    if (!bucket.serviceIds.includes(row.beautyServiceId)) {
      bucket.serviceIds.push(row.beautyServiceId);
      const service = serviceMap.get(String(row.beautyServiceId)) || null;
      if (service) bucket.services.push(service);
      if (!bucket.primaryServiceId) bucket.primaryServiceId = row.beautyServiceId;
    }
    out.set(row.operationalScheduleId, bucket);
  }

  return out;
}

async function resolveBeautyScheduleContext({
  tenantId,
  schedule,
  explicitContextMap = null,
  professionalsOut = null,
  servicesOut = null,
}) {
  if (!schedule) return null;
  const scheduleId = safeStr(schedule.id);
  const professionals = professionalsOut || await listProfessionals({ tenantId, activeOnly: false });
  const services = servicesOut || await listServices({ tenantId, activeOnly: false });
  const professionalMap = new Map((professionals.items || []).map((item) => [String(item.id), item]));
  const serviceMap = new Map((services.items || []).map((item) => [String(item.id), item]));

  const explicitMap = explicitContextMap || await fetchExplicitBeautyContextMap({
    tenantId,
    scheduleIds: [scheduleId],
    professionalsOut: professionals,
    servicesOut: services,
  });
  const explicit = explicitMap.get(scheduleId);
  if (explicit && ((explicit.professionalIds && explicit.professionalIds.length > 0) || (explicit.serviceIds && explicit.serviceIds.length > 0))) {
    return {
      ...explicit,
      source: 'explicit',
    };
  }

  return buildLegacyBeautyContext({
    schedule,
    professionalMap,
    serviceMap,
    serviceIds: new Set((services.items || []).map((item) => item.id)),
    serviceNames: new Set((services.items || []).map((item) => safeStr(item.name).toLowerCase()).filter(Boolean)),
  });
}

async function syncBeautyScheduleRelations({ tenantId, operationalScheduleId, professionalIds = [], serviceIds = [] }) {
  const tenantKey = String(tenantId);
  const scheduleId = String(operationalScheduleId);
  const uniqueProfessionalIds = Array.from(new Set(ensureArray(professionalIds).map((item) => safeStr(item)).filter(Boolean)));
  const uniqueServiceIds = Array.from(new Set(ensureArray(serviceIds).map((item) => safeStr(item)).filter(Boolean)));
  const [existingProfessionalRows, existingServiceRows] = await Promise.all([
    BeautyScheduleProfessional().findAll({ where: { tenant_key: tenantKey, operational_schedule_id: scheduleId } }),
    BeautyScheduleService().findAll({ where: { tenant_key: tenantKey, operational_schedule_id: scheduleId } }),
  ]);
  const existingProfessionalIds = new Set(existingProfessionalRows.map((item) => safeStr(item.beauty_professional_id)));
  const existingServiceIds = new Set(existingServiceRows.map((item) => safeStr(item.beauty_service_id)));

  const missingProfessionalRows = uniqueProfessionalIds
    .filter((item) => !existingProfessionalIds.has(item))
    .map((item) => ({
      id: newId('beautyschpro'),
      tenant_key: tenantKey,
      operational_schedule_id: scheduleId,
      beauty_professional_id: item,
    }));
  const missingServiceRows = uniqueServiceIds
    .filter((item) => !existingServiceIds.has(item))
    .map((item) => ({
      id: newId('beautyschsvc'),
      tenant_key: tenantKey,
      operational_schedule_id: scheduleId,
      beauty_service_id: item,
    }));

  if (missingProfessionalRows.length > 0) await BeautyScheduleProfessional().bulkCreate(missingProfessionalRows);
  if (missingServiceRows.length > 0) await BeautyScheduleService().bulkCreate(missingServiceRows);

  return {
    ok: true,
    createdProfessionals: missingProfessionalRows.length,
    createdServices: missingServiceRows.length,
  };
}

function deriveLoyaltySegment({ visits = 0, inactiveDays = null }) {
  if (Number(visits || 0) >= 8 && Number(inactiveDays || 0) <= 30) return 'vip';
  if (Number(visits || 0) >= 5) return 'loyal';
  if (Number(visits || 0) >= 4) return 'recurring';
  return 'active';
}

async function reconcileLoyaltyForContact({ tenantId, contactId }) {
  if (!contactId) throw new Error('beauty_contact_id_required');
  const [servicesOut, loyaltyRow, scheduleRows] = await Promise.all([
    listServices({ tenantId, activeOnly: false }),
    BeautyLoyalty().findOne({ where: { tenant_key: String(tenantId), contact_id: String(contactId) } }),
    OperationalSchedule().findAll({
      where: {
        tenant_key: String(tenantId),
        contact_id: String(contactId),
      },
      order: [['start_at', 'DESC']],
      limit: 500,
    }),
  ]);

  const serviceIds = new Set((servicesOut.items || []).map((item) => item.id));
  const serviceNames = new Set((servicesOut.items || []).map((item) => safeStr(item.name).toLowerCase()).filter(Boolean));
  const explicitContextMap = await fetchExplicitBeautyContextMap({
    tenantId,
    scheduleIds: scheduleRows.map((item) => safeStr(item.id)),
    servicesOut,
  });
  const activeBeautySchedules = scheduleRows
    .map(toJson)
    .filter((item) => !['canceled', 'cancelled'].includes(safeStr(item.status).toLowerCase()))
    .filter((item) => matchBeautySchedule({
      schedule: item,
      serviceIds,
      serviceNames,
      context: explicitContextMap.get(safeStr(item.id)) || null,
    }));

  const visits = activeBeautySchedules.length;
  const lastVisitAt = activeBeautySchedules
    .map((item) => item.start_at ? new Date(item.start_at).toISOString() : null)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;
  const inactiveDays = lastVisitAt ? Math.floor((Date.now() - new Date(lastVisitAt).getTime()) / (24 * 60 * 60 * 1000)) : null;
  const current = loyaltyRow ? mapLoyalty(loyaltyRow) : null;
  const normalized = {
    tenant_key: String(tenantId),
    contact_id: String(contactId),
    visits,
    points: Math.max(Number(current?.points || 0), visits * 10),
    last_visit_at: lastVisitAt ? new Date(lastVisitAt) : null,
    segment: deriveLoyaltySegment({ visits, inactiveDays }),
    metadata: {
      ...(current?.metadata || {}),
      derivedFromOperationalSchedule: true,
      reconciledAt: new Date().toISOString(),
    },
  };

  const row = loyaltyRow
    ? await loyaltyRow.update(normalized)
    : await BeautyLoyalty().create({ id: newId('beautyloy'), ...normalized });

  try {
    await appendEventV1({
      tenantId,
      type: 'BeautyLoyaltyReconciled',
      source: 'beauty.service',
      occurredAt: new Date().toISOString(),
      correlationId: String(contactId),
      subject: { type: 'crm_contact', id: String(contactId) },
      actor: { type: 'system', id: 'beauty.service' },
      idempotencyKey: `beauty_loyalty:${tenantId}:${contactId}:${visits}:${lastVisitAt || 'none'}`,
      payload: {
        contactId: String(contactId),
        visits,
        segment: normalized.segment,
        lastVisitAt,
      },
    });
  } catch (err) {
    // best-effort
  }

  return { ok: true, item: mapLoyalty(row) };
}

async function syncLoyaltyFromSchedules({ tenantId }) {
  const [servicesOut, loyaltyRows, scheduleRows] = await Promise.all([
    listServices({ tenantId, activeOnly: false }),
    BeautyLoyalty().findAll({ where: { tenant_key: String(tenantId) } }),
    OperationalSchedule().findAll({
      where: { tenant_key: String(tenantId), contact_id: { [Op.ne]: null } },
      order: [['start_at', 'DESC']],
      limit: 500,
    }).catch(() => []),
  ]);

  const serviceIds = new Set((servicesOut.items || []).map((item) => item.id));
  const serviceNames = new Set((servicesOut.items || []).map((item) => safeStr(item.name).toLowerCase()).filter(Boolean));
  const explicitContextMap = await fetchExplicitBeautyContextMap({
    tenantId,
    scheduleIds: scheduleRows.map((item) => safeStr(item.id)),
    servicesOut,
  });
  const existingByContactId = new Map((loyaltyRows || []).map((row) => {
    const item = mapLoyalty(row);
    return [String(item.contactId), row];
  }));
  const derivedByContactId = new Map();
  for (const raw of scheduleRows.map(toJson)) {
    if (!raw.contact_id) continue;
    if (!matchBeautySchedule({
      schedule: raw,
      serviceIds,
      serviceNames,
      context: explicitContextMap.get(safeStr(raw.id)) || null,
    })) continue;
    const bucket = derivedByContactId.get(String(raw.contact_id)) || [];
    bucket.push(raw);
    derivedByContactId.set(String(raw.contact_id), bucket);
  }

  for (const [contactId, schedules] of derivedByContactId.entries()) {
    await reconcileLoyaltyForContact({ tenantId, contactId });
  }
}

async function createBeautyBooking({
  tenantId,
  contactId,
  serviceId,
  professionalId,
  startAt,
  endAt = null,
  timezone = 'UTC',
  channel = 'whatsapp',
  notes = null,
  conversationId = null,
  metadata = {},
}) {
  if (!contactId) throw new Error('beauty_contact_id_required');
  if (!serviceId) throw new Error('beauty_service_required');
  if (!professionalId) throw new Error('beauty_professional_required');

  const [serviceRow, professionalRow, bundleOut] = await Promise.all([
    BeautyService().findOne({ where: { tenant_key: String(tenantId), id: String(serviceId) } }),
    BeautyProfessional().findOne({ where: { tenant_key: String(tenantId), id: String(professionalId) } }),
    resolveBundle({ tenantId, serviceIds: [serviceId], professionalId }),
  ]);

  if (!serviceRow) throw new Error('beauty_service_not_found');
  if (!professionalRow) throw new Error('beauty_professional_not_found');
  const service = mapService(serviceRow);
  const professional = mapProfessional(professionalRow);
  const start = parseDate(startAt);
  if (!start) throw new Error('beauty_booking_start_invalid');
  const durationMinutes = Number(bundleOut?.bundle?.totalDurationMinutes || service.defaultDuration || 30);
  const computedEndAt = endAt ? parseDate(endAt) : new Date(start.getTime() + (durationMinutes * 60 * 1000));
  if (!computedEndAt || computedEndAt <= start) throw new Error('beauty_booking_time_invalid');

  const availability = await resolveOperationalAvailability({
    tenantId,
    startAt: start.toISOString(),
    endAt: computedEndAt.toISOString(),
    timezone,
    professionalIds: [professionalId],
  });
  if (!availability.available) {
    const err = new Error(availability.reasons[0] || 'beauty_schedule_unavailable');
    err.code = err.message;
    err.details = availability;
    throw err;
  }

  const scheduleOut = await schedulingService.createSchedule({
    tenantId,
    input: {
      contextType: 'crm',
      contextId: String(contactId),
      contactId: String(contactId),
      conversationId: conversationId ? String(conversationId) : null,
      channel,
      mode: 'free',
      origin: 'system',
      startAt: start.toISOString(),
      endAt: computedEndAt.toISOString(),
      timezone,
      purpose: service.name,
      notes,
      status: 'scheduled',
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        verticalTemplate: 'beauty',
        beautyServiceId: service.id,
        beautyProfessionalId: professional.id,
        beautyProfessionalIds: [professional.id],
        serviceId: service.id,
        professionalId: professional.id,
        bundle: bundleOut?.bundle || null,
      },
    },
    actor: {},
  });
  await syncBeautyScheduleRelations({
    tenantId,
    operationalScheduleId: scheduleOut.schedule.id,
    professionalIds: [professional.id],
    serviceIds: (bundleOut?.bundle?.items || []).map((item) => item.serviceId).filter(Boolean),
  });

  const loyaltyOut = await reconcileLoyaltyForContact({ tenantId, contactId });
  try {
    await appendEventV1({
      tenantId,
      type: 'BeautyBookingCreated',
      source: 'beauty.service',
      occurredAt: new Date().toISOString(),
      correlationId: scheduleOut.schedule.id,
      subject: { type: 'schedule', id: scheduleOut.schedule.id },
      actor: { type: 'system', id: 'beauty.service' },
      idempotencyKey: `beauty_booking:${tenantId}:${scheduleOut.schedule.id}`,
      payload: {
        contactId: String(contactId),
        serviceId: service.id,
        professionalId: professional.id,
        startAt: scheduleOut.schedule.startAt,
        endAt: scheduleOut.schedule.endAt,
      },
    });
  } catch (err) {
    // best-effort
  }

  return {
    ok: true,
    booking: {
      scheduleId: scheduleOut.schedule.id,
      service,
      professional,
      startAt: scheduleOut.schedule.startAt,
      endAt: scheduleOut.schedule.endAt,
      operationalSchedule: scheduleOut.schedule,
    },
    loyalty: loyaltyOut.item,
  };
}

async function getBeautyBookingByScheduleId({ tenantId, scheduleId }) {
  const row = await OperationalSchedule().findOne({
    where: { tenant_key: String(tenantId), id: String(scheduleId) },
  });
  if (!row) {
    const err = new Error('beauty_booking_not_found');
    err.code = 'beauty_booking_not_found';
    throw err;
  }
  const schedule = toJson(row);
  const [professionalsOut, servicesOut] = await Promise.all([
    listProfessionals({ tenantId, activeOnly: false }),
    listServices({ tenantId, activeOnly: false }),
  ]);
  const context = await resolveBeautyScheduleContext({
    tenantId,
    schedule,
    professionalsOut,
    servicesOut,
  });
  if (!context || (ensureArray(context.serviceIds).length === 0 && safeStr(context.vertical) !== 'beauty')) {
    const err = new Error('beauty_booking_not_found');
    err.code = 'beauty_booking_not_found';
    throw err;
  }
  return {
    ok: true,
    booking: {
      scheduleId: schedule.id,
      schedule,
      context,
      professional: context.primaryProfessionalId
        ? (professionalsOut.items || []).find((item) => item.id === context.primaryProfessionalId) || null
        : null,
      service: context.primaryServiceId
        ? (servicesOut.items || []).find((item) => item.id === context.primaryServiceId) || null
        : null,
      services: context.services || [],
      professionals: context.professionals || [],
    },
  };
}

async function cancelBeautyBooking({ tenantId, scheduleId, actor = {}, reason = null, idempotencyKey = null }) {
  const bookingOut = await getBeautyBookingByScheduleId({ tenantId, scheduleId });
  const canceled = await schedulingService.cancelSchedule({
    tenantId,
    scheduleId,
    actor,
    reason,
    idempotencyKey,
  });
  if (bookingOut.booking.schedule.contact_id) {
    await reconcileLoyaltyForContact({ tenantId, contactId: bookingOut.booking.schedule.contact_id });
  }
  return {
    ok: true,
    booking: {
      ...bookingOut.booking,
      schedule: canceled.schedule,
    },
  };
}

async function rescheduleBeautyBooking({
  tenantId,
  scheduleId,
  startAt,
  endAt = null,
  timezone = null,
  notes,
  actor = {},
  idempotencyKey = null,
}) {
  const bookingOut = await getBeautyBookingByScheduleId({ tenantId, scheduleId });
  const currentSchedule = bookingOut.booking.schedule;
  const start = parseDate(startAt);
  if (!start) throw new Error('beauty_booking_start_invalid');
  const existingStart = parseDate(currentSchedule.start_at || currentSchedule.startAt);
  const existingEnd = parseDate(currentSchedule.end_at || currentSchedule.endAt);
  const durationMinutes = Math.max(1, Math.round(((existingEnd?.getTime() || 0) - (existingStart?.getTime() || 0)) / 60000) || 30);
  const computedEnd = endAt ? parseDate(endAt) : new Date(start.getTime() + (durationMinutes * 60 * 1000));
  if (!computedEnd || computedEnd <= start) throw new Error('beauty_booking_time_invalid');

  const professionalIds = ensureArray(bookingOut.booking.context.professionalIds).slice(0, 1);
  const availability = await resolveOperationalAvailability({
    tenantId,
    startAt: start.toISOString(),
    endAt: computedEnd.toISOString(),
    timezone: timezone || currentSchedule.timezone || 'UTC',
    excludeScheduleId: String(scheduleId),
    professionalIds,
  });
  if (!availability.available) {
    const err = new Error(availability.reasons[0] || 'beauty_schedule_unavailable');
    err.code = err.message;
    err.details = availability;
    throw err;
  }

  const metadata = {
    ...((currentSchedule.metadata && typeof currentSchedule.metadata === 'object') ? currentSchedule.metadata : {}),
    verticalTemplate: 'beauty',
  };
  const out = await schedulingService.rescheduleSchedule({
    tenantId,
    scheduleId,
    input: {
      startAt: start.toISOString(),
      endAt: computedEnd.toISOString(),
      timezone: timezone || currentSchedule.timezone || 'UTC',
      purpose: currentSchedule.purpose,
      notes: notes === undefined ? currentSchedule.notes : notes,
      channel: currentSchedule.channel,
      origin: currentSchedule.origin,
      mode: currentSchedule.mode,
      ownerId: currentSchedule.owner_id || currentSchedule.ownerId || null,
      teamId: currentSchedule.team_id || currentSchedule.teamId || null,
      metadata,
    },
    actor,
    idempotencyKey,
  });

  if (currentSchedule.contact_id) {
    await reconcileLoyaltyForContact({ tenantId, contactId: currentSchedule.contact_id });
  }
  return {
    ok: true,
    booking: {
      ...bookingOut.booking,
      schedule: out.schedule,
    },
  };
}

async function listUpsellOpportunities({ tenantId }) {
  const [servicesOut, compositionsOut, scheduleRows] = await Promise.all([
    listServices({ tenantId, activeOnly: true }),
    listCompositions({ tenantId }),
    OperationalSchedule().findAll({
      where: { tenant_key: String(tenantId) },
      order: [['start_at', 'DESC']],
      limit: 150,
    }),
  ]);

  const servicesById = new Map((servicesOut.items || []).map((item) => [item.id, item]));
  const parentsByChildId = new Map();
  for (const item of compositionsOut.items || []) {
    const bucket = parentsByChildId.get(String(item.childServiceId)) || [];
    bucket.push(item);
    parentsByChildId.set(String(item.childServiceId), bucket);
  }

  const opportunities = [];
  for (const row of scheduleRows.map(toJson)) {
    const metadata = row.metadata || {};
    const serviceId = safeStr(metadata.beautyServiceId || metadata.serviceId);
    const contactId = safeStr(row.contact_id);
    if (!serviceId || !contactId) continue;
    const relatedParents = parentsByChildId.get(serviceId) || [];
    for (const composition of relatedParents) {
      const parentService = servicesById.get(String(composition.parentServiceId));
      const childService = servicesById.get(serviceId);
      if (!parentService || !childService || parentService.id === childService.id) continue;
      opportunities.push({
        contactId,
        serviceId,
        serviceName: childService.name,
        suggestedServiceId: parentService.id,
        suggestedServiceName: parentService.name,
        reason: `Cliente recente de ${childService.name}; sugerir ${parentService.name}.`,
        scheduleId: row.id,
        startAt: row.start_at ? new Date(row.start_at).toISOString() : null,
      });
    }
  }

  return {
    ok: true,
    items: opportunities.slice(0, 20),
  };
}

async function listProfessionalAgenda({ tenantId, professionalId = null, daysAhead = 7 }) {
  const [professionalsOut, scheduleRows, servicesOut] = await Promise.all([
    listProfessionals({ tenantId, activeOnly: false }),
    OperationalSchedule().findAll({
      where: { tenant_key: String(tenantId) },
      order: [['start_at', 'ASC']],
      limit: 500,
    }),
    listServices({ tenantId, activeOnly: false }),
  ]);
  const professionals = (professionalsOut.items || []).filter((item) => !professionalId || item.id === String(professionalId));
  const serviceIds = new Set((servicesOut.items || []).map((item) => item.id));
  const serviceNames = new Set((servicesOut.items || []).map((item) => safeStr(item.name).toLowerCase()).filter(Boolean));
  const explicitContextMap = await fetchExplicitBeautyContextMap({
    tenantId,
    scheduleIds: scheduleRows.map((item) => safeStr(item.id)),
    professionalsOut,
    servicesOut,
  });
  const horizon = Date.now() + (Number(daysAhead || 7) * 24 * 60 * 60 * 1000);

  const agendas = professionals.map((professional) => {
    const appointments = scheduleRows
      .map((row) => toJson(row))
      .filter((item) => {
        const startAt = item.start_at ? new Date(item.start_at).getTime() : 0;
        return startAt > 0
          && startAt <= horizon
          && matchBeautySchedule({
            schedule: item,
            professional,
            serviceIds,
            serviceNames,
            context: explicitContextMap.get(safeStr(item.id)) || null,
          });
      })
      .map((item) => ({
        id: item.id,
        startAt: item.start_at ? new Date(item.start_at).toISOString() : null,
        endAt: item.end_at ? new Date(item.end_at).toISOString() : null,
        purpose: item.purpose || null,
        metadata: item.metadata || {},
      }));

    const dayBuckets = new Map();
    for (const appointment of appointments) {
      const dayKey = String(appointment.startAt || '').slice(0, 10);
      const bucket = dayBuckets.get(dayKey) || [];
      bucket.push(appointment);
      dayBuckets.set(dayKey, bucket);
    }
    const idleSignals = [];
    const freeWindows = [];
    for (const [dayKey, bucket] of dayBuckets.entries()) {
      const maxDailySessions = Math.max(1, Number(professional.maxDailySessions || 4));
      if (bucket.length < maxDailySessions) {
        idleSignals.push({
          day: dayKey,
          bookedSessions: bucket.length,
          suggestedCapacity: Math.max(0, maxDailySessions - bucket.length),
          utilizationRate: Number((bucket.length / maxDailySessions).toFixed(2)),
        });
        freeWindows.push({
          day: dayKey,
          freeSlots: Math.max(0, maxDailySessions - bucket.length),
        });
      }
    }
    return {
      professional,
      appointments,
      idleSignals,
      freeWindows,
    };
  });
  return { ok: true, items: agendas };
}

async function getDashboard({ tenantId }) {
  await syncLoyaltyFromSchedules({ tenantId });
  const [professionalsOut, servicesOut, assignmentsOut, loyaltyRows, preferenceRows, waitingRows, scheduleRows, reactivationOut, agendaOut, predictiveOut] = await Promise.all([
    listProfessionals({ tenantId, activeOnly: false }),
    listServices({ tenantId, activeOnly: false }),
    listAssignments({ tenantId, activeOnly: false }),
    BeautyLoyalty().findAll({ where: { tenant_key: String(tenantId) }, order: [['updated_at', 'DESC']], limit: 50 }),
    BeautyClientPreference().findAll({ where: { tenant_key: String(tenantId) }, order: [['updated_at', 'DESC']], limit: 50 }),
    AutonomousWaitingList().findAll({ where: { tenant_key: String(tenantId), active: true }, order: [['updated_at', 'DESC']], limit: 100 }),
    OperationalSchedule().findAll({ where: { tenant_key: String(tenantId) }, order: [['start_at', 'DESC']], limit: 50 }),
    listReactivationCandidates({ tenantId, skipSync: true }),
    listProfessionalAgenda({ tenantId }),
    getInsights({ tenantId, verticalTemplate: 'beauty', serviceType: 'beauty_session' }).catch(() => ({ ok: false })),
  ]);
  const upsellOut = await listUpsellOpportunities({ tenantId });

  const services = servicesOut.items || [];
  const serviceIds = new Set(services.map((item) => item.id));
  const serviceNames = new Set(services.map((item) => safeStr(item.name).toLowerCase()).filter(Boolean));
  const explicitContextMap = await fetchExplicitBeautyContextMap({
    tenantId,
    scheduleIds: scheduleRows.map((item) => safeStr(item.id)),
    professionalsOut,
    servicesOut,
  });
  const waitingListBeauty = waitingRows.map((row) => toJson(row)).filter((item) => {
    const serviceType = safeStr(item.service_type).toLowerCase();
    return serviceIds.has(item.service_type) || serviceNames.has(serviceType);
  });
  const recentSchedules = scheduleRows.map((row) => toJson(row)).filter((item) => {
    const context = explicitContextMap.get(safeStr(item.id)) || null;
    return matchBeautySchedule({ schedule: item, serviceIds, serviceNames, context });
  }).slice(0, 12);

  return {
    ok: true,
    summary: {
      professionalsTotal: professionalsOut.items.length,
      professionalsActive: professionalsOut.items.filter((item) => item.active).length,
      servicesTotal: services.length,
      servicesActive: services.filter((item) => item.active).length,
      assignmentsTotal: assignmentsOut.items.length,
      loyaltyClients: loyaltyRows.length,
      preferenceProfiles: preferenceRows.length,
      waitingListBeauty: waitingListBeauty.length,
      recentBeautySchedules: recentSchedules.length,
    },
    professionals: professionalsOut.items,
    services,
    assignments: assignmentsOut.items,
    loyalty: loyaltyRows.map(mapLoyalty),
    preferences: preferenceRows.map(mapPreference),
    waitingList: waitingListBeauty,
    recentSchedules,
    reactivationCandidates: reactivationOut.items || [],
    professionalAgenda: agendaOut.items || [],
    upsellOpportunities: upsellOut.items || [],
    predictiveInsights: predictiveOut.ok ? predictiveOut.insights : null,
  };
}

module.exports = {
  listProfessionals,
  saveProfessional,
  listServices,
  saveService,
  listAssignments,
  saveAssignment,
  listCompositions,
  replaceCompositions,
  upsertLoyalty,
  upsertPreference,
  resolveBundle,
  createBeautyBooking,
  getBeautyBookingByScheduleId,
  cancelBeautyBooking,
  rescheduleBeautyBooking,
  resolveBeautyScheduleContext,
  syncBeautyScheduleRelations,
  listReactivationCandidates,
  reconcileLoyaltyForContact,
  syncLoyaltyFromSchedules,
  listUpsellOpportunities,
  listProfessionalAgenda,
  getDashboard,
};
