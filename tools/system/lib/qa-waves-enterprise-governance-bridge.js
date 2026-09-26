'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  validateReplayIntegrity,
  computeGovernanceSignature,
  resolveSigningKey,
} = require('../../../api/services/qa/replayIntegrityService');
const { writeJsonAtomic } = require('../../../api/utils/atomicJsonFile');

const DEFAULT_THRESHOLD = 95;
const DEFAULT_SCHEDULED_MAX_AGE_HOURS = 48;

/**
 * Memoização de I/O e do relatório (correção de performance medida em 2026-09-26).
 *
 * MEDIÇÃO (o defeito real): `buildQaWavesEnterpriseGovernance` levava 13,6-17,9s
 * por chamada e a rota `GET /api/qa-waves/enterprise-governance` devolvia 11.618
 * bytes. O custo era redundância de I/O sobre a MESMA evidência de 141,42MB
 * (`qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json`):
 *   - lida 4x            → 565,7MB de leitura (4,1s)
 *   - sha256 2x          → 282,8MB de hash (2,1s)
 *   - JSON.parse 2x      → 282,8MB de parse (3,1s)
 *   - `stable()+stringify` por entrada (4,3s)
 * Tudo SÍNCRONO no handler do Express. Como o event loop fica bloqueado 13-18s
 * por requisição, qualquer outra requisição concorrente (inclusive `GET /auth/me`,
 * o bootstrap de toda página) estoura o timeout — foi assim que a Page Surface
 * Wave reprovou `/dev/qa-waves/enterprise-governance` com
 * `AbortError: Request timed out after 30000ms | path: /auth/me`, e é a mesma
 * família dos abortos de 28-30s e `ECONNRESET` observados na API Surface Wave.
 *
 * Correção: (1) memo de TEXTO/JSON/HASH chaveado por `(path, size, mtimeMs)` —
 * invalidação é exata (arquivo mudou ⇒ mtime muda ⇒ cache miss) e o valor devolvido
 * é idêntico byte a byte, então nenhum veredito/hash muda; (2) memo do RELATÓRIO
 * montado, revalidado contra a assinatura dos arquivos efetivamente lidos no build
 * anterior, com TTL como backstop (os campos derivados de idade dependem do relógio,
 * não só dos arquivos). Só é usado quando o chamador NÃO injeta entradas próprias
 * (`prodLike`/`scheduled`/`now`) — testes com fixture continuam exercitando o
 * caminho real sem cache.
 */
const REPORT_CACHE_TTL_MS = Number(process.env.QA_WAVES_ENTERPRISE_REPORT_CACHE_MS || 60000);

/**
 * Cooldown de rebuild (stale-while-revalidate) do relatório.
 *
 * O build é SÍNCRONO e custa ~7 s (medido em 2026-09-26: 5,3-8,2 s por rebuild,
 * 9,2 s no primeiro com caches de I/O frios). Requisições concorrentes NÃO
 * coalescem — cada uma refaz o build em série no event loop — então um burst de
 * 12 pedidos num momento em que algum arquivo de entrada mudou custava ~85 s.
 * Foi exatamente assim que o timeout de 90 s do client em DEV estourou no mesh
 * canônico (`fitness-matricula-leads` → `infra_error` →
 * `CRITICAL_DOMAIN_FAILED:omnichannel` → mesh NO_GO → selo bloqueado).
 *
 * Dentro do cooldown, um pedido recebe o relatório JÁ ASSINADO (o `generatedAt`
 * do próprio relatório declara a idade) e o primeiro pedido fora da janela
 * reconstrói: o burst inteiro passa a custar UM build em vez de N. A assinatura
 * dos arquivos continua sendo verificada — o cooldown só limita a FREQUÊNCIA da
 * reconstrução, nunca o conteúdo do que é devolvido.
 */
const REBUILD_COOLDOWN_MS = Number(process.env.QA_WAVES_ENTERPRISE_REBUILD_COOLDOWN_MS || 5000);
const textCache = new Map();
const jsonCache = new Map();
const hashCache = new Map();
let touchedFiles = null;
let reportCache = null;

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function recordTouched(filePath, stat) {
  if (!touchedFiles || !stat) return;
  touchedFiles.push(`${filePath}\u0000${stat.size}\u0000${stat.mtimeMs}`);
}

function readTextFile(filePath) {
  const stat = statOrNull(filePath);
  recordTouched(filePath, stat);
  if (stat) {
    const hit = textCache.get(filePath);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.text;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  if (stat) textCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, text });
  return text;
}

