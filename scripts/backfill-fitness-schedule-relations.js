'use strict';

const crypto = require('crypto');
const { connect, close } = require('../api/db/sequelize');
const {
  FitnessClassSchedule,
  FitnessScheduleProfessional,
  FitnessScheduleResource,
} = require('../api/db/models');

function newId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeStr(value) {
  return String(value == null ? '' : value).trim();
}

function toJson(row) {
  return row?.toJSON ? row.toJSON() : row;
}

function toPositiveInt(value, fallback = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parseDateFilter(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => safeStr(item))
    .filter(Boolean);
}

function normalizeResourceRequirement(item) {
  return {
    resourceId: safeStr(item?.resourceId || item?.resource_id || item),
    quantity: Math.max(1, Number(item?.quantity || 1)),
    exclusiveUse: item?.exclusiveUse === true || item?.exclusive_use === true,
  };
}

function collectLegacyContext(item = {}) {
  const metadata = item.metadata || {};
  const professionalIds = Array.from(new Set(
    ensureArray(metadata.professionalIds)
      .concat(metadata.professionalId ? [metadata.professionalId] : [])
      .map((entry) => safeStr(entry))
      .filter(Boolean),
  ));
  const resourceRequirements = Array.from(new Map(
    ensureArray(metadata.resourceRequirements).length > 0
      ? ensureArray(metadata.resourceRequirements).map((entry) => [safeStr(entry.resourceId || entry.resource_id), normalizeResourceRequirement(entry)])
      : ensureArray(metadata.resourceIds).map((entry) => [safeStr(entry), normalizeResourceRequirement(entry)]),
  ).values()).filter((entry) => entry.resourceId);

  return {
    professionalIds,
    resourceRequirements,
    hasLegacyData: professionalIds.length > 0 || resourceRequirements.length > 0,
  };
}

function matchesFilters(item, filters = {}) {
  if (filters.statuses && filters.statuses.length > 0) {
    const status = safeStr(item.status).toLowerCase();
    if (!filters.statuses.includes(status)) return false;
  }

  const stamp = item.start_at || item.startAt || item.created_at || item.createdAt || null;
  if ((filters.startDate || filters.endDate) && !stamp) return false;
  if (filters.startDate) {
    const current = new Date(stamp);
    if (Number.isNaN(current.getTime()) || current < filters.startDate) return false;
  }
  if (filters.endDate) {
    const current = new Date(stamp);
    if (Number.isNaN(current.getTime()) || current > filters.endDate) return false;
  }
  return true;
}

function summarizeValidation({
  expectedProfessionalIds = [],
  expectedResourceIds = [],
  existingProfessionalRows = [],
  existingResourceRows = [],
  plannedProfessionalCreates = [],
  plannedResourceCreates = [],
  schedule = {},
}) {
  const existingProfessionalIds = existingProfessionalRows.map((entry) => safeStr(entry.professional_id)).filter(Boolean);
  const existingResourceIds = existingResourceRows.map((entry) => safeStr(entry.resource_id)).filter(Boolean);
  const finalProfessionalIds = new Set(existingProfessionalIds.concat(plannedProfessionalCreates.map((entry) => safeStr(entry.professional_id))));
  const finalResourceIds = new Set(existingResourceIds.concat(plannedResourceCreates.map((entry) => safeStr(entry.resource_id))));

  const missingProfessionalIds = expectedProfessionalIds.filter((id) => !finalProfessionalIds.has(id));
  const missingResourceIds = expectedResourceIds.filter((id) => !finalResourceIds.has(id));
  const duplicateProfessionalRelations = existingProfessionalIds.length - new Set(existingProfessionalIds).size;
  const duplicateResourceRelations = existingResourceIds.length - new Set(existingResourceIds).size;
  const mismatchedOperationalLinks =
    existingProfessionalRows.filter((entry) => safeStr(entry.operational_schedule_id) && safeStr(entry.operational_schedule_id) !== safeStr(schedule.operational_schedule_id)).length
    + existingResourceRows.filter((entry) => safeStr(entry.operational_schedule_id) && safeStr(entry.operational_schedule_id) !== safeStr(schedule.operational_schedule_id)).length;

  return {
    missingProfessionalIds,
    missingResourceIds,
    duplicateProfessionalRelations,
    duplicateResourceRelations,
    mismatchedOperationalLinks,
    exactMatch:
      missingProfessionalIds.length === 0
      && missingResourceIds.length === 0
      && duplicateProfessionalRelations === 0
      && duplicateResourceRelations === 0
      && mismatchedOperationalLinks === 0,
  };
}

