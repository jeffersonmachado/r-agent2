'use strict';

const crypto = require('crypto');
const { connect, close } = require('../api/db/sequelize');
const {
  OperationalSchedule,
  BeautyScheduleProfessional,
  BeautyScheduleService,
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

function collectLegacyServiceIds(metadata = {}) {
  return Array.from(new Set(
    ensureArray(metadata.bundle?.items).map((item) => safeStr(item.serviceId)).filter(Boolean)
      .concat(metadata.beautyServiceId ? [metadata.beautyServiceId] : [])
      .concat(metadata.serviceId ? [metadata.serviceId] : []),
  ));
}

function collectLegacyProfessionalIds(metadata = {}) {
  return Array.from(new Set(
    ensureArray(metadata.beautyProfessionalIds)
      .concat(metadata.beautyProfessionalId ? [metadata.beautyProfessionalId] : [])
      .concat(metadata.professionalId ? [metadata.professionalId] : [])
      .map((item) => safeStr(item))
      .filter(Boolean),
  ));
}

function collectLegacyContext(item = {}) {
  const metadata = item.metadata || {};
  const vertical = safeStr(metadata.verticalTemplate).toLowerCase();
  const professionalIds = collectLegacyProfessionalIds(metadata);
  const serviceIds = collectLegacyServiceIds(metadata);
  const hasLegacyBeautyContext = vertical === 'beauty' || professionalIds.length > 0 || serviceIds.length > 0;
  return {
    vertical,
    professionalIds,
    serviceIds,
    hasLegacyBeautyContext,
    hasMigrateableData: professionalIds.length > 0 || serviceIds.length > 0,
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
  expectedServiceIds = [],
  existingProfessionalRows = [],
  existingServiceRows = [],
  plannedProfessionalCreates = [],
  plannedServiceCreates = [],
}) {
  const existingProfessionalIds = existingProfessionalRows.map((entry) => safeStr(entry.beauty_professional_id)).filter(Boolean);
  const existingServiceIds = existingServiceRows.map((entry) => safeStr(entry.beauty_service_id)).filter(Boolean);
  const finalProfessionalIds = new Set(existingProfessionalIds.concat(plannedProfessionalCreates.map((entry) => safeStr(entry.beauty_professional_id))));
  const finalServiceIds = new Set(existingServiceIds.concat(plannedServiceCreates.map((entry) => safeStr(entry.beauty_service_id))));
  const missingProfessionalIds = expectedProfessionalIds.filter((id) => !finalProfessionalIds.has(id));
  const missingServiceIds = expectedServiceIds.filter((id) => !finalServiceIds.has(id));
  const duplicateProfessionalRelations = existingProfessionalIds.length - new Set(existingProfessionalIds).size;
  const duplicateServiceRelations = existingServiceIds.length - new Set(existingServiceIds).size;

  return {
    missingProfessionalIds,
    missingServiceIds,
    duplicateProfessionalRelations,
    duplicateServiceRelations,
    exactMatch:
      missingProfessionalIds.length === 0
      && missingServiceIds.length === 0
      && duplicateProfessionalRelations === 0
      && duplicateServiceRelations === 0,
  };
}

async function backfillBeautyScheduleRelations({
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
  const allRows = await OperationalSchedule().findAll({ where, order: [['created_at', 'ASC']] });
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
    createdServices: 0,
    alreadyMigrated: 0,
    ignoredSchedules: 0,
    noDataSchedules: 0,
    inconsistentSchedules: 0,
    processedBatches: 0,
    validation: {
      exactMatches: 0,
      missingProfessionalRelations: 0,
      missingServiceRelations: 0,
      duplicateProfessionalRelations: 0,
      duplicateServiceRelations: 0,
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

        if (!legacy.hasLegacyBeautyContext) {
          report.ignoredSchedules += 1;
          batchSummary.ignoredSchedules += 1;
          continue;
        }
        report.eligibleSchedules += 1;

        if (!legacy.hasMigrateableData) {
          report.noDataSchedules += 1;
          report.inconsistentSchedules += 1;
          batchSummary.inconsistentSchedules += 1;
          continue;
        }

        const [existingProfessionalRows, existingServiceRows] = await Promise.all([
          BeautyScheduleProfessional().findAll({ where: { tenant_key: tenantKey, operational_schedule_id: scheduleId } }),
          BeautyScheduleService().findAll({ where: { tenant_key: tenantKey, operational_schedule_id: scheduleId } }),
        ]);
        const existingProfessionalIds = new Set(existingProfessionalRows.map((entry) => safeStr(entry.beauty_professional_id)));
        const existingServiceIds = new Set(existingServiceRows.map((entry) => safeStr(entry.beauty_service_id)));

        const professionalCreates = legacy.professionalIds
          .filter((professionalId) => !existingProfessionalIds.has(professionalId))
          .map((professionalId) => ({
            id: newId('beautyschpro'),
            tenant_key: tenantKey,
            operational_schedule_id: scheduleId,
            beauty_professional_id: professionalId,
          }));
        const serviceCreates = legacy.serviceIds
          .filter((serviceId) => !existingServiceIds.has(serviceId))
          .map((serviceId) => ({
            id: newId('beautyschsvc'),
            tenant_key: tenantKey,
            operational_schedule_id: scheduleId,
            beauty_service_id: serviceId,
          }));

        const validation = summarizeValidation({
          expectedProfessionalIds: legacy.professionalIds,
          expectedServiceIds: legacy.serviceIds,
          existingProfessionalRows,
          existingServiceRows,
          plannedProfessionalCreates: professionalCreates,
          plannedServiceCreates: serviceCreates,
        });

        report.validation.missingProfessionalRelations += validation.missingProfessionalIds.length;
        report.validation.missingServiceRelations += validation.missingServiceIds.length;
        report.validation.duplicateProfessionalRelations += validation.duplicateProfessionalRelations;
        report.validation.duplicateServiceRelations += validation.duplicateServiceRelations;
        if (validation.exactMatch) {
          report.validation.exactMatches += 1;
        } else {
          report.inconsistentSchedules += 1;
          batchSummary.inconsistentSchedules += 1;
        }

        if (professionalCreates.length === 0 && serviceCreates.length === 0) {
          report.alreadyMigrated += 1;
          batchSummary.alreadyMigrated += 1;
          continue;
        }

        report.migrableSchedules += 1;
        report.touchedSchedules += 1;
        batchSummary.migrableSchedules += 1;

        if (!dryRun) {
          if (professionalCreates.length > 0) await BeautyScheduleProfessional().bulkCreate(professionalCreates);
          if (serviceCreates.length > 0) await BeautyScheduleService().bulkCreate(serviceCreates);
          report.migratedSchedules += 1;
          batchSummary.migratedSchedules += 1;
        }

        report.createdProfessionals += professionalCreates.length;
        report.createdServices += serviceCreates.length;
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
    const out = await backfillBeautyScheduleRelations({
      ...options,
      onBatch: (batch) => {
        process.stdout.write(`[beauty-backfill] batch=${batch.batchNumber} size=${batch.size} migrable=${batch.migrableSchedules} migrated=${batch.migratedSchedules} already=${batch.alreadyMigrated} inconsistent=${batch.inconsistentSchedules} errors=${batch.errors}\n`);
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
  backfillBeautyScheduleRelations,
  collectLegacyProfessionalIds,
  collectLegacyServiceIds,
  collectLegacyContext,
  parseCliArgs,
};