function readCurrentRunLineage() {
  try {
    const run = JSON.parse(readTextFile(path.join(process.cwd(), 'governance', '.current-run.json')));
    return {
      runId: run?.runId || null,
      sourceFingerprint: run?.sourceFingerprint || null,
    };
  } catch (_) {
    return { runId: null, sourceFingerprint: null };
  }
}
const DEFAULT_REQUIRED_SCHEDULED_JOURNEYS = Object.freeze([
  'support_ticket_flow',
  'fitness_customer_checkin',
  // `booking_flow` is the executable prod-like proof for the scheduling
  // (agendamento) capability.  The QA registry also contains the broader
  // business journey `agendamento`, but the operational smoke emits this id.
  'booking_flow',
]);

function readJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const stat = statOrNull(filePath);
  recordTouched(filePath, stat);
  if (stat) {
    const hit = jsonCache.get(filePath);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.value;
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (stat) jsonCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, value });
    return value;
  } catch {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sha256File(filePath) {
  const stat = statOrNull(filePath);
  recordTouched(filePath, stat);
  if (stat) {
    const hit = hashCache.get(filePath);
    if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) return hit.value;
  }
  const value = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (stat) hashCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, value });
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stable(value[key]);
    return acc;
  }, {});
}

function gradeConfidence(score) {
  if (score >= 98) return 'A+';
  if (score >= 95) return 'A';
  if (score >= 90) return 'B';
  if (score >= 80) return 'C';
  return 'D';
}

function riskLevel(score) {
  if (score >= 95) return 'LOW';
  if (score >= 90) return 'MEDIUM';
  if (score >= 80) return 'HIGH';
  return 'CRITICAL';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveEvidencePath(root, evidencePath) {
  if (typeof evidencePath !== 'string' || !evidencePath.trim()) return null;
  return path.isAbsolute(evidencePath)
    ? path.normalize(evidencePath)
    : path.resolve(root, evidencePath);
}

function sameFile(left, right) {
  if (!left || !right || !fs.existsSync(left) || !fs.existsSync(right)) return false;
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return false;
  }
}

function flowProof(flow = {}) {
  const replay = flow.replay || {};
  const governance = replay.governance || flow.governance || {};
  return {
    journeyId: String(flow.journeyId || '').trim(),
    goNoGo: governance.goNoGo || governance.decision || (governance.isOperational === true ? 'GO' : 'NO_GO'),
    replayHash: replay.replayHash || null,
    replayChecksum: replay.replayChecksum || null,
    governanceSignature: replay.governanceSignature || null,
    integrityValid: validateReplayIntegrity(replay, governance).valid,
  };
}

