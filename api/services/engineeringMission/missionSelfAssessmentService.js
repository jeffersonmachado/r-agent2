'use strict';

/**
 * api/services/engineeringMission/missionSelfAssessmentService.js
 *
 * Autoavaliação contínua (§45). Todo número aqui é CALCULADO de registros persistidos — nada é
 * estimado, e quando um dado não existe o campo é `null` (nunca zero disfarçado de medição).
 *
 * Objetivo: dar insumo para revisar POLÍTICA (limiares de confiança, escopo de autoaprovação,
 * roteamento por provedor) com base no que aconteceu de fato — não em impressão.
 */

const missionStore = require('./missionStoreService');
const logger = require('../../utils/logger');

function models() {
  const index = require('../../db/models');
  return {
    Mission: index.EngineeringMission(),
    Version: index.EngineeringMissionVersion(),
    Approval: index.EngineeringMissionApproval(),
    Review: index.EngineeringMissionReview(),
    Task: index.EngineeringTask(),
    Attempt: index.EngineeringAttempt(),
    Telemetry: index.EngineeringTelemetryEvent(),
    Regression: index.EngineeringRegressionRun(),
  };
}

function toPlain(row) {
  return row && row.get ? row.get({ plain: true }) : row;
}

function rate(numerator, denominator) {
  if (!denominator) return null; // sem denominador não existe taxa — nunca 0 enganoso
  return Number((numerator / denominator).toFixed(4));
}

function push(map, key, delta = 1) {
  map.set(key, (map.get(key) || 0) + delta);
}

/**
 * @param {{limit?: number}} [options]
 */
