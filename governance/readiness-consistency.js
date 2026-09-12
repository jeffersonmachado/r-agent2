'use strict';

/**
 * readiness-consistency — INVARIANTE CROSS-ARTIFACT de CORE readiness (§G1–G5).
 *
 * Defeito reproduzido (2026-09-12): para o MESMO `runId` + `sourceFingerprint`,
 * `dev/platform-readiness/latest.json` reportava `readiness.readinessScore = 100`
 * enquanto `governance/final-readiness-report.json` podia publicar
 * `certificationStates.corePlatformReadiness.score = 0` (quando
 * `evaluation.readiness_score` vinha nulo/zerado do run persistido). Dois números
 * para o mesmo fato, e o leitor escolhe o que lhe convém.
 *
 * Regra: mesma identidade (runId + sourceFingerprint) ⇒ MESMO estado, MESMO
 * score, MESMOS blockingGaps, MESMA decisão. Divergência é FALHA DE GOVERNANÇA —
 * nunca se escolhe automaticamente o valor mais favorável (fail-closed).
 *
 * Módulo PURO (zero I/O): recebe os artefatos já lidos e devolve o veredito.
 */

/** Campos que precisam bater entre artefatos da mesma identidade. */
const INVARIANT_FIELDS = Object.freeze([
  'coreReadinessState',
  'coreReadinessScore',
  'blockingGapsCount',
  'finalDecision',
]);

/** Extrai o bloco de core readiness, aceitando as duas formas em uso. */
function coreReadinessOf(artifact) {
  if (!artifact || typeof artifact !== 'object') return null;
  if (artifact.corePlatformReadiness && typeof artifact.corePlatformReadiness === 'object') {
    return artifact.corePlatformReadiness;
  }
  const states = artifact.certificationStates;
  if (states && typeof states === 'object' && states.corePlatformReadiness) {
    return states.corePlatformReadiness;
  }
  // Projeção do produtor externo: readiness.readinessScore (sem estado explícito).
  if (artifact.readiness && typeof artifact.readiness === 'object') {
    const score = Number(artifact.readiness.readinessScore);
    if (Number.isFinite(score)) {
      return { state: null, score, source: 'readiness.readinessScore' };
    }
  }
  return null;
}

/** Normaliza as métricas comparáveis de um artefato. */
function metricsOf(artifact, { path: artifactPath = null } = {}) {
  const core = coreReadinessOf(artifact);
  const blockingGaps = artifact && Array.isArray(artifact.blockingGaps) ? artifact.blockingGaps : null;
  const scoreRaw = core && core.score;
  const score = scoreRaw === null || scoreRaw === undefined ? null : Number(scoreRaw);
  return {
    path: artifactPath,
    runId: (artifact && artifact.runId) || null,
    sourceFingerprint: (artifact && artifact.sourceFingerprint) || null,
    coreReadinessState: core ? (core.state || null) : null,
    coreReadinessScore: Number.isFinite(score) ? score : null,
    blockingGapsCount: blockingGaps ? blockingGaps.length : null,
    finalDecision: (artifact && (artifact.finalDecision || artifact.status)) || null,
    hasCoreReadinessBlock: Boolean(core),
  };
}

/**
 * Avalia consistência cross-artifact.
 *
 * @param {Array<{path: string, artifact: object}>} entries
 * @returns {{
 *   status: 'PASS'|'FAIL',
 *   groups: Array<object>,
 *   violations: Array<{code:string, runId:string, sourceFingerprint:string, field:string, values:Array}>,
 *   unreadable: string[],
 * }}
 */
function evaluateReadinessConsistency(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const unreadable = [];
  const byIdentity = new Map();

  for (const entry of list) {
    const artifact = entry && entry.artifact ? entry.artifact : entry;
    const artifactPath = entry && entry.path ? entry.path : null;
    const metrics = metricsOf(artifact, { path: artifactPath });

    if (!metrics.hasCoreReadinessBlock) {
      // Sem bloco de core readiness não há o que comparar — registrado para
      // auditabilidade, nunca convertido em PASS silencioso.
      unreadable.push(metrics.path || '(sem path)');
      continue;
    }
    if (!metrics.runId || !metrics.sourceFingerprint) {
      // Identidade incompleta: não é possível provar consistência.
      unreadable.push(metrics.path || '(sem path)');
      continue;
    }
    const key = `${metrics.runId}::${metrics.sourceFingerprint}`;
    if (!byIdentity.has(key)) byIdentity.set(key, { runId: metrics.runId, sourceFingerprint: metrics.sourceFingerprint, members: [] });
    byIdentity.get(key).members.push(metrics);
  }

  const violations = [];
  const groups = [];

  for (const group of byIdentity.values()) {
    const members = group.members;
    const groupViolations = [];
    for (const field of INVARIANT_FIELDS) {
      // `null` em todos os membros é ausência uniforme (não divergência).
      const present = members.filter((m) => m[field] !== null && m[field] !== undefined);
      if (present.length === 0) continue;
      const distinct = [...new Set(present.map((m) => String(m[field])))];
      if (distinct.length > 1) {
        const violation = {
          code: 'READINESS_CROSS_ARTIFACT_DIVERGENCE',
          runId: group.runId,
          sourceFingerprint: group.sourceFingerprint,
          field,
          values: members.map((m) => ({ path: m.path, value: m[field] })),
        };
        violations.push(violation);
        groupViolations.push(violation);
      }
    }
    groups.push({
      runId: group.runId,
      sourceFingerprint: group.sourceFingerprint,
      members: members.map((m) => ({
        path: m.path,
        coreReadinessState: m.coreReadinessState,
        coreReadinessScore: m.coreReadinessScore,
        blockingGapsCount: m.blockingGapsCount,
        finalDecision: m.finalDecision,
      })),
      consistent: groupViolations.length === 0,
    });
  }

  return {
    status: violations.length === 0 ? 'PASS' : 'FAIL',
    groups,
    violations,
    unreadable,
  };
}

module.exports = {
  INVARIANT_FIELDS,
  coreReadinessOf,
  metricsOf,
  evaluateReadinessConsistency,
};