function assessScheduledEvidence(scheduled, options = {}) {
  const root = options.root || process.cwd();
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const maxAgeHours = Number.isFinite(Number(options.maxAgeHours))
    ? Number(options.maxAgeHours)
    : Number(process.env.QA_WAVES_SCHEDULED_MAX_AGE_HOURS || DEFAULT_SCHEDULED_MAX_AGE_HOURS);
  const requiredJourneys = asArray(options.requiredJourneys).length > 0
    ? asArray(options.requiredJourneys).map((item) => String(item).trim()).filter(Boolean)
    : [...DEFAULT_REQUIRED_SCHEDULED_JOURNEYS];
  const reasons = [];
  const expectedEvidencePath = resolveEvidencePath(
    root,
    options.expectedEvidencePath
      || path.join(root, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json'),
  );

  if (!scheduled || typeof scheduled !== 'object') {
    return {
      healthy: false,
      reasons: ['scheduled_evidence_missing'],
      ageHours: null,
      maxAgeHours,
      requiredJourneys,
      presentJourneys: [],
      missingJourneys: requiredJourneys,
      evidencePath: null,
      evidenceValid: false,
      evidenceBound: false,
      evidenceSha256: null,
      expectedEvidenceSha256: null,
    };
  }

  if (scheduled.status !== 'GO') reasons.push('scheduled_status_not_go');
  if (scheduled.governanceStatus !== 'GO') reasons.push('scheduled_governance_status_not_go');
  if (asArray(scheduled.blockers).length > 0) reasons.push('scheduled_has_blockers');
  if (scheduled.releaseEvidenceEligible !== true || scheduled.scheduledMode?.realStack !== true) {
    reasons.push('scheduled_mode_not_release_eligible');
  }

  const generatedAtMs = Date.parse(scheduled.generatedAt);
  let ageHours = null;
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(now.getTime())) {
    reasons.push('scheduled_generated_at_invalid');
  } else {
    ageHours = Number(((now.getTime() - generatedAtMs) / 3_600_000).toFixed(2));
    if (ageHours < -0.0834) reasons.push('scheduled_generated_at_in_future');
    if (ageHours > maxAgeHours) reasons.push('scheduled_evidence_stale');
  }

  const evidencePath = resolveEvidencePath(root, scheduled.evidencePath);
  const evidenceValid = Boolean(evidencePath && fs.existsSync(evidencePath) && fs.statSync(evidencePath).isFile());
  if (!evidenceValid) reasons.push('scheduled_evidence_path_invalid');
  const evidenceBound = evidenceValid && expectedEvidencePath
    ? sameFile(evidencePath, expectedEvidencePath)
    : false;
  if (!evidenceBound) reasons.push('scheduled_evidence_path_not_canonical');

  let evidenceSha256 = null;
  let expectedEvidenceSha256 = null;
  let sourceEvidence = null;
  if (evidenceValid) {
    evidenceSha256 = sha256File(evidencePath);
    sourceEvidence = readJson(evidencePath);
  }
  if (expectedEvidencePath && fs.existsSync(expectedEvidencePath)) {
    expectedEvidenceSha256 = sha256File(expectedEvidencePath);
  }
  if (!sourceEvidence) reasons.push('scheduled_source_evidence_invalid');
  if (typeof scheduled.evidenceSha256 !== 'string' || !scheduled.evidenceSha256.trim()) {
    reasons.push('scheduled_evidence_hash_missing');
  } else if (scheduled.evidenceSha256 !== evidenceSha256 || scheduled.evidenceSha256 !== expectedEvidenceSha256) {
    reasons.push('scheduled_evidence_hash_mismatch');
  }

  const sourceGeneratedAtMs = Date.parse(sourceEvidence?.generatedAt);
  if (!Number.isFinite(sourceGeneratedAtMs)) {
    reasons.push('scheduled_source_generated_at_invalid');
  } else {
    const sourceAgeHours = (now.getTime() - sourceGeneratedAtMs) / 3_600_000;
    if (sourceAgeHours < -0.0834) reasons.push('scheduled_source_generated_at_in_future');
    if (sourceAgeHours > maxAgeHours) reasons.push('scheduled_source_evidence_stale');
    if (Number.isFinite(generatedAtMs) && generatedAtMs < sourceGeneratedAtMs) {
      reasons.push('scheduled_generated_before_source_evidence');
    }
  }
  if (scheduled.sourceGeneratedAt !== sourceEvidence?.generatedAt) {
    reasons.push('scheduled_source_timestamp_mismatch');
  }
  if (sourceEvidence?.status !== 'GO' || sourceEvidence?.productionReadiness?.decision !== 'GO') {
    reasons.push('scheduled_source_evidence_not_go');
  }
  const sourceEnvironment = sourceEvidence?.environment || {};
  if (sourceEnvironment.mode !== 'prod_like_real_stack'
    || sourceEnvironment.usedFixtureServer !== false
    || sourceEnvironment.backend !== 'real_stack'
    || sourceEnvironment.database !== 'real'
    || sourceEnvironment.tenantIsolated !== true) {
    reasons.push('scheduled_source_environment_not_prod_like');
  }

  const flows = asArray(scheduled.flows);
  if (flows.length === 0) reasons.push('scheduled_flows_missing');
  const scheduledJourneyIds = flows.map((flow) => String(flow?.journeyId || '').trim()).filter(Boolean);
  const presentJourneys = [...new Set(scheduledJourneyIds)];
  const missingJourneys = requiredJourneys.filter((journeyId) => !presentJourneys.includes(journeyId));
  if (missingJourneys.length > 0) reasons.push('scheduled_required_journeys_missing');

  const sourceProofs = asArray(sourceEvidence?.flows).map(flowProof);
  const sourceByJourney = new Map(sourceProofs.map((proof) => [proof.journeyId, proof]));
  const sourceJourneys = sourceProofs.map((proof) => proof.journeyId).filter(Boolean);
  const missingSourceJourneys = requiredJourneys.filter((journeyId) => !sourceJourneys.includes(journeyId));
  if (missingSourceJourneys.length > 0) reasons.push('scheduled_source_required_journeys_missing');
  if (new Set(scheduledJourneyIds).size !== scheduledJourneyIds.length || new Set(sourceJourneys).size !== sourceJourneys.length) {
    reasons.push('scheduled_duplicate_journey_proof');
  }

  for (const flow of flows) {
    const journeyId = String(flow?.journeyId || '').trim() || 'unknown';
    if (flow?.goNoGo !== 'GO') reasons.push(`scheduled_flow_not_go:${journeyId}`);
    if (flow?.integrityValid !== true) reasons.push(`scheduled_flow_integrity_invalid:${journeyId}`);
    if (!flow?.replayHash || !flow?.replayChecksum || !flow?.governanceSignature) {
      reasons.push(`scheduled_flow_replay_proof_missing:${journeyId}`);
    }
    if (asArray(flow?.failedResidualSteps).length > 0) reasons.push(`scheduled_flow_failed_steps:${journeyId}`);
    if (asArray(flow?.missingEvidence).length > 0) reasons.push(`scheduled_flow_missing_evidence:${journeyId}`);
    const source = sourceByJourney.get(journeyId);
    if (!source) {
      reasons.push(`scheduled_flow_not_in_source:${journeyId}`);
      continue;
    }
    for (const field of ['goNoGo', 'replayHash', 'replayChecksum', 'governanceSignature', 'integrityValid']) {
      if (flow?.[field] !== source[field]) reasons.push(`scheduled_flow_source_mismatch:${journeyId}:${field}`);
    }
  }

  return {
    healthy: reasons.length === 0,
    reasons: [...new Set(reasons)],
    ageHours,
    maxAgeHours,
    requiredJourneys,
    presentJourneys,
    missingJourneys,
    evidencePath,
    evidenceValid,
    evidenceBound,
    evidenceSha256,
    expectedEvidenceSha256,
    sourceGeneratedAt: sourceEvidence?.generatedAt || null,
  };
}

