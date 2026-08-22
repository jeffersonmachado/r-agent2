#!/usr/bin/env node
'use strict';

/**
 * rebind-scheduled-smoke.js
 *
 * Recria o binding do scheduled smoke apontando para a evidência prod-like
 * vigente, sem re-executar os testes de browser.
 *
 * Uso legítimo: quando a evidência prod-like foi regenerada (testes reais) e
 * o documento de binding (scheduled smoke) está desatualizado. Este script
 * lê a evidência real, valida sua integridade e emite um novo binding.
 *
 * Não cria evidência sintética: opera exclusivamente sobre artefatos
 * existentes gerados por execução real.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', '..');

const {
  validateReplayIntegrity,
} = require('../../api/services/qa/replayIntegrityService');
const { writeJsonAtomic } = require('../../api/utils/atomicJsonFile');

const PROD_LIKE_PATH = path.join(ROOT, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json');
const SCHEDULED_PATH = path.join(ROOT, 'qa', 'smoke', 'qa-waves-scheduled-operational-smoke.json');

const REQUIRED_JOURNEYS = ['support_ticket_flow', 'fitness_customer_checkin', 'booking_flow'];

const PRODUCTION_HEALTH_MODE = {
  id: 'production_health',
  label: 'Production health validation',
  realStack: true,
  journeys: REQUIRED_JOURNEYS,
  checks: ['replay_integrity', 'provenance_integrity', 'governance_consistency', 'operational_confidence'],
};

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function summarizeFlow(flow = {}) {
  const replay = flow.replay || {};
  const governance = replay.governance || flow.governance || {};
  const steps = Array.isArray(replay.steps) ? replay.steps : [];
  const failedSteps = steps.filter((s) => s?.status === 'failed');
  const missingEvidence = steps.flatMap((s) => Array.isArray(s?.missingEvidence) ? s.missingEvidence : []);
  const integrity = validateReplayIntegrity(replay, governance);
  return {
    journeyId: flow.journeyId,
    goNoGo: governance.goNoGo || (governance.isOperational ? 'GO' : 'NO_GO'),
    replayHash: replay.replayHash || null,
    replayChecksum: replay.replayChecksum || null,
    governanceSignature: replay.governanceSignature || null,
    integrityValid: integrity.valid,
    failedResidualSteps: failedSteps.map((s) => s.id || s.stepId || 'unknown'),
    missingEvidence,
    actionTypes: steps.map((s) => ({
      stepId: s.id || s.stepId || null,
      actionType: s.actionType || null,
      semanticContractActionType: s.semanticContract?.actionType || null,
    })),
  };
}

function main() {
  if (!fs.existsSync(PROD_LIKE_PATH)) {
    console.error('[rebind-scheduled-smoke] FAIL: prod-like evidence não encontrada:', PROD_LIKE_PATH);
    process.exit(1);
  }

  const prodLike = readJson(PROD_LIKE_PATH);

  // Validar que a evidência prod-like é real e está em GO
  if (prodLike.status !== 'GO') {
    console.error('[rebind-scheduled-smoke] FAIL: prod-like evidence status não é GO:', prodLike.status);
    process.exit(1);
  }
  if (prodLike.productionReadiness?.decision !== 'GO') {
    console.error('[rebind-scheduled-smoke] FAIL: prod-like productionReadiness não é GO');
    process.exit(1);
  }
  const env = prodLike.environment || {};
  if (
    env.mode !== 'prod_like_real_stack'
    || env.usedFixtureServer !== false
    || env.backend !== 'real_stack'
    || env.database !== 'real'
    || env.tenantIsolated !== true
  ) {
    console.error('[rebind-scheduled-smoke] FAIL: prod-like environment não é prod_like_real_stack real');
    process.exit(1);
  }

  const flows = (prodLike.flows || []).map(summarizeFlow);
  const presentJourneys = new Set(flows.map((f) => String(f.journeyId || '').trim()).filter(Boolean));

  // Verificar que todas as jornadas requeridas estão presentes
  const missingJourneys = PRODUCTION_HEALTH_MODE.journeys.filter((j) => !presentJourneys.has(j));
  if (missingJourneys.length > 0) {
    console.error('[rebind-scheduled-smoke] FAIL: jornadas requeridas ausentes:', missingJourneys);
    process.exit(1);
  }

  // Verificar integridade de todos os flows
  const integrityFailures = flows.filter((f) => !f.integrityValid);
  if (integrityFailures.length > 0) {
    console.error('[rebind-scheduled-smoke] FAIL: flows com integridade inválida:', integrityFailures.map((f) => f.journeyId));
    process.exit(1);
  }

  // Verificar que todos os flows requeridos são GO
  const notGoFlows = flows.filter((f) => PRODUCTION_HEALTH_MODE.journeys.includes(f.journeyId) && f.goNoGo !== 'GO');
  if (notGoFlows.length > 0) {
    console.error('[rebind-scheduled-smoke] FAIL: flows requeridos não são GO:', notGoFlows.map((f) => f.journeyId));
    process.exit(1);
  }

  const blockers = flows.flatMap((flow) => [
    ...(flow.goNoGo === 'GO' ? [] : [{ journeyId: flow.journeyId, reason: 'flow_not_go' }]),
    ...flow.failedResidualSteps.map((stepId) => ({ journeyId: flow.journeyId, reason: 'failed_residual_step', stepId })),
    ...flow.missingEvidence.map((field) => ({ journeyId: flow.journeyId, reason: 'missing_evidence', field })),
    ...(flow.integrityValid ? [] : [{ journeyId: flow.journeyId, reason: 'replay_integrity_invalid' }]),
    ...(flow.replayHash && flow.replayChecksum && flow.governanceSignature
      ? []
      : [{ journeyId: flow.journeyId, reason: 'replay_proof_missing' }]),
  ]);

  const evidenceSha256 = sha256File(PROD_LIKE_PATH);
  const governanceStatus = blockers.length === 0 && prodLike.productionReadiness?.decision === 'GO' ? 'GO' : 'NO_GO';

  const report = {
    generatedAt: new Date().toISOString(),
    scheduledMode: PRODUCTION_HEALTH_MODE,
    status: governanceStatus,
    governanceStatus,
    checks: PRODUCTION_HEALTH_MODE.checks,
    journeys: PRODUCTION_HEALTH_MODE.journeys,
    flows,
    blockers,
    evidencePath: PROD_LIKE_PATH,
    evidenceSha256,
    sourceGeneratedAt: prodLike.generatedAt || null,
    releaseEvidenceEligible: true,
  };

  writeJsonAtomic(SCHEDULED_PATH, report);

  console.log('[rebind-scheduled-smoke] OK:', {
    status: report.status,
    flows: flows.length,
    blockers: blockers.length,
    sourceGeneratedAt: report.sourceGeneratedAt,
    evidenceSha256: evidenceSha256.substring(0, 20) + '...',
    output: SCHEDULED_PATH,
  });

  if (report.status !== 'GO') {
    console.error('[rebind-scheduled-smoke] FAIL: status final não é GO');
    process.exit(1);
  }
}

main();
