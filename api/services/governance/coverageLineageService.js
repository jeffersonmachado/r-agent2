'use strict';

const crypto = require('crypto');

function coverageError(code, message) { const error = new Error(`${code}: ${message}`); error.code = code; return error; }
const STATES = ['DISCOVERED', 'INFERRED', 'TARGETED', 'EXECUTED', 'VALIDATED'];

function createCoverageLineageService({ sequelize, GovernanceRun, CoverageEvidence, Evidence, clock = () => new Date() }) {
  async function loadRun(context, transaction) {
    const run = await GovernanceRun.findOne({ where: { run_id: context.runId, tenant_id: context.tenantId }, transaction, lock: transaction?.LOCK?.UPDATE });
    if (!run) throw coverageError('GOVERNANCE_RUN_NOT_FOUND', context.runId);
    if (run.source_fingerprint !== context.sourceFingerprint) throw coverageError('RUN_SOURCE_DRIFT', context.runId);
    if (run.status !== 'RUNNING') throw coverageError('GOVERNANCE_RUN_NOT_RUNNING', run.status);
    return run;
  }
  async function recordTransition(context) {
    return sequelize.transaction(async (transaction) => {
      await loadRun(context, transaction);
      const previous = await CoverageEvidence.findOne({ where: { run_id: context.runId, journey_id: context.journeyId, scenario_id: context.scenarioId, step_id: context.stepId }, order: [['created_at', 'DESC']], transaction, lock: transaction?.LOCK?.UPDATE });
      const expectedIndex = previous ? STATES.indexOf(previous.coverage_state) + 1 : 0;
      if (STATES.indexOf(context.coverageState) !== expectedIndex) throw coverageError('COVERAGE_INVALID_TRANSITION', `${previous?.coverage_state || 'NONE'} -> ${context.coverageState}`);
      if (context.coverageState === 'VALIDATED') {
        if (!context.evidenceId) throw coverageError('COVERAGE_EVIDENCE_REQUIRED', context.journeyId);
        const evidence = await Evidence.findOne({ where: { id: context.evidenceId, tenant_key: context.tenantId }, transaction });
        if (!evidence) throw coverageError('COVERAGE_EVIDENCE_NOT_FOUND', context.evidenceId);
      }
      const prevHash = previous?.hash || 'GENESIS';
      const record = { run_id: context.runId, journey_id: context.journeyId, scenario_id: context.scenarioId, step_id: context.stepId, inventory_item_id: context.inventoryItemId, coverage_state: context.coverageState, evidence_id: context.evidenceId || null, validated_at: context.coverageState === 'VALIDATED' ? new Date(context.occurredAt || clock()) : null, timestamp: context.occurredAt || clock(), metadata: context.metadata || {} };
      record.hash = crypto.createHash('sha256').update(JSON.stringify({ ...record, prevHash })).digest('hex');
      record.prev_hash = prevHash;
      return CoverageEvidence.create({ ...record, record }, { transaction });
    });
  }
  async function getLineage(context) {
    const items = await CoverageEvidence.findAll({ where: { run_id: context.runId, journey_id: context.journeyId, scenario_id: context.scenarioId, step_id: context.stepId }, order: [['created_at', 'ASC']] });
    return { items, currentState: items.at(-1)?.coverage_state || null, total: items.length };
  }
  return { recordTransition, getLineage };
}

module.exports = { createCoverageLineageService, coverageError, STATES };