function collectFlowProofs(flow = {}) {
  const replay = flow.replay || {};
  const steps = asArray(replay.steps);
  const failedSteps = steps.filter((step) => step?.status === 'failed');
  const missingEvidence = steps.flatMap((step) =>
    asArray(step?.missingEvidence).map((field) => ({
      stepId: step.id || step.stepId || 'unknown',
      field,
    }))
  );
  const blockers = [
    ...asArray(flow.governance?.blockers),
    ...asArray(flow.strictGovernance?.blockers),
    ...asArray(flow.audit?.blockers),
  ];
  const mutationalSteps = steps.filter((step) => step?.semanticContract?.mutationExpected === true || step?.mutationExpected === true);
  const mutationProofFailures = mutationalSteps.filter((step) => {
    const postState = step.postStateProof || {};
    const provenance = asArray(step.mutationProvenance).length > 0
      ? asArray(step.mutationProvenance)
      : asArray(postState.mutationProvenance);
    const missingMutations = asArray(postState.missingMutations);
    const missingSideEffects = asArray(postState.missingSideEffects);
    return postState.valid === false
      || missingMutations.length > 0
      || missingSideEffects.length > 0
      || provenance.some((record) => record?.valid !== true);
  });
  const provenanceMismatches = [];
  for (const step of steps) {
    const expectedActionType = step?.semanticContract?.actionType || step?.actionType || null;
    for (const record of asArray(step?.mutationProvenance)) {
      if (record?.originatingActionType && expectedActionType && record.originatingActionType !== expectedActionType) {
        provenanceMismatches.push({
          stepId: step.id || step.stepId || 'unknown',
          expectedActionType,
          actualActionType: record.originatingActionType,
        });
      }
    }
  }
  for (const record of asArray(replay.postStateSummary?.mutationProvenance)) {
    const step = steps.find((item) => (item.id || item.stepId) === record?.originatingStepId);
    const expectedActionType = step?.semanticContract?.actionType || step?.actionType || null;
    if (record?.originatingActionType && expectedActionType && record.originatingActionType !== expectedActionType) {
      provenanceMismatches.push({
        stepId: record.originatingStepId,
        expectedActionType,
        actualActionType: record.originatingActionType,
      });
    }
  }

  return {
    failedSteps,
    missingEvidence,
    blockers,
    mutationProofFailures,
    provenanceMismatches,
  };
}

function calculateOperationalConfidence({
  smokePassed,
  replayIntegrityRate,
  mutationConsistencyRate,
  provenanceConsistencyRate,
  replayHealthRate,
  governanceConsistencyRate,
  runtimeStabilityRate,
  evidenceCompletenessRate,
}) {
  const weighted =
    smokePassed * 0.18
    + replayIntegrityRate * 0.16
    + mutationConsistencyRate * 0.14
    + provenanceConsistencyRate * 0.14
    + replayHealthRate * 0.12
    + governanceConsistencyRate * 0.12
    + runtimeStabilityRate * 0.06
    + evidenceCompletenessRate * 0.08;
  return Number(Math.max(0, Math.min(100, weighted)).toFixed(1));
}

