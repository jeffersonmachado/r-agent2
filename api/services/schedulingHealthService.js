'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  OperationalSchedule,
  FitnessClassSchedule,
  FitnessScheduleProfessional,
  FitnessScheduleResource,
  BeautyScheduleProfessional,
  BeautyScheduleService,
  OperationalAlert,
} = require('../db/models');
const { resolveOperationalAvailability } = require('./operationalAvailabilityService');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function safeStr(value) {
  return String(value == null ? '' : value).trim();
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function toJson(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function overlapsRange(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function normalizeAlert(row) {
  const item = toJson(row);
  return {
    id: item.id,
    tenantId: item.tenant_key,
    alertType: item.alert_type,
    severity: item.severity,
    entityType: item.entity_type,
    entityId: item.entity_id || null,
    description: item.description,
    createdAt: item.created_at || item.createdAt || null,
    resolvedAt: item.resolved_at || item.resolvedAt || null,
  };
}

function buildAlertKey(alert) {
  return [
    safeStr(alert.alertType),
    safeStr(alert.entityType),
    safeStr(alert.entityId),
  ].join('::');
}

async function upsertAlerts({ tenantId, alerts = [] }) {
  const existingRows = await OperationalAlert().findAll({
    where: {
      tenant_key: String(tenantId),
      resolved_at: null,
    },
  });
  const existingByKey = new Map(existingRows.map((row) => {
    const item = normalizeAlert(row);
    return [buildAlertKey(item), row];
  }));

  const nextKeys = new Set();
  const created = [];
  const updated = [];
  for (const alert of alerts) {
    const key = buildAlertKey(alert);
    nextKeys.add(key);
    const existing = existingByKey.get(key);
    if (existing) {
      await existing.update({
        severity: alert.severity,
        description: alert.description,
        resolved_at: null,
      });
      updated.push(normalizeAlert(existing));
      continue;
    }
    const row = await OperationalAlert().create({
      id: newId('opalert'),
      tenant_key: String(tenantId),
      alert_type: alert.alertType,
      severity: alert.severity,
      entity_type: alert.entityType,
      entity_id: alert.entityId || null,
      description: alert.description,
      resolved_at: null,
    });
    created.push(normalizeAlert(row));
  }

  const resolved = [];
  for (const [key, row] of existingByKey.entries()) {
    if (nextKeys.has(key)) continue;
    await row.update({ resolved_at: new Date() });
    resolved.push(normalizeAlert(row));
  }

  return { ok: true, created, updated, resolved };
}

function compareLegacyIds(explicitIds = [], metadataIds = []) {
  const explicit = Array.from(new Set(ensureArray(explicitIds).map((item) => safeStr(item)).filter(Boolean)));
  const legacy = Array.from(new Set(ensureArray(metadataIds).map((item) => safeStr(item)).filter(Boolean)));
  if (explicit.length === 0 || legacy.length === 0) return false;
  if (explicit.length !== legacy.length) return true;
  return explicit.some((item) => !legacy.includes(item));
}

async function scanTenant({ tenantId, persist = true } = {}) {
  const [operationalRows, fitnessRows, fitnessProfessionalRows, fitnessResourceRows, beautyProfessionalRows, beautyServiceRows] = await Promise.all([
    OperationalSchedule().findAll({
      where: {
        tenant_key: String(tenantId),
        status: { [Op.in]: ['scheduled', 'in_progress', 'no_show', 'canceled', 'done'] },
      },
      order: [['start_at', 'DESC']],
      limit: 400,
    }),
    FitnessClassSchedule().findAll({
      where: { tenant_key: String(tenantId) },
      order: [['start_at', 'DESC']],
      limit: 400,
    }),
    FitnessScheduleProfessional().findAll({ where: { tenant_key: String(tenantId) } }),
    FitnessScheduleResource().findAll({ where: { tenant_key: String(tenantId) } }),
    BeautyScheduleProfessional().findAll({ where: { tenant_key: String(tenantId) } }),
    BeautyScheduleService().findAll({ where: { tenant_key: String(tenantId) } }),
  ]);

  const fitnessByOperationalId = new Map();
  for (const row of fitnessRows.map(toJson)) {
    if (!safeStr(row.operational_schedule_id)) continue;
    fitnessByOperationalId.set(safeStr(row.operational_schedule_id), row);
  }
  const fitnessProfessionalsByScheduleId = new Map();
  for (const row of fitnessProfessionalRows.map(toJson)) {
    const bucket = fitnessProfessionalsByScheduleId.get(safeStr(row.class_schedule_id)) || [];
    bucket.push(safeStr(row.professional_id));
    fitnessProfessionalsByScheduleId.set(safeStr(row.class_schedule_id), bucket);
  }
  const fitnessResourcesByScheduleId = new Map();
  for (const row of fitnessResourceRows.map(toJson)) {
    const bucket = fitnessResourcesByScheduleId.get(safeStr(row.class_schedule_id)) || [];
    bucket.push({
      resourceId: safeStr(row.resource_id),
      quantity: Math.max(1, Number(row.quantity || 1)),
      exclusiveUse: row.exclusive_use === true,
    });
    fitnessResourcesByScheduleId.set(safeStr(row.class_schedule_id), bucket);
  }
  const beautyProfessionalsByOperationalId = new Map();
  for (const row of beautyProfessionalRows.map(toJson)) {
    const bucket = beautyProfessionalsByOperationalId.get(safeStr(row.operational_schedule_id)) || [];
    bucket.push(safeStr(row.beauty_professional_id));
    beautyProfessionalsByOperationalId.set(safeStr(row.operational_schedule_id), bucket);
  }
  const beautyServicesByOperationalId = new Map();
  for (const row of beautyServiceRows.map(toJson)) {
    const bucket = beautyServicesByOperationalId.get(safeStr(row.operational_schedule_id)) || [];
    bucket.push(safeStr(row.beauty_service_id));
    beautyServicesByOperationalId.set(safeStr(row.operational_schedule_id), bucket);
  }

  const alerts = [];
  const professionalConflictCount = new Map();
  const resourceConflictCount = new Map();

  for (const schedule of operationalRows.map(toJson)) {
    const scheduleId = safeStr(schedule.id);
    const startAt = new Date(schedule.start_at);
    const endAt = new Date(schedule.end_at);
    const metadata = schedule.metadata || {};
    const vertical = safeStr(metadata.verticalTemplate).toLowerCase();
    const linkedFitness = fitnessByOperationalId.get(scheduleId) || null;
    const beautyProfessionalIds = beautyProfessionalsByOperationalId.get(scheduleId) || [];
    const beautyServiceIds = beautyServicesByOperationalId.get(scheduleId) || [];

    if (!schedule.start_at || !schedule.end_at || Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      alerts.push({
        alertType: 'scheduling_impossible_slot',
        severity: 'high',
        entityType: 'schedule',
        entityId: scheduleId,
        description: `Schedule ${scheduleId} possui intervalo invalido.`,
      });
      continue;
    }

    if (vertical === 'beauty' || beautyProfessionalIds.length > 0 || beautyServiceIds.length > 0) {
      if (beautyProfessionalIds.length === 0 || beautyServiceIds.length === 0) {
        alerts.push({
          alertType: 'scheduling_missing_explicit_relations',
          severity: 'high',
          entityType: 'schedule',
          entityId: scheduleId,
          description: `Schedule Beauty ${scheduleId} ainda nao possui relacoes explicitas completas.`,
        });
      }
      if (compareLegacyIds(beautyProfessionalIds, ensureArray(metadata.beautyProfessionalIds).concat(metadata.beautyProfessionalId ? [metadata.beautyProfessionalId] : []))) {
        alerts.push({
          alertType: 'scheduling_metadata_inconsistent',
          severity: 'medium',
          entityType: 'schedule',
          entityId: scheduleId,
          description: `Schedule Beauty ${scheduleId} diverge entre metadata legado e relacoes explicitas de profissional.`,
        });
      }
    }

    if (linkedFitness) {
      const explicitProfessionalIds = fitnessProfessionalsByScheduleId.get(safeStr(linkedFitness.id)) || [];
      const explicitResourceRequirements = fitnessResourcesByScheduleId.get(safeStr(linkedFitness.id)) || [];
      if (explicitProfessionalIds.length === 0) {
        alerts.push({
          alertType: 'scheduling_missing_explicit_relations',
          severity: 'high',
          entityType: 'fitness_schedule',
          entityId: safeStr(linkedFitness.id),
          description: `Schedule Fitness ${linkedFitness.id} nao possui vinculo explicito de profissional.`,
        });
      }
      if (compareLegacyIds(explicitProfessionalIds, ensureArray(linkedFitness.metadata?.professionalIds).concat(linkedFitness.metadata?.professionalId ? [linkedFitness.metadata.professionalId] : []))) {
        alerts.push({
          alertType: 'scheduling_metadata_inconsistent',
          severity: 'medium',
          entityType: 'fitness_schedule',
          entityId: safeStr(linkedFitness.id),
          description: `Schedule Fitness ${linkedFitness.id} diverge entre metadata legado e relacoes explicitas de profissional.`,
        });
      }

      const availability = await resolveOperationalAvailability({
        tenantId,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        excludeOperationalScheduleId: scheduleId,
        excludeFitnessScheduleId: safeStr(linkedFitness.id),
        professionalIds: explicitProfessionalIds,
        resourceRequirements: explicitResourceRequirements,
      }).catch(() => null);

      if (availability?.reasons?.includes('outside_working_hours')) {
        alerts.push({
          alertType: 'scheduling_outside_working_hours',
          severity: 'medium',
          entityType: 'schedule',
          entityId: scheduleId,
          description: `Schedule ${scheduleId} esta fora da janela operacional configurada.`,
        });
      }
      for (const conflict of availability?.professionalConflicts || []) {
        professionalConflictCount.set(conflict.professionalId, (professionalConflictCount.get(conflict.professionalId) || 0) + 1);
      }
      for (const conflict of availability?.resourceConflicts || []) {
        resourceConflictCount.set(conflict.resourceId, (resourceConflictCount.get(conflict.resourceId) || 0) + 1);
      }
    }
  }

  for (const [professionalId, count] of professionalConflictCount.entries()) {
    if (count < 2) continue;
    alerts.push({
      alertType: 'scheduling_repeated_professional_conflict',
      severity: count >= 3 ? 'high' : 'medium',
      entityType: 'professional',
      entityId: professionalId,
      description: `Profissional ${professionalId} apareceu em ${count} conflitos operacionais recentes.`,
    });
  }
  for (const [resourceId, count] of resourceConflictCount.entries()) {
    if (count < 2) continue;
    alerts.push({
      alertType: 'scheduling_repeated_resource_conflict',
      severity: count >= 3 ? 'high' : 'medium',
      entityType: 'resource',
      entityId: resourceId,
      description: `Recurso ${resourceId} apareceu em ${count} conflitos operacionais recentes.`,
    });
  }

  const result = {
    ok: true,
    tenantId: String(tenantId),
    alerts,
  };

  if (!persist) return result;
  const sync = await upsertAlerts({ tenantId, alerts });
  return {
    ...result,
    persisted: sync,
  };
}

async function listAlerts({ tenantId, includeResolved = false, limit = 100 }) {
  const where = { tenant_key: String(tenantId) };
  if (!includeResolved) where.resolved_at = null;
  const rows = await OperationalAlert().findAll({
    where,
    order: [['resolved_at', 'ASC'], ['created_at', 'DESC']],
    limit: Math.min(Math.max(Number(limit) || 100, 1), 300),
  });
  return { ok: true, items: rows.map(normalizeAlert) };
}

module.exports = {
  scanTenant,
  listAlerts,
};