async function computeSelfAssessment({ limit = 500 } = {}) {
  const m = models();
  const missions = (await m.Mission.findAll({ order: [['created_at', 'DESC']], limit })).map(toPlain);
  const missionIds = missions.map((x) => x.id);

  const versions = missionIds.length ? (await m.Version.findAll({ where: { mission_id: missionIds } })).map(toPlain) : [];
  const approvals = missionIds.length ? (await m.Approval.findAll({ where: { mission_id: missionIds } })).map(toPlain) : [];
  const reviews = missionIds.length ? (await m.Review.findAll({ where: { mission_id: missionIds } })).map(toPlain) : [];
  const tasks = missionIds.length ? (await m.Task.findAll({ where: { id: missions.map((x) => x.linked_task_id).filter(Boolean) } })).map(toPlain) : [];
  const taskIds = tasks.map((t) => t.id);
  const attempts = taskIds.length ? (await m.Attempt.findAll({ where: { task_id: taskIds } })).map(toPlain) : [];
  const telemetry = taskIds.length ? (await m.Telemetry.findAll({ where: { task_id: taskIds } })).map(toPlain) : [];
  const regressionRuns = attempts.length
    ? (await m.Regression.findAll({ where: { attempt_id: attempts.map((a) => a.id) } }).catch(() => [])).map(toPlain)
    : [];

  // ── Enriquecimento
  const enriched = missions.filter((x) => x.current_version > 0);
  const derivedCounts = enriched.map((x) => ((x.enrichment && x.enrichment.derivedRequirements) || []).length);
  const confidences = enriched.map((x) => x.enrichment_confidence).filter((c) => typeof c === 'number');
  const evidenceCounts = enriched.map((x) => (((x.enrichment || {}).factsHash ? 1 : 0)));
  const degradedMissions = enriched.filter((x) => Array.isArray((x.enrichment || {}).degraded) && x.enrichment.degraded.length > 0);
  const missionTypes = new Map();
  const risks = new Map();
  for (const x of missions) { push(missionTypes, x.mission_type || 'UNKNOWN'); push(risks, x.risk || 'UNKNOWN'); }

  // ── Aprovação
  const decided = approvals.filter((a) => ['APPROVED', 'AUTO_APPROVED', 'REJECTED'].includes(a.state));
  const humanApproved = decided.filter((a) => a.state === 'APPROVED').length;
  const autoApproved = decided.filter((a) => a.state === 'AUTO_APPROVED');
  const rejected = decided.filter((a) => a.state === 'REJECTED').length;
  const edited = versions.filter((v) => v.event === 'MATERIAL_CHANGE_APPLIED').length;
  const reEnriched = versions.filter((v) => v.event === 'RE_ENRICHED').length;

  // Versões criadas DEPOIS de já existir aprovação para a missão = descoberta pós-aprovação.
  const firstApprovalVersionByMission = new Map();
  for (const a of approvals.filter((x) => ['APPROVED', 'AUTO_APPROVED'].includes(x.state))) {
    const prev = firstApprovalVersionByMission.get(a.mission_id);
    if (prev === undefined || a.spec_version < prev) firstApprovalVersionByMission.set(a.mission_id, a.spec_version);
  }
  const postApprovalVersionBumps = versions.filter((v) => {
    const approvedAt = firstApprovalVersionByMission.get(v.mission_id);
    return approvedAt !== undefined && v.version > approvedAt;
  }).length;

  // ── Autoaprovação: resultado real depois de autoaprovar (proxy de rollback)
  const autoApprovedMissionIds = new Set(autoApproved.map((a) => a.mission_id));
  const autoApprovedOutcomes = missions.filter((x) => autoApprovedMissionIds.has(x.id));
  const autoApprovedBad = autoApprovedOutcomes.filter((x) => ['DEGRADED', 'FAILED', 'BLOCKED'].includes(x.status)).length;

  // ── Execução
  const byStatus = new Map();
  for (const x of missions) push(byStatus, x.status || 'UNKNOWN');
  const executed = missions.filter((x) => x.linked_task_id).length;

  // ── Modelos/provedores (desempenho real por tentativa)
  const modelStats = new Map();
  for (const a of attempts) {
    const key = `${a.coder_provider || 'desconhecido'}:${a.coder_model || 'desconhecido'}`;
    if (!modelStats.has(key)) modelStats.set(key, { key, attempts: 0, done: 0, failed: 0 });
    const entry = modelStats.get(key);
    entry.attempts += 1;
    if (a.status === 'DONE') entry.done += 1;
    else if (['FAILED', 'RED'].includes(a.status)) entry.failed += 1;
  }
  const reroutes = attempts.filter((a) => Array.isArray(a.routing_reason_codes) && a.routing_reason_codes.includes('MODEL_UNAVAILABLE')).length;

  // ── Telemetria / custo (só quando o provedor devolve usage real)
  let totalTokens = null;
  let latencySamples = 0;
  let latencyTotal = 0;
  for (const t of telemetry) {
    const tokens = t.tokens_total ?? (t.meta && t.meta.total_tokens) ?? null;
    if (typeof tokens === 'number') totalTokens = (totalTokens || 0) + tokens;
    const duration = t.duration_ms ?? (t.meta && t.meta.durationMs) ?? null;
    if (typeof duration === 'number') { latencySamples += 1; latencyTotal += duration; }
  }

  // ── Reviews e regressão
  const metaReviews = reviews.filter((r) => r.kind === 'META');
  const adversarialReviews = reviews.filter((r) => r.kind === 'ADVERSARIAL');
  const metaFailing = metaReviews.filter((r) => r.status === 'FAIL').length;
  const uncovered = adversarialReviews.reduce((acc, r) => acc + ((r.findings || []).filter((c) => c && c.status === 'UNCOVERED').length), 0);
  const regressionFailed = regressionRuns.filter((r) => r.status && r.status !== 'PASS').length;

  return {
    artifactType: 'engineering-mission-self-assessment',
    generatedAt: new Date().toISOString(),
    window: { missionsAnalyzed: missions.length, limit },
    enrichment: {
      missionsEnriched: enriched.length,
      avgDerivedRequirements: derivedCounts.length ? Number((derivedCounts.reduce((a, b) => a + b, 0) / derivedCounts.length).toFixed(2)) : null,
      avgConfidence: confidences.length ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3)) : null,
      missionsWithFactsHash: evidenceCounts.reduce((a, b) => a + b, 0),
      degradedRate: rate(degradedMissions.length, enriched.length),
      degradedReasons: [...new Set(degradedMissions.flatMap((x) => x.enrichment.degraded))].slice(0, 20),
      missionTypeDistribution: Object.fromEntries(missionTypes),
      riskDistribution: Object.fromEntries(risks),
    },
    approval: {
      decisions: decided.length,
      humanApprovalRate: rate(humanApproved, decided.length),
      autoApprovalRate: rate(autoApproved.length, decided.length),
      rejectionRate: rate(rejected, decided.length),
      pending: approvals.filter((a) => a.state === 'PENDING').length,
      editAfterEnrichmentRate: rate(edited, Math.max(versions.length, 1)),
      reEnrichmentRate: rate(reEnriched, Math.max(enriched.length, 1)),
      postApprovalVersionBumps,
    },
    autoApproval: {
      autoApprovedMissions: autoApprovedMissionIds.size,
      autoApprovedEndingBad: autoApprovedBad,
      rollbackRate: rate(autoApprovedBad, autoApprovedMissionIds.size),
      policyIdsUsed: [...new Set(autoApproved.map((a) => a.policy_id).filter(Boolean))],
    },
    execution: {
      executed,
      byStatus: Object.fromEntries(byStatus),
      avgAttemptsPerTask: tasks.length ? Number((attempts.length / tasks.length).toFixed(2)) : null,
      providerReroutes: reroutes,
    },
    models: {
      byProviderModel: [...modelStats.values()].sort((a, b) => b.attempts - a.attempts),
    },
    reviews: {
      metaRuns: metaReviews.length,
      metaFailRate: rate(metaFailing, metaReviews.length),
      adversarialRuns: adversarialReviews.length,
      uncoveredAdversarialCases: uncovered,
    },
    regressions: {
      runs: regressionRuns.length,
      failed: regressionFailed,
      failureRate: rate(regressionFailed, regressionRuns.length),
    },
    cost: {
      totalTokens, // null quando nenhum provider devolveu usage real — nunca inventado
      avgLatencyMs: latencySamples ? Number((latencyTotal / latencySamples).toFixed(1)) : null,
      latencySamples,
    },
    notes: [
      'Aprendizado probabilístico NUNCA substitui políticas determinísticas: estes números alimentam revisão de política, não decisão automática de GREEN.',
      'Campos null significam ausência de medição (não zero).',
    ],
  };
}

/** Persiste o retrato em `reports/` (convenção do projeto para relatórios oficiais). */
async function persistSelfAssessment(assessment, { fsModule = require('fs'), pathModule = require('path'), root = require('path').resolve(__dirname, '..', '..', '..') } = {}) {
  const file = pathModule.join(root, 'reports', 'engineering-mission-self-assessment.json');
  try {
    fsModule.mkdirSync(pathModule.dirname(file), { recursive: true });
    fsModule.writeFileSync(file, `${JSON.stringify(assessment, null, 2)}\n`);
    return file;
  } catch (err) {
    logger.warn('[missionSelfAssessment] falha ao persistir relatório', { error: err.message });
    return null;
  }
}

module.exports = {
  rate,
  computeSelfAssessment,
  persistSelfAssessment,
};
