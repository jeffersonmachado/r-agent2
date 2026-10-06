'use strict';

const { getSequelize } = require('../../db/sequelize');
const getGovernanceRun = require('../../db/models/GovernanceRun');
const getGate = require('../../db/models/GovernanceGateResult');
const getDecision = require('../../db/models/GovernanceFinalDecision');
const getEvaluation = require('../../db/models/ScorecardEvaluation');
const getGap = require('../../db/models/GovernanceGap');

const PASS = 'PASS';

function serviceError(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; return error; }

async function createRun(input, options = {}) {
  const sequelize = getSequelize();
  if (!sequelize) throw serviceError('governance_db_required', 'Sequelize não inicializado');
  if (!input?.runId || !/^[a-f0-9]{64}$/i.test(input.sourceFingerprint || '')) throw serviceError('governance_run_invalid', 'runId e sourceFingerprint SHA-256 são obrigatórios');
  const Model = getGovernanceRun();
  return sequelize.transaction(async (transaction) => Model.create({ run_id: input.runId, source_fingerprint: input.sourceFingerprint, status: 'CREATED', scope_type: input.scopeType || 'PLATFORM', tenant_id: input.tenantId || null, principal_type: input.principalType || 'SERVICE', principal_id: input.principalId || 'certification', git_commit: input.gitCommit || null, branch: input.branch || null, started_at: input.startedAt || new Date(), metadata: input.metadata || {} }, { transaction, ...options }));
}

async function recordGate({ runId, sourceFingerprint, gateKey, status, mandatory = true, reason, validator, evidenceReference, phase = 'POST_PACKAGE' }, options = {}) {
  const sequelize = getSequelize(); if (!sequelize) throw serviceError('governance_db_required', 'Sequelize não inicializado');
  return sequelize.transaction(async (transaction) => {
    const run = await getGovernanceRun().findOne({ where: { run_id: runId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!run) throw serviceError('governance_run_not_found', runId);
    if (run.source_fingerprint !== sourceFingerprint) { await run.update({ status: 'INVALIDATED', invalidated_at: new Date(), invalidated_reason: 'RUN_SOURCE_DRIFT' }, { transaction }); throw serviceError('RUN_SOURCE_DRIFT', runId); }
    return getGate().upsert({ run_id: runId, gate_key: gateKey, mandatory, status, reason: reason || null, validator: validator || null, evidence_reference: evidenceReference || null, source_fingerprint: sourceFingerprint, completed_at: new Date(), metadata: { phase } }, { transaction, ...options });
  });
}

async function calculateFinalDecision({ runId, sourceFingerprint, proofFingerprint, packageFingerprint, phase = 'POST_PACKAGE' }, options = {}) {
  const sequelize = getSequelize(); if (!sequelize) throw serviceError('governance_db_required', 'Sequelize não inicializado');
  return sequelize.transaction({ isolationLevel: sequelize.constructor.Transaction.ISOLATION_LEVELS.REPEATABLE_READ }, async (transaction) => {
    const run = await getGovernanceRun().findOne({ where: { run_id: runId }, transaction, lock: transaction.LOCK.UPDATE });
    if (!run) throw serviceError('governance_run_not_found', runId);
    if (run.source_fingerprint !== sourceFingerprint || run.status === 'INVALIDATED') throw serviceError('RUN_SOURCE_DRIFT', runId);
    if (!run.policy_id || !run.policy_version || !run.policy_fingerprint) throw serviceError('RUN_POLICY_DRIFT', runId);
    const [gates, evaluation, openGaps] = await Promise.all([
      getGate().findAll({ where: { run_id: runId, mandatory: true }, transaction, lock: transaction.LOCK.UPDATE }),
      getEvaluation().findOne({ where: { run_id: runId }, order: [['created_at', 'DESC']], transaction, lock: transaction.LOCK.UPDATE }),
      getGap().findAll({ where: { run_id: runId, status: ['OPEN', 'IN_PROGRESS', 'FIXED'] }, transaction, lock: transaction.LOCK.UPDATE }),
    ]);
    const failedGates = gates.filter((gate) => {
      if (gate.status === PASS) return false;
      // DEFERRED só é aceitável em PRE_PACKAGE. Em POST_PACKAGE/DELIVERED,
      // um gate ainda DEFERRED é blocker (fail-closed).
      if (gate.status === 'DEFERRED' && phase === 'PRE_PACKAGE') return false;
      return true;
    });
    const below10 = evaluation ? (evaluation.dimensions_below_10 || 0) : 1;
    const missingMandatoryGates = gates.length === 0 ? 1 : 0;
    const decision = failedGates.length || missingMandatoryGates || below10 || openGaps.length ? 'NO_GO' : 'AUTONOMOUS_READY';
    const payload = { run_id: runId, decision, reason: decision === 'NO_GO' ? 'Mandatory gates, scorecard or open gaps prevent readiness.' : 'All persisted certification predicates passed.', mandatory_gate_failures: failedGates.length + missingMandatoryGates, scorecard_below_10: below10, source_fingerprint: sourceFingerprint, proof_fingerprint: proofFingerprint || null, package_fingerprint: packageFingerprint || null, metadata: { gateCount: gates.length, openGapCount: openGaps.length, evaluationPresent: Boolean(evaluation), phase } };
    // Recalcula e sobrescreve a decisão a cada execução: findOrCreate deixaria
    // um registro NO_GO antigo preso após a transição NO_GO -> AUTONOMOUS_READY.
    const [record] = await getDecision().upsert(payload, { transaction, ...options });
    // O DESFECHO DO RUN É DO CICLO, NÃO DA FASE.
    // Em `PRE_PACKAGE` os gaps abertos e `below10` são ESPERADOS: as dimensões do
    // pacote (RAP-052/054) e as DELIVERED (RAP-055/056) ainda não são verificáveis
    // porque o pacote não existe. Marcar FAILED aqui encerrava o ciclo no meio e,
    // como `RUN_STATUS_NOT_CERTIFIABLE` invalidava cada requisito, o scorecard
    // inteiro caía (78/78 below10 medido em 2026-10-06) => `seal-time-gate`
    // SEAL_NO_GO => `prepare` abortava => laço fechado (repetir o ciclo reproduzia
    // o mesmo estado). Só `AUTONOMOUS_READY` conclui; `FAILED` é reservado ao
    // NO_GO de fase TERMINAL (POST_PACKAGE/DELIVERED), onde não há mais o que
    // construir — fail-closed preservado.
    const terminalStatus = decision === 'AUTONOMOUS_READY'
      ? 'COMPLETED'
      : (phase === 'PRE_PACKAGE' ? null : 'FAILED');
    if (terminalStatus) {
      await run.update({ status: terminalStatus, completed_at: new Date() }, { transaction });
    }
    return { record, decision, mandatoryGateFailures: failedGates.length + missingMandatoryGates, scorecardBelow10: below10, openGaps: openGaps.length, runStatus: terminalStatus || run.status };
  });
}

module.exports = { createRun, recordGate, calculateFinalDecision, serviceError };