function buildQaWavesEnterpriseGovernanceUncached(options = {}) {
  const root = options.root || process.cwd();
  const prodLikePath = options.prodLikePath || path.join(root, 'qa', 'smoke', 'prod-like', 'qa-waves-operational-prod-like-smoke.json');
  const scheduledPath = options.scheduledPath || path.join(root, 'qa', 'smoke', 'qa-waves-scheduled-operational-smoke.json');
  const threshold = Number(options.threshold || process.env.QA_WAVES_OPERATIONAL_CONFIDENCE_THRESHOLD || DEFAULT_THRESHOLD);
  const prodLike = options.prodLike || readJson(prodLikePath);
  const scheduled = options.scheduled || readJson(scheduledPath);
  const flows = asArray(prodLike?.flows);
  const scheduledAssessment = assessScheduledEvidence(scheduled, {
    root,
    now: options.now,
    maxAgeHours: options.scheduledMaxAgeHours,
    requiredJourneys: options.requiredScheduledJourneys,
    expectedEvidencePath: prodLikePath,
  });

  const replayArtifacts = [];
  const allBlockers = [];
  const failedProofs = [];
  const integrityResults = [];
  const governanceSignatures = [];
  let mutationFailures = 0;
  let provenanceMismatches = 0;
  let missingEvidenceCount = 0;

  for (const flow of flows) {
    const replay = flow.replay || {};
    const governance = replay.governance || flow.governance || {};
    const integrity = validateReplayIntegrity(replay, governance);
    integrityResults.push(integrity);
    replayArtifacts.push({
      journeyId: flow.journeyId,
      replayHash: replay.replayHash || null,
      replayChecksum: replay.replayChecksum || null,
      governanceSignature: replay.governanceSignature || null,
      tenantId: replay.tenantId || null,
      smokeExecutionId: replay.smokeExecutionId || null,
    });
    governanceSignatures.push({
      journeyId: flow.journeyId,
      valid: integrity.governanceSignature === replay.governanceSignature,
      expected: integrity.governanceSignature,
      actual: replay.governanceSignature || null,
    });

    const proofs = collectFlowProofs(flow);
    mutationFailures += proofs.mutationProofFailures.length;
    provenanceMismatches += proofs.provenanceMismatches.length;
    missingEvidenceCount += proofs.missingEvidence.length;
    allBlockers.push(...proofs.blockers.map((blocker) => ({ journeyId: flow.journeyId, ...blocker })));
    failedProofs.push(
      ...proofs.failedSteps.map((step) => ({ journeyId: flow.journeyId, stepId: step.id || step.stepId || 'unknown', reason: 'failed_step' })),
      ...proofs.missingEvidence.map((item) => ({ journeyId: flow.journeyId, ...item, reason: 'missing_evidence' })),
      ...proofs.mutationProofFailures.map((step) => ({ journeyId: flow.journeyId, stepId: step.id || step.stepId || 'unknown', reason: 'failed_mutation_proof' })),
      ...proofs.provenanceMismatches.map((item) => ({ journeyId: flow.journeyId, ...item, reason: 'provenance_mismatch' }))
    );
  }

  const flowCount = Math.max(flows.length, 1);
  const validIntegrityCount = integrityResults.filter((item) => item.valid).length;
  const validSignatures = governanceSignatures.filter((item) => item.valid).length;
  const smokePassed = prodLike?.status === 'GO' && prodLike?.productionReadiness?.decision === 'GO' ? 100 : 0;
  const continuousHealthy = scheduledAssessment.healthy;
  const replayIntegrityRate = (validIntegrityCount / flowCount) * 100;
  const mutationConsistencyRate = mutationFailures === 0 ? 100 : Math.max(0, 100 - mutationFailures * 25);
  const provenanceConsistencyRate = provenanceMismatches === 0 ? 100 : Math.max(0, 100 - provenanceMismatches * 25);
  const replayHealthRate = failedProofs.length === 0 ? 100 : Math.max(0, 100 - failedProofs.length * 15);
  const governanceConsistencyRate = allBlockers.length === 0 && validSignatures === governanceSignatures.length ? 100 : 75;
  const runtimeStabilityRate = continuousHealthy ? 100 : 70;
  const evidenceCompletenessRate = missingEvidenceCount === 0 ? 100 : Math.max(0, 100 - missingEvidenceCount * 10);
  const operationalConfidence = calculateOperationalConfidence({
    smokePassed,
    replayIntegrityRate,
    mutationConsistencyRate,
    provenanceConsistencyRate,
    replayHealthRate,
    governanceConsistencyRate,
    runtimeStabilityRate,
    evidenceCompletenessRate,
  });

  const activeBlockers = [
    ...allBlockers,
    ...integrityResults.flatMap((result, index) =>
      asArray(result.blockers).map((blocker) => ({
        journeyId: flows[index]?.journeyId || 'unknown',
        ...blocker,
      }))
    ),
  ];
  if (!continuousHealthy) {
    activeBlockers.push({
      reason: 'continuous_smoke_degraded',
      status: scheduled?.status || 'missing',
      evidenceReasons: scheduledAssessment.reasons,
    });
  }
  if (operationalConfidence < threshold) {
    activeBlockers.push({ reason: 'operational_confidence_degraded', threshold, operationalConfidence });
  }
  const enterpriseSigningAvailable = Boolean(resolveSigningKey(null, { required: false }));
  if (!enterpriseSigningAvailable) {
    activeBlockers.push({ reason: 'enterprise_signing_key_unavailable' });
  }

  const governanceStatus = (
    smokePassed === 100
    && replayIntegrityRate === 100
    && validSignatures === governanceSignatures.length
    && failedProofs.length === 0
    && activeBlockers.length === 0
    && continuousHealthy
    && operationalConfidence >= threshold
  ) ? 'GO' : 'NO_GO';

  const report = {
    generatedAt: new Date().toISOString(),
    runId: readCurrentRunLineage().runId,
    sourceFingerprint: readCurrentRunLineage().sourceFingerprint,
    artifactType: 'qa-waves-enterprise-governance',
    artifactVersion: '1.0.0',
    status: governanceStatus,
    governanceStatus,
    threshold,
    replayIntegrity: {
      valid: replayIntegrityRate === 100,
      rate: Number(replayIntegrityRate.toFixed(1)),
      artifacts: replayArtifacts,
      blockers: integrityResults.flatMap((item) => item.blockers || []),
    },
    smokeHealth: {
      status: prodLike?.status || 'missing',
      productionReadiness: prodLike?.productionReadiness?.decision || 'missing',
      healthy: smokePassed === 100,
      evidencePath: prodLikePath,
    },
    operationalConfidence,
    confidenceGrade: gradeConfidence(operationalConfidence),
    riskLevel: riskLevel(operationalConfidence),
    failedProofs,
    activeBlockers,
    replayArtifacts,
    governanceSignature: {
      valid: validSignatures === governanceSignatures.length,
      signatures: governanceSignatures,
    },
    enterpriseSigning: {
      available: enterpriseSigningAvailable,
      algorithm: 'hmac-sha256',
    },
    lastSmokeExecution: {
      generatedAt: prodLike?.generatedAt || null,
      evidencePath: prodLikePath,
      tenantId: replayArtifacts.find((item) => item.tenantId)?.tenantId || null,
    },
    continuousValidationStatus: {
      status: scheduled?.status || 'missing',
      healthy: continuousHealthy,
      evidencePath: scheduledPath,
      mode: scheduled?.scheduledMode?.id || scheduled?.mode || null,
      generatedAt: scheduled?.generatedAt || null,
      ageHours: scheduledAssessment.ageHours,
      maxAgeHours: scheduledAssessment.maxAgeHours,
      evidenceValid: scheduledAssessment.evidenceValid,
      evidenceBound: scheduledAssessment.evidenceBound,
      evidenceSha256: scheduledAssessment.evidenceSha256,
      sourceGeneratedAt: scheduledAssessment.sourceGeneratedAt,
      evidenceArtifactPath: scheduledAssessment.evidencePath,
      requiredJourneys: scheduledAssessment.requiredJourneys,
      presentJourneys: scheduledAssessment.presentJourneys,
      missingJourneys: scheduledAssessment.missingJourneys,
      reasons: scheduledAssessment.reasons,
    },
    releaseReadiness: {
      go: governanceStatus === 'GO',
      reasons: [],
    },
    deploymentSafety: {
      deployAllowed: governanceStatus === 'GO',
      threshold,
      operationalConfidence,
      blockers: activeBlockers,
    },
  };
  report.enterpriseGovernanceSignature = enterpriseSigningAvailable
    ? computeGovernanceSignature(report, {
      goNoGo: governanceStatus,
      isOperational: governanceStatus === 'GO',
      blockers: activeBlockers,
    })
    : null;
  report.reportHash = sha256(JSON.stringify(stable(report)));
  return report;
}