async function backfillFitnessScheduleRelations({
  tenantId = null,
  dryRun = false,
  startDate = null,
  endDate = null,
  statuses = [],
  limit = null,
  batchSize = 100,
  onBatch = null,
} = {}) {
  const where = tenantId ? { tenant_key: String(tenantId) } : {};
  const allRows = await FitnessClassSchedule().findAll({ where, order: [['created_at', 'ASC']] });
  const normalizedStatuses = ensureArray(statuses).map((item) => safeStr(item).toLowerCase()).filter(Boolean);
  const filters = {
    tenantId: tenantId ? String(tenantId) : null,
    statuses: normalizedStatuses,
    startDate: parseDateFilter(startDate),
    endDate: parseDateFilter(endDate),
    limit: toPositiveInt(limit, null),
    batchSize: toPositiveInt(batchSize, 100) || 100,
  };

  const filteredRows = allRows
    .map(toJson)
    .filter((item) => matchesFilters(item, filters))
    .slice(0, filters.limit || Number.MAX_SAFE_INTEGER);

  const report = {
    ok: true,
    dryRun: !!dryRun,
    filters: {
      tenantId: filters.tenantId,
      statuses: filters.statuses,
      startDate: filters.startDate ? filters.startDate.toISOString() : null,
      endDate: filters.endDate ? filters.endDate.toISOString() : null,
      limit: filters.limit,
      batchSize: filters.batchSize,
    },
    analyzedSchedules: filteredRows.length,
    processedSchedules: filteredRows.length,
    eligibleSchedules: 0,
    migrableSchedules: 0,
    migratedSchedules: 0,
    touchedSchedules: 0,
    createdProfessionals: 0,
    createdResources: 0,
    alreadyMigrated: 0,
    ignoredSchedules: 0,
    noDataSchedules: 0,
    inconsistentSchedules: 0,
    processedBatches: 0,
    validation: {
      exactMatches: 0,
      missingProfessionalRelations: 0,
      missingResourceRelations: 0,
      duplicateProfessionalRelations: 0,
      duplicateResourceRelations: 0,
      mismatchedOperationalLinks: 0,
    },
    errors: [],
  };

  for (let offset = 0; offset < filteredRows.length; offset += filters.batchSize) {
    const batch = filteredRows.slice(offset, offset + filters.batchSize);
    report.processedBatches += 1;
    const batchSummary = {
      batchNumber: report.processedBatches,
      size: batch.length,
      migrableSchedules: 0,
      migratedSchedules: 0,
      alreadyMigrated: 0,
      ignoredSchedules: 0,
      inconsistentSchedules: 0,
      errors: 0,
    };

    for (const item of batch) {
      try {
        const scheduleId = String(item.id);
        const tenantKey = String(item.tenant_key);
        const legacy = collectLegacyContext(item);

        if (!legacy.hasLegacyData) {
          report.ignoredSchedules += 1;
          report.noDataSchedules += 1;
          batchSummary.ignoredSchedules += 1;
          continue;
        }

        report.eligibleSchedules += 1;

        const [existingProfessionalRows, existingResourceRows] = await Promise.all([
          FitnessScheduleProfessional().findAll({ where: { tenant_key: tenantKey, class_schedule_id: scheduleId } }),
          FitnessScheduleResource().findAll({ where: { tenant_key: tenantKey, class_schedule_id: scheduleId } }),
        ]);
        const existingProfessionalIds = new Set(existingProfessionalRows.map((entry) => safeStr(entry.professional_id)));
        const existingResourceIds = new Set(existingResourceRows.map((entry) => safeStr(entry.resource_id)));

        const professionalCreates = legacy.professionalIds
          .filter((professionalId) => !existingProfessionalIds.has(professionalId))
          .map((professionalId) => ({
            id: newId('fitschpro'),
            tenant_key: tenantKey,
            class_schedule_id: scheduleId,
            operational_schedule_id: item.operational_schedule_id || null,
            professional_id: professionalId,
          }));

        const resourceCreates = legacy.resourceRequirements
          .filter((entry) => !existingResourceIds.has(entry.resourceId))
          .map((entry) => ({
            id: newId('fitschres'),
            tenant_key: tenantKey,
            class_schedule_id: scheduleId,
            operational_schedule_id: item.operational_schedule_id || null,
            resource_id: entry.resourceId,
            quantity: entry.quantity,
            exclusive_use: entry.exclusiveUse === true,
            metadata: {},
          }));

        const validation = summarizeValidation({
          expectedProfessionalIds: legacy.professionalIds,
          expectedResourceIds: legacy.resourceRequirements.map((entry) => entry.resourceId),
          existingProfessionalRows,
          existingResourceRows,
          plannedProfessionalCreates: professionalCreates,
          plannedResourceCreates: resourceCreates,
          schedule: item,
        });

        report.validation.missingProfessionalRelations += validation.missingProfessionalIds.length;
        report.validation.missingResourceRelations += validation.missingResourceIds.length;
        report.validation.duplicateProfessionalRelations += validation.duplicateProfessionalRelations;
        report.validation.duplicateResourceRelations += validation.duplicateResourceRelations;
        report.validation.mismatchedOperationalLinks += validation.mismatchedOperationalLinks;
        if (validation.exactMatch) {
          report.validation.exactMatches += 1;
        } else if (validation.missingProfessionalIds.length > 0 || validation.missingResourceIds.length > 0 || validation.duplicateProfessionalRelations > 0 || validation.duplicateResourceRelations > 0 || validation.mismatchedOperationalLinks > 0) {
          report.inconsistentSchedules += 1;
          batchSummary.inconsistentSchedules += 1;
        }

        if (professionalCreates.length === 0 && resourceCreates.length === 0) {
          report.alreadyMigrated += 1;
          batchSummary.alreadyMigrated += 1;
          continue;
        }

        report.migrableSchedules += 1;
        report.touchedSchedules += 1;
        batchSummary.migrableSchedules += 1;

        if (!dryRun) {
          if (professionalCreates.length > 0) await FitnessScheduleProfessional().bulkCreate(professionalCreates);
          if (resourceCreates.length > 0) await FitnessScheduleResource().bulkCreate(resourceCreates);
          report.migratedSchedules += 1;
          batchSummary.migratedSchedules += 1;
        }

        report.createdProfessionals += professionalCreates.length;
        report.createdResources += resourceCreates.length;
      } catch (err) {
        report.errors.push({
          scheduleId: safeStr(item.id) || null,
          error: err?.message || String(err || 'unknown_error'),
        });
        batchSummary.errors += 1;
      }
    }

    if (typeof onBatch === 'function') {
      onBatch(batchSummary);
    }
  }

  return report;
}

