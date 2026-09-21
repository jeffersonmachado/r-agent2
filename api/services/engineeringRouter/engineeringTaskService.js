'use strict';

/**
 * api/services/engineeringRouter/engineeringTaskService.js
 *
 * CRUD + state machine + lock de concorrência para EngineeringTask. Persistência real via
 * Sequelize — sem fallback em memória (convenção do projeto: `persistence_required`).
 */

const { Op } = require('sequelize');
const getEngineeringTaskModel = require('../../db/models/EngineeringTask');
const getEngineeringAttemptModel = require('../../db/models/EngineeringAttempt');
const getEngineeringTestRunModel = require('../../db/models/EngineeringTestRun');
const getEngineeringReviewModel = require('../../db/models/EngineeringReview');
const getEngineeringTelemetryEventModel = require('../../db/models/EngineeringTelemetryEvent');
const { classify } = require('../../../engine/engineeringRouter/taskClassifier');
const { resolveMaxIterations } = require('../../../engine/engineeringRouter/routingPolicy');
const { assertTransition, isTerminal } = require('../../../engine/engineeringRouter/stateMachine');
const { TASK_TYPES, RISK_LEVELS, TASK_SCOPES, FAILURE_CODES } = require('../../../engine/engineeringRouter/constants');
const logger = require('../../utils/logger');

const LOCK_STALE_MS = Number(process.env.ENGINEERING_ROUTER_LOCK_STALE_MS || 15 * 60 * 1000);

function persistenceRequiredError(detail) {
  const err = new Error(`persistence_required: ${detail}`);
  err.code = 'persistence_required';
  return err;
}

/**
 * Cria uma EngineeringTask a partir de um Task Contract (parcial), classifica
 * deterministicamente e persiste. Idempotente por `idempotencyKey`: uma segunda chamada com a
 * mesma chave retorna a task já existente em vez de duplicar.
 */
async function createTask(input = {}, { createdBy = null, idempotencyKey = null } = {}) {
  const Model = getEngineeringTaskModel();
  if (!Model || typeof Model.create !== 'function') throw persistenceRequiredError('EngineeringTask model indisponível');

  if (idempotencyKey) {
    const existing = await Model.findOne({ where: { idempotency_key: idempotencyKey } });
    if (existing) return toPlain(existing);
  }

  const classification = classify(input, { failingTests: input.failingTests || [] });
  const maxIterations = resolveMaxIterations(classification.taskType, input.maxIterations);

  let row;
  try {
    row = await Model.create({
      title: input.title || input.objective || 'EngineeringTask sem título',
      objective: input.objective || null,
      task_type: classification.taskType,
      risk: classification.risk,
      scope: classification.scope,
      required_capabilities: classification.requiredCapabilities,
      allowed_paths: Array.isArray(input.allowedPaths) ? input.allowedPaths : [],
      forbidden_paths: Array.isArray(input.forbiddenPaths) ? input.forbiddenPaths : [],
      acceptance_criteria: Array.isArray(input.acceptanceCriteria) ? input.acceptanceCriteria : [],
      test_commands: Array.isArray(input.testCommands) ? input.testCommands : [],
      max_iterations: maxIterations,
      status: 'CLASSIFIED',
      release_blocker: Boolean(input.releaseBlocker),
      classification: 'DEVELOPMENT',
      created_by: createdBy,
      idempotency_key: idempotencyKey,
      classifier_result: classification,
      routing_decision: {},
    });
  } catch (err) {
    // Corrida em idempotência: outra chamada concorrente já criou com a mesma chave.
    if (idempotencyKey && /unique/i.test(err.message || '')) {
      const existing = await Model.findOne({ where: { idempotency_key: idempotencyKey } });
      if (existing) return toPlain(existing);
    }
    throw err;
  }

  return toPlain(row);
}

function toPlain(row) {
  return row.get ? row.get({ plain: true }) : row;
}

async function getTask(taskId) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  return row ? toPlain(row) : null;
}

async function listTasks({ status, risk, taskType, limit = 50, offset = 0 } = {}) {
  const Model = getEngineeringTaskModel();
  const where = {};
  if (status) where.status = status;
  if (risk) where.risk = risk;
  if (taskType) where.task_type = taskType;
  const rows = await Model.findAll({
    where,
    order: [['updated_at', 'DESC']],
    limit: Math.min(Number(limit) || 50, 200),
    offset: Number(offset) || 0,
  });
  return rows.map(toPlain);
}

/**
 * Transiciona a task para um novo estado, validando contra a state machine. Nunca aplica
 * transição inválida silenciosamente.
 */
async function transitionTask(taskId, toStatus, extra = {}) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });
  assertTransition(row.status, toStatus);
  await row.update({ status: toStatus, ...extra });
  return toPlain(row);
}

/**
 * Adquire lock de execução exclusivo (evita rodar a mesma task duas vezes simultaneamente).
 * Locks mais velhos que LOCK_STALE_MS são considerados órfãos (processo morreu no meio de uma
 * execução) e podem ser retomados — restart-safe behavior.
 */
async function lockForRun(taskId, runnerId) {
  const Model = getEngineeringTaskModel();
  const sequelize = Model.sequelize;
  const now = new Date();

  return sequelize.transaction(async (t) => {
    const row = await Model.findByPk(taskId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });

    if (isTerminal(row.status)) {
      const err = new Error(`Task já está em estado terminal: ${row.status}`);
      err.code = 'TASK_TERMINAL';
      err.status = row.status;
      throw err;
    }

    const lockedAt = row.locked_at ? new Date(row.locked_at) : null;
    const lockIsStale = lockedAt && (now.getTime() - lockedAt.getTime() > LOCK_STALE_MS);

    if (lockedAt && !lockIsStale) {
      const err = new Error('EngineeringTask já está em execução');
      err.code = FAILURE_CODES.TASK_ALREADY_RUNNING;
      err.lockedBy = row.locked_by;
      err.lockedAt = row.locked_at;
      throw err;
    }

    if (lockIsStale) {
      logger.warn('[engineeringTaskService] recuperando lock órfão (restart-safe)', { taskId, previousOwner: row.locked_by, lockedAt: row.locked_at });
    }

    await row.update({ locked_at: now, locked_by: runnerId }, { transaction: t });
    return toPlain(row);
  });
}