/**
 * Fachada com memo do relatório. A chave é a assinatura dos arquivos REALMENTE
 * lidos no build anterior (`(path, size, mtimeMs)`) + TTL; qualquer mudança de
 * arquivo invalida na hora. O objeto devolvido é o MESMO relatório já assinado
 * (por isso `generatedAt`/`reportHash` permanecem coerentes entre si — recarimbar
 * `generatedAt` quebraria `reportHash`).
 *
 * Não é usado quando o chamador injeta entradas (`prodLike`/`scheduled`/`now`),
 * então testes com fixture seguem exercitando o caminho sem cache.
 */
function buildQaWavesEnterpriseGovernance(options = {}) {
  const cacheable = !options.prodLike && !options.scheduled && options.now === undefined;
  const key = [
    options.root || process.cwd(),
    options.threshold === undefined ? '' : String(options.threshold),
    options.scheduledMaxAgeHours === undefined ? '' : String(options.scheduledMaxAgeHours),
    asArray(options.requiredScheduledJourneys).join(','),
  ].join('|');

  if (cacheable && reportCache && reportCache.key === key && Date.now() < reportCache.expiresAt) {
    const unchanged = reportCache.touched.every((entry) => {
      const [filePath, size, mtimeMs] = entry.split('\u0000');
      const stat = statOrNull(filePath);
      return Boolean(stat) && String(stat.size) === size && String(stat.mtimeMs) === mtimeMs;
    });
    if (unchanged) return reportCache.report;
    // Assinatura mudou: reconstrói somente se o cooldown já passou. Sem isso, N
    // requisições concorrentes num burst = N builds síncronos (~7 s cada) no
    // mesmo event loop, o que estoura o timeout de 90 s do client em DEV.
    if (Date.now() - (reportCache.builtAt || 0) < REBUILD_COOLDOWN_MS) return reportCache.report;
  }

  touchedFiles = [];
  let report;
  try {
    report = buildQaWavesEnterpriseGovernanceUncached(options);
  } finally {
    const touched = touchedFiles ? [...new Set(touchedFiles)] : [];
    touchedFiles = null;
    if (cacheable) {
      reportCache = { key, builtAt: Date.now(), expiresAt: Date.now() + REPORT_CACHE_TTL_MS, touched, report };
    }
  }
  return report;
}

