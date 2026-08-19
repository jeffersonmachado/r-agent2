'use strict';

const getLearningRecordModel = require('../../db/models/LearningRecord');
const logger = require('../../utils/logger');

// Fail-closed: o service exige tenant explícito do caller (o boundary HTTP
// garante); sem tenant, lança TENANT_REQUIRED em vez de persistir/consultar o
// tenant 'system' por fallback silencioso.
function requireTenantId(tenantId) {
  const tid = typeof tenantId === 'string' ? tenantId.trim() : tenantId;
  if (!tid) throw Object.assign(new Error('tenantId é obrigatório'), { code: 'TENANT_REQUIRED' });
  return tid;
}

async function recordFailure({ tenantId, source, sourceRef, classification, metrics }) {
  const LearningRecord = getLearningRecordModel();
  return LearningRecord.create({
    tenant_id: requireTenantId(tenantId),
    type: 'failure',
    source: source || null,
    sourceRef: sourceRef || null,
    classification: classification || null,
    metrics: metrics || {},
    status: 'detected',
  });
}

async function classifyFailure(id, classification, rootCause, tenantId) {
  const LearningRecord = getLearningRecordModel();
  const record = await LearningRecord.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
  if (!record) return null;

  record.classification = classification;
  record.rootCause = rootCause || null;
  record.status = 'classified';
  await record.save();
  return record;
}

async function generateSuggestion(id, suggestion, tenantId) {
  const LearningRecord = getLearningRecordModel();
  const record = await LearningRecord.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
  if (!record) return null;

  record.suggestion = suggestion;
  record.status = 'suggested';
  await record.save();
  return record;
}

async function validateSuggestion(id, validationResult, tenantId) {
  const LearningRecord = getLearningRecordModel();
  const record = await LearningRecord.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
  if (!record) return null;

  record.validationResult = validationResult;
  record.status = validationResult.passed ? 'validated' : 'rejected';
  await record.save();
  return record;
}

async function promoteToProduction(id, promotedBy, tenantId) {
  const LearningRecord = getLearningRecordModel();
  const record = await LearningRecord.findOne({ where: { id, tenant_id: requireTenantId(tenantId) } });
  if (!record) return null;

  record.status = 'promoted';
  record.promotedAt = new Date();
  record.promotedBy = promotedBy || null;
  record.type = 'promotion';
  await record.save();
  return record;
}

async function listLearningRecords({ tenantId, filters = {} }) {
  const LearningRecord = getLearningRecordModel();
  const where = { tenant_id: requireTenantId(tenantId) };

  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  if (filters.classification) where.classification = filters.classification;

  return LearningRecord.findAll({ where, order: [['created_at', 'DESC']], limit: filters.limit || 100 });
}

async function detectRegressions({ tenantId, windowHours = 24 }) {
  const LearningRecord = getLearningRecordModel();
  const { Op } = require('sequelize');

  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  return LearningRecord.findAll({
    where: {
      tenant_id: requireTenantId(tenantId),
      type: { [Op.in]: ['failure', 'regression'] },
      created_at: { [Op.gte]: since },
    },
    order: [['created_at', 'DESC']],
  });
}

module.exports = {
  recordFailure,
  classifyFailure,
  generateSuggestion,
  validateSuggestion,
  promoteToProduction,
  listLearningRecords,
  detectRegressions,
};
