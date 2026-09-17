'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { runFinalOperationalSmoke } = require('./qa-waves-operational-final-smoke');
const { validateReplayIntegrity } = require('../../api/services/qa/replayIntegrityService');
const { writeJsonAtomic } = require('../../api/utils/atomicJsonFile');

const REQUIRED_OPERATIONAL_JOURNEYS = Object.freeze([
  'support_ticket_flow',
  'fitness_customer_checkin',
  'booking_flow',
]);

const SCHEDULED_MODES = {
  hourly_lightweight: {
    id: 'hourly_lightweight',
    label: 'Hourly lightweight validation',
    realStack: false,
    journeys: [...REQUIRED_OPERATIONAL_JOURNEYS],
    checks: ['replay_integrity', 'provenance_integrity', 'governance_consistency'],
  },
  nightly_full_replay: {
    id: 'nightly_full_replay',
    label: 'Nightly full replay validation',
    realStack: true,
    journeys: [...REQUIRED_OPERATIONAL_JOURNEYS],
    checks: ['replay_integrity', 'provenance_integrity', 'governance_consistency', 'exact_mutations', 'exact_side_effects'],
  },
  pre_release_governance: {
    id: 'pre_release_governance',
    label: 'Pre-release governance validation',
    realStack: true,
    journeys: [...REQUIRED_OPERATIONAL_JOURNEYS],
    checks: ['replay_integrity', 'provenance_integrity', 'governance_consistency', 'tenant_isolation'],
  },
  production_health: {
    id: 'production_health',
    label: 'Production health validation',
    realStack: true,
    journeys: [...REQUIRED_OPERATIONAL_JOURNEYS],
    checks: ['replay_integrity', 'provenance_integrity', 'governance_consistency', 'operational_confidence'],
  },
};

function resolveMode(value) {
  const mode = String(value || process.env.QA_WAVES_SCHEDULED_MODE || 'hourly_lightweight');
  return SCHEDULED_MODES[mode] || SCHEDULED_MODES.hourly_lightweight;
}

function summarizeFlow(flow = {}) {
  const replay = flow.replay || {};
  const governance = replay.governance || flow.governance || {};
  const steps = Array.isArray(replay.steps) ? replay.steps : [];
  const failedSteps = steps.filter((step) => step?.status === 'failed');
  const missingEvidence = steps.flatMap((step) => Array.isArray(step?.missingEvidence) ? step.missingEvidence : []);
  const integrity = validateReplayIntegrity(replay, governance);
  return {
    journeyId: flow.journeyId,
    goNoGo: governance.goNoGo || (governance.isOperational ? 'GO' : 'NO_GO'),
    replayHash: replay.replayHash || null,
    replayChecksum: replay.replayChecksum || null,
    governanceSignature: replay.governanceSignature || null,
    integrityValid: integrity.valid,
    failedResidualSteps: failedSteps.map((step) => step.id || step.stepId || 'unknown'),
    missingEvidence,
    actionTypes: steps.map((step) => ({
      stepId: step.id || step.stepId || null,
      actionType: step.actionType || null,
      semanticContractActionType: step.semanticContract?.actionType || null,
    })),
  };
}

