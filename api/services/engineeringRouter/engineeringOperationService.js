'use strict';

/**
 * api/services/engineeringRouter/engineeringOperationService.js — ER-V1-SEAL-002 (Full Durable
 * Resume).
 *
 * Persistência real (sem fallback em memória — convenção do projeto: `persistence_required`) do
 * controle de idempotência por fase (`EngineeringOperation`). Reconcilia cada chamada com
 * `engine/engineeringRouter/operationReconciler.js` (política pura) a partir do estado JÁ
 * PERSISTIDO — nunca de estado em memória, que não sobrevive a um crash.
 */

const crypto = require('crypto');
const getEngineeringOperationModel = require('../../db/models/EngineeringOperation');
const { reconcileOperation } = require('../../../engine/engineeringRouter/operationReconciler');
const logger = require('../../utils/logger');

function toPlain(row) {
  return row.get ? row.get({ plain: true }) : row;
}

function buildIdempotencyKey({ taskId, attemptId, phase }) {
  return `task:${taskId}:attempt:${attemptId || 'none'}:phase:${phase}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Ponto de entrada único antes de executar qualquer efeito colateral não idempotente de uma
 * fase. Nunca decide sozinho o que fazer com RECONCILE/FAIL_SAFE/MANUAL_REQUIRED — devolve a
 * decisão para o chamador, que tem o contexto de domínio (ex.: como checar evidência externa
 * real) para agir corretamente.
 *
 * @returns {Promise<{action:string, reason?:string, operation:object}>}
 */
async function beginOrReconcile({ taskId, attemptId, phase }) {
  const Model = getEngineeringOperationModel();
  const idempotencyKey = buildIdempotencyKey({ taskId, attemptId, phase });
  const existingRow = await Model.findOne({ where: { idempotency_key: idempotencyKey } });
  const existingOperation = existingRow ? toPlain(existingRow) : null;

  const decision = reconcileOperation({
    existingOperation: existingOperation ? { status: existingOperation.status, startedAt: existingOperation.started_at } : null,
  });

  if (decision.action === 'RUN') {
    const now = new Date();
    if (existingOperation && existingOperation.status === 'PENDING') {
      await existingRow.update({ status: 'RUNNING', started_at: now });
      return { action: 'RUN', operation: toPlain(existingRow) };
    }
    const row = await Model.create({
      task_id: taskId,
      attempt_id: attemptId || null,
      phase,
      idempotency_key: idempotencyKey,
      status: 'RUNNING',
      started_at: now,
    });
    return { action: 'RUN', operation: toPlain(row) };
  }

  if (decision.action === 'RETRY') {
    const now = new Date();
    await existingRow.update({ status: 'RUNNING', started_at: now, completed_at: null, error: null });
    return { action: 'RETRY', operation: toPlain(existingRow) };
  }

  // RESUME/RECONCILE/FAIL_SAFE/MANUAL_REQUIRED: nunca muta o registro aqui — o chamador decide.
  return { action: decision.action, reason: decision.reason, operation: existingOperation };
}

async function completeOperation(operationId, { evidenceRef = null, result = null } = {}) {
  const Model = getEngineeringOperationModel();
  const row = await Model.findByPk(operationId);
  if (!row) {
    throw Object.assign(new Error('EngineeringOperation não encontrada'), { code: 'not_found' });
  }
  const resultHash = result !== null ? sha256(JSON.stringify(result)) : null;
  await row.update({ status: 'SUCCEEDED', completed_at: new Date(), evidence_ref: evidenceRef, result_hash: resultHash });
  return toPlain(row);
}

async function failOperation(operationId, { error } = {}) {
  const Model = getEngineeringOperationModel();
  const row = await Model.findByPk(operationId);
  if (!row) {
    throw Object.assign(new Error('EngineeringOperation não encontrada'), { code: 'not_found' });
  }
  await row.update({ status: 'FAILED', completed_at: new Date(), error: error ? { message: error.message, code: error.code } : null });
  return toPlain(row);
}

/**
 * Usado quando RECONCILE não consegue confirmar univocamente, a partir de evidência externa
 * real, se o efeito colateral aconteceu ou não — nunca finge saber. Fica UNKNOWN até
 * intervenção/reconciliação manual ou uma nova reconciliação bem-sucedida.
 */
async function markUnknown(operationId, { reason } = {}) {
  const Model = getEngineeringOperationModel();
  const row = await Model.findByPk(operationId);
  if (!row) {
    throw Object.assign(new Error('EngineeringOperation não encontrada'), { code: 'not_found' });
  }
  logger.warn('[engineeringOperationService] operation marcada UNKNOWN_REQUIRES_RECONCILIATION', { operationId, reason });
  await row.update({ status: 'UNKNOWN_REQUIRES_RECONCILIATION', error: { reason } });
  return toPlain(row);
}

/**
 * Resolve conscientemente um `RECONCILE` quando o CHAMADOR (que tem contexto de domínio sobre
 * o que a fase faz) confirmou que é seguro reexecutar do zero — nunca decidido automaticamente
 * pelo reconciler. Uso correto: fases cujo efeito colateral é idempotente por natureza (ex.:
 * rodar comandos de regressão/governança de novo não duplica nada irreversível, só tem custo).
 * NUNCA usar para fases com efeito real irreversível (ex.: PROMOTING) sem antes confirmar via
 * `resumeWithEvidence` que o efeito não aconteceu.
 */
async function forceRun(operationId, { reason } = {}) {
  const Model = getEngineeringOperationModel();
  const row = await Model.findByPk(operationId);
  if (!row) {
    throw Object.assign(new Error('EngineeringOperation não encontrada'), { code: 'not_found' });
  }
  logger.warn('[engineeringOperationService] RECONCILE resolvido conscientemente como seguro para RUN — efeito considerado idempotente pelo chamador', { operationId, reason });
  await row.update({ status: 'RUNNING', started_at: new Date(), completed_at: null, error: null });
  return toPlain(row);
}

/**
 * Resolve conscientemente um `RECONCILE` quando o CHAMADOR confirmou, via EVIDÊNCIA EXTERNA REAL
 * (ex.: a branch candidata já existe no git apontando para o commit esperado), que o efeito
 * colateral JÁ ACONTECEU antes do crash — marca SUCCEEDED sem jamais reexecutar o efeito.
 */
async function resumeWithEvidence(operationId, { evidenceRef = null, result = null, reason } = {}) {
  const Model = getEngineeringOperationModel();
  const row = await Model.findByPk(operationId);
  if (!row) {
    throw Object.assign(new Error('EngineeringOperation não encontrada'), { code: 'not_found' });
  }
  logger.info('[engineeringOperationService] RECONCILE resolvido via evidência externa real — efeito já havia acontecido, nunca reexecutado', { operationId, reason });
  const resultHash = result !== null ? sha256(JSON.stringify(result)) : null;
  await row.update({ status: 'SUCCEEDED', completed_at: new Date(), evidence_ref: evidenceRef, result_hash: resultHash });
  return toPlain(row);
}

async function getOperationByPhase({ taskId, attemptId, phase }) {
  const Model = getEngineeringOperationModel();
  const idempotencyKey = buildIdempotencyKey({ taskId, attemptId, phase });
  const row = await Model.findOne({ where: { idempotency_key: idempotencyKey } });
  return row ? toPlain(row) : null;
}

module.exports = {
  buildIdempotencyKey,
  beginOrReconcile,
  completeOperation,
  failOperation,
  markUnknown,
  forceRun,
  resumeWithEvidence,
  getOperationByPhase,
};