function parseCliArgs(argv = []) {
  const args = new Set(argv);
  const pickValue = (prefix) => {
    const arg = argv.find((entry) => entry.startsWith(prefix));
    return arg ? arg.slice(prefix.length) : null;
  };

  const apply = args.has('--apply');
  const dryRun = args.has('--dry-run') || !apply;

  return {
    tenantId: pickValue('--tenant='),
    dryRun,
    startDate: pickValue('--start='),
    endDate: pickValue('--end='),
    statuses: parseCsv(pickValue('--status=')),
    limit: toPositiveInt(pickValue('--limit='), null),
    batchSize: toPositiveInt(pickValue('--batch-size='), 100),
  };
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));

  await connect();
  try {
    const out = await backfillFitnessScheduleRelations({
      ...options,
      onBatch: (batch) => {
        process.stdout.write(`[fitness-backfill] batch=${batch.batchNumber} size=${batch.size} migrable=${batch.migrableSchedules} migrated=${batch.migratedSchedules} already=${batch.alreadyMigrated} inconsistent=${batch.inconsistentSchedules} errors=${batch.errors}\n`);
      },
    });
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  } finally {
    await close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message || String(err)}\n`);
    process.exit(1);
  });
}

module.exports = {
  backfillFitnessScheduleRelations,
  collectLegacyContext,
  parseCliArgs,
};