async function unlockTask(taskId) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) return null;
  await row.update({ locked_at: null, locked_by: null });
  return toPlain(row);
}

async function saveRoutingDecision(taskId, routingDecision) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) throw Object.assign(new Error('EngineeringTask não encontrada'), { code: 'not_found' });
  await row.update({ routing_decision: routingDecision });
  return toPlain(row);
}

async function saveLastError(taskId, error) {
  const Model = getEngineeringTaskModel();
  const row = await Model.findByPk(taskId);
  if (!row) return null;
  await row.update({ last_error: { message: error.message, code: error.code || null, at: new Date().toISOString() } });
  return toPlain(row);
}

/** Próximo número de tentativa (retry não cria nova task — attempt sequencial). */
async function nextAttemptNumber(taskId) {
  const AttemptModel = getEngineeringAttemptModel();
  const count = await AttemptModel.count({ where: { task_id: taskId } });
  return count + 1;
}

async function createAttempt(taskId, data = {}) {
  const AttemptModel = getEngineeringAttemptModel();
  const attemptNumber = await nextAttemptNumber(taskId);
  const row = await AttemptModel.create({
    task_id: taskId,
    attempt_number: attemptNumber,
    status: data.status || 'PENDING',
    started_at: new Date(),
    ...data,
  });
  return toPlain(row);
}

async function updateAttempt(attemptId, data = {}) {
  const AttemptModel = getEngineeringAttemptModel();
  const row = await AttemptModel.findByPk(attemptId);
  if (!row) throw Object.assign(new Error('EngineeringAttempt não encontrada'), { code: 'not_found' });
  await row.update(data);
  return toPlain(row);
}

async function listAttempts(taskId) {
  const AttemptModel = getEngineeringAttemptModel();
  const rows = await AttemptModel.findAll({ where: { task_id: taskId }, order: [['attempt_number', 'ASC']] });
  return rows.map(toPlain);
}

async function getAttempt(attemptId) {
  const AttemptModel = getEngineeringAttemptModel();
  const row = await AttemptModel.findByPk(attemptId);
  return row ? toPlain(row) : null;
}

async function createTestRun(attemptId, data = {}) {
  const Model = getEngineeringTestRunModel();
  const row = await Model.create({ attempt_id: attemptId, ...data });
  return toPlain(row);
}

async function updateTestRun(testRunId, data = {}) {
  const Model = getEngineeringTestRunModel();
  const row = await Model.findByPk(testRunId);
  if (!row) throw Object.assign(new Error('EngineeringTestRun não encontrada'), { code: 'not_found' });
  await row.update(data);
  return toPlain(row);
}

async function listTestRuns(attemptId) {
  const Model = getEngineeringTestRunModel();
  const rows = await Model.findAll({ where: { attempt_id: attemptId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

async function createReview(attemptId, data = {}) {
  const Model = getEngineeringReviewModel();
  const row = await Model.create({ attempt_id: attemptId, ...data });
  return toPlain(row);
}

async function listReviews(attemptId) {
  const Model = getEngineeringReviewModel();
  const rows = await Model.findAll({ where: { attempt_id: attemptId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

async function recordTelemetry(data = {}) {
  const Model = getEngineeringTelemetryEventModel();
  const row = await Model.create(data);
  return toPlain(row);
}

async function listTelemetry(taskId) {
  const Model = getEngineeringTelemetryEventModel();
  const rows = await Model.findAll({ where: { task_id: taskId }, order: [['created_at', 'ASC']] });
  return rows.map(toPlain);
}

async function computeOverview() {
  const Model = getEngineeringTaskModel();
  const [total, green, red, running, blocked, releaseBlockers] = await Promise.all([
    Model.count(),
    Model.count({ where: { status: 'GREEN' } }),
    Model.count({ where: { status: 'RED' } }),
    Model.count({ where: { status: { [Op.notIn]: ['GREEN', 'RED', 'BLOCKED', 'CANCELLED'] } } }),
    Model.count({ where: { status: 'BLOCKED' } }),
    Model.count({ where: { release_blocker: true, status: { [Op.notIn]: ['GREEN', 'CANCELLED'] } } }),
  ]);
  const active = await Model.findAll({
    where: { status: { [Op.notIn]: ['GREEN', 'RED', 'BLOCKED', 'CANCELLED'] } },
    order: [['updated_at', 'DESC']],
    limit: 20,
  });
  return {
    totals: { total, green, red, running, blocked, releaseBlockers },
    activeTasks: active.map(toPlain),
  };
}

module.exports = {
  TASK_TYPES,
  RISK_LEVELS,
  TASK_SCOPES,
  createTask,
  getTask,
  listTasks,
  transitionTask,
  lockForRun,
  unlockTask,
  saveRoutingDecision,
  saveLastError,
  createAttempt,
  updateAttempt,
  listAttempts,
  getAttempt,
  nextAttemptNumber,
  createTestRun,
  updateTestRun,
  listTestRuns,
  createReview,
  listReviews,
  recordTelemetry,
  listTelemetry,
  computeOverview,
};