async function runScheduledOperationalSmoke(options = {}) {
  const scheduledMode = resolveMode(options.mode);
  const forceRealStack = options.realStack ?? scheduledMode.realStack;
  const previousProdLike = process.env.RUN_QA_WAVES_PROD_LIKE_SMOKE;
  const previousTestDatabaseUrl = process.env.TEST_DATABASE_URL;
  if (forceRealStack) {
    process.env.RUN_QA_WAVES_PROD_LIKE_SMOKE = '1';
    // A stack prod-like (docker-compose.yml) escreve no Postgres do container,
    // exposto no host (porta resolvida pelo wrapper shell via `docker port`,
    // fallback PG_HOST_PORT/5432). O observador host-side (stateSnapshotService)
    // precisa ler o MESMO banco, senão os snapshots before/after não veem as
    // mutações reais (mutation_provenance_missing). TEST_DATABASE_URL tem
    // prioridade máxima em api/utils/config.getDatabaseUrl() e é o mecanismo
    // canônico para processos host que observam um banco diferente do dev.
    // Credenciais default = as do serviço postgres do docker-compose.yml;
    // PGUSER/PGPASSWORD do ambiente NÃO são herdados aqui porque no .env eles
    // costumam apontar para o banco de DEV.
    if (previousTestDatabaseUrl === undefined) {
      const pgPort = process.env.PG_HOST_PORT || '5432';
      process.env.TEST_DATABASE_URL = `postgresql://results_app:StrongPass@127.0.0.1:${pgPort}/results_saas`;
    }
  } else if (!previousProdLike) {
    process.env.RUN_QA_WAVES_PROD_LIKE_SMOKE = '0';
  }

  const summary = await runFinalOperationalSmoke({
    outDir: options.outDir,
    headless: options.headless,
    timeout: options.timeout,
  });

  if (previousProdLike === undefined) {
    delete process.env.RUN_QA_WAVES_PROD_LIKE_SMOKE;
  } else {
    process.env.RUN_QA_WAVES_PROD_LIKE_SMOKE = previousProdLike;
  }
  if (forceRealStack && previousTestDatabaseUrl === undefined) {
    delete process.env.TEST_DATABASE_URL;
  }

  const flows = Array.isArray(summary.flows) ? summary.flows.map(summarizeFlow) : [];
  const presentJourneys = new Set(flows.map((flow) => String(flow.journeyId || '').trim()).filter(Boolean));
  const blockers = [
    ...scheduledMode.journeys
      .filter((journeyId) => !presentJourneys.has(journeyId))
      .map((journeyId) => ({ journeyId, reason: 'scheduled_journey_missing' })),
    ...flows.flatMap((flow) => [
    ...(flow.goNoGo === 'GO' ? [] : [{ journeyId: flow.journeyId, reason: 'flow_not_go' }]),
    ...flow.failedResidualSteps.map((stepId) => ({ journeyId: flow.journeyId, reason: 'failed_residual_step', stepId })),
    ...flow.missingEvidence.map((field) => ({ journeyId: flow.journeyId, reason: 'missing_evidence', field })),
    ...(flow.integrityValid ? [] : [{ journeyId: flow.journeyId, reason: 'replay_integrity_invalid' }]),
    ...(
      flow.replayHash && flow.replayChecksum && flow.governanceSignature
        ? []
        : [{ journeyId: flow.journeyId, reason: 'replay_proof_missing' }]
    ),
  ]),
  ];
  const governanceStatus = forceRealStack
    ? (summary.productionReadiness?.decision || summary.status || 'NO_GO')
    : (summary.status || 'NO_GO');
  const evidencePath = typeof summary.evidencePath === 'string' ? path.resolve(summary.evidencePath) : null;
  const evidenceValid = Boolean(evidencePath && fs.existsSync(evidencePath) && fs.statSync(evidencePath).isFile());
  if (!evidenceValid) {
    blockers.push({ reason: 'scheduled_source_evidence_missing' });
  }
  const evidenceSha256 = evidenceValid
    ? crypto.createHash('sha256').update(fs.readFileSync(evidencePath)).digest('hex')
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    scheduledMode,
    status: governanceStatus === 'GO' && blockers.length === 0 ? 'GO' : 'NO_GO',
    governanceStatus,
    checks: scheduledMode.checks,
    journeys: scheduledMode.journeys,
    flows,
    blockers,
    evidencePath,
    evidenceSha256,
    sourceGeneratedAt: summary.generatedAt || null,
    releaseEvidenceEligible: forceRealStack && evidenceValid,
  };

  const outDir = options.outDir || path.join(process.cwd(), 'qa', 'smoke');
  fs.mkdirSync(outDir, { recursive: true });
  const outName = forceRealStack
    ? 'qa-waves-scheduled-operational-smoke.json'
    : `qa-waves-scheduled-operational-smoke-${scheduledMode.id}.json`;
  const outPath = path.join(outDir, outName);
  writeJsonAtomic(outPath, report);
  report.scheduledEvidencePath = outPath;
  return report;
}

if (require.main === module) {
  runScheduledOperationalSmoke()
    .then((report) => {
      console.log(JSON.stringify({
        status: report.status,
        mode: report.scheduledMode.id,
        governanceStatus: report.governanceStatus,
        scheduledEvidencePath: report.scheduledEvidencePath,
        blockers: report.blockers,
      }, null, 2));
      if (report.status !== 'GO') process.exitCode = 1;
    })
    .catch((error) => {
      console.error('[qa-waves-scheduled-operational-smoke] FAIL', error?.stack || error?.message || error);
      process.exit(1);
    });
}

module.exports = {
  REQUIRED_OPERATIONAL_JOURNEYS,
  SCHEDULED_MODES,
  runScheduledOperationalSmoke,
  resolveMode,
};