function validateQaWavesEnterpriseGovernance(report = {}, options = {}) {
  const threshold = Number(options.threshold || report.threshold || DEFAULT_THRESHOLD);
  const reasons = [];
  if (!report || typeof report !== 'object') reasons.push('qa_waves_governance_missing');
  if (report.governanceStatus !== 'GO') reasons.push('qa_waves_status_not_go');
  if (report.replayIntegrity?.valid !== true) reasons.push('qa_waves_replay_integrity_invalid');
  if (report.governanceSignature?.valid !== true) reasons.push('qa_waves_governance_signature_invalid');
  if (asArray(report.failedProofs).length > 0) reasons.push('qa_waves_failed_proofs');
  if (asArray(report.activeBlockers).length > 0) reasons.push('qa_waves_active_blockers');
  if (report.continuousValidationStatus?.healthy !== true) reasons.push('qa_waves_continuous_smoke_degraded');
  if (Number(report.operationalConfidence || 0) < threshold) reasons.push('qa_waves_operational_confidence_degraded');

  const canonical = { ...report };
  delete canonical.auditTrail;
  delete canonical.canonicalPaths;
  const actualReportHash = canonical.reportHash || null;
  delete canonical.reportHash;
  const expectedReportHash = sha256(JSON.stringify(stable(canonical)));
  if (!actualReportHash || actualReportHash !== expectedReportHash) {
    reasons.push('qa_waves_enterprise_report_hash_invalid');
  }

  const actualEnterpriseSignature = canonical.enterpriseGovernanceSignature || null;
  delete canonical.enterpriseGovernanceSignature;
  try {
    const expectedEnterpriseSignature = computeGovernanceSignature(canonical, {
      goNoGo: report.governanceStatus || 'NO_GO',
      isOperational: report.governanceStatus === 'GO',
      blockers: asArray(report.activeBlockers),
    });
    if (!actualEnterpriseSignature || actualEnterpriseSignature !== expectedEnterpriseSignature) {
      reasons.push('qa_waves_enterprise_signature_invalid');
    }
  } catch {
    reasons.push('qa_waves_enterprise_signing_key_unavailable');
  }
  if (report.auditTrail && report.auditTrail.valid !== true) {
    reasons.push('qa_waves_governance_audit_invalid');
  }
  return {
    valid: reasons.length === 0,
    reasons,
    threshold,
    operationalConfidence: Number(report.operationalConfidence || 0),
  };
}

function verifyGovernanceAuditTrail(auditPath) {
  if (!auditPath || !fs.existsSync(auditPath)) {
    return { valid: true, reasons: [], entries: 0, lastEntryHash: null };
  }

  const reasons = [];
  const lines = readTextFile(auditPath).split('\n').filter((line) => line.trim());
  let previousEntryHash = null;
  for (let index = 0; index < lines.length; index += 1) {
    let entry;
    try {
      entry = JSON.parse(lines[index]);
    } catch {
      reasons.push(`audit_entry_invalid_json:${index + 1}`);
      break;
    }

    const entryHash = entry?.entryHash || null;
    const unsigned = { ...entry };
    delete unsigned.entryHash;
    const expectedHash = sha256(JSON.stringify(stable(unsigned)));
    if (!entryHash || entryHash !== expectedHash) {
      reasons.push(`audit_entry_hash_mismatch:${index + 1}`);
    }
    if ((entry?.previousEntryHash || null) !== previousEntryHash) {
      reasons.push(`audit_chain_link_mismatch:${index + 1}`);
    }
    previousEntryHash = entryHash;
  }

  return {
    valid: reasons.length === 0,
    reasons,
    entries: lines.length,
    lastEntryHash: previousEntryHash,
  };
}

function appendGovernanceAuditTrail(report = {}, auditPath) {
  if (!auditPath) return null;
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  const verification = verifyGovernanceAuditTrail(auditPath);
  if (!verification.valid) {
    const error = new Error(`qa_waves_governance_audit_invalid:${verification.reasons.join(',')}`);
    error.code = 'QA_WAVES_AUDIT_INVALID';
    error.verification = verification;
    throw error;
  }

  const entry = {
    generatedAt: new Date().toISOString(),
    decision: report.governanceStatus || 'NO_GO',
    governanceSignature: report.enterpriseGovernanceSignature || null,
    replayArtifacts: report.replayArtifacts || [],
    lastSmokeExecution: report.lastSmokeExecution || null,
    deploymentSafety: report.deploymentSafety || null,
    previousEntryHash: verification.lastEntryHash,
  };
  entry.entryHash = sha256(JSON.stringify(stable(entry)));

  const fd = fs.openSync(
    auditPath,
    fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_WRONLY,
    0o600,
  );
  try {
    fs.writeSync(fd, `${JSON.stringify(entry)}\n`, null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return entry;
}

function writeQaWavesEnterpriseGovernance(report, outputPath, auditPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const auditEntry = appendGovernanceAuditTrail(report, auditPath);
  const auditVerification = auditPath
    ? verifyGovernanceAuditTrail(auditPath)
    : { valid: true, reasons: [], entries: 0, lastEntryHash: null };
  const persisted = {
    ...report,
    auditTrail: auditEntry ? {
      path: auditPath,
      latestEntryHash: auditEntry.entryHash,
      immutable: true,
      valid: auditVerification.valid,
      entries: auditVerification.entries,
      reasons: auditVerification.reasons,
    } : report.auditTrail || null,
  };
  writeJsonAtomic(outputPath, persisted);
  return persisted;
}

function writeQaWavesEnterpriseGovernanceWithMirror(report, outputPath, auditPath, options = {}) {
  const persisted = writeQaWavesEnterpriseGovernance(report, outputPath, auditPath);
  const mirrorOutputPath = options.workspaceMirrorPath || null;
  const mirrorAuditPath = options.workspaceAuditPath || auditPath;

  if (!mirrorOutputPath || path.resolve(mirrorOutputPath) === path.resolve(outputPath)) {
    return persisted;
  }

  let mirrored = persisted;
  if (mirrorAuditPath && (!auditPath || path.resolve(mirrorAuditPath) !== path.resolve(auditPath))) {
    const mirrorAuditEntry = appendGovernanceAuditTrail(report, mirrorAuditPath);
    const mirrorVerification = verifyGovernanceAuditTrail(mirrorAuditPath);
    mirrored = {
      ...persisted,
      auditTrail: {
        path: mirrorAuditPath,
        latestEntryHash: mirrorAuditEntry.entryHash,
        immutable: true,
        valid: mirrorVerification.valid,
        entries: mirrorVerification.entries,
        reasons: mirrorVerification.reasons,
      },
    };
  }
  fs.mkdirSync(path.dirname(mirrorOutputPath), { recursive: true });
  writeJsonAtomic(mirrorOutputPath, mirrored);
  return {
    ...mirrored,
    canonicalPaths: {
      outputPath,
      auditPath,
      workspaceMirrorPath: mirrorOutputPath,
      workspaceAuditPath: mirrorAuditPath,
    },
  };
}

module.exports = {
  DEFAULT_THRESHOLD,
  DEFAULT_SCHEDULED_MAX_AGE_HOURS,
  DEFAULT_REQUIRED_SCHEDULED_JOURNEYS,
  assessScheduledEvidence,
  buildQaWavesEnterpriseGovernance,
  validateQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernance,
  writeQaWavesEnterpriseGovernanceWithMirror,
  appendGovernanceAuditTrail,
  verifyGovernanceAuditTrail,
  calculateOperationalConfidence,
};
