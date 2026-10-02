'use strict';

/**
 * scripts/governance/validate-final-snapshot-coherence.js
 *
 * GATE BLOQUEANTE: os artefatos finais de certificação entregues no pacote não podem se contradizer.
 *
 * DEFEITO REAL (2026-10-02): o envelope continha, para o MESMO runId,
 *   governance/certification-snapshot.json          → NO_GO / runStatus=FAILED
 *   docs/governance/_platform-status-source.json    → AUTONOMOUS_READY_GO / blockers=0
 * Ambos parecem canônicos. Um auditor externo não tem como decidir qual é a autoridade — e essa
 * ambiguidade sustenta qualquer alegação, bastando escolher o arquivo conveniente.
 *
 * Este gate NÃO proíbe estados intermediários: proíbe intermediário DISFARÇADO de final. Um artefato
 * que não é a decisão corrente precisa declarar `lifecycle` (TRANSITIONAL/SUPERSEDED/INTERMEDIATE/
 * HISTORICAL) e dizer por quem foi substituído e por quê.
 *
 * Classificação DEVELOPMENT: é gate de engenharia/governança, não superfície de cliente.
 */

const fs = require('fs');
const path = require('path');

const {
  assessFinalCoherence,
  assessRunStatusSemantics,
  normalizeDecision,
  isNonCurrent,
} = require('./lib/certificationCoherence');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'final-snapshot-coherence-report.json');

/**
 * Artefatos que, se entregues juntos, podem ser lidos como "a decisão final do release". A lista é
 * deliberadamente curta e explícita: são os que um auditor abriria primeiro.
 */
const AUTHORITATIVE_FINAL_ARTIFACTS = Object.freeze([
  { path: 'docs/governance/_platform-status-source.json', role: 'CANONICAL_PLATFORM_DECISION' },
  { path: 'governance/certification-snapshot.json', role: 'DB_PROJECTION_SNAPSHOT' },
  { path: 'reports/final-governance-report.json', role: 'FINAL_GOVERNANCE_REPORT' },
  { path: 'reports/final-readiness-report.json', role: 'FINAL_READINESS_REPORT' },
  { path: 'dist/governance/final-governance-report.json', role: 'PACKAGED_FINAL_GOVERNANCE_REPORT' },
]);

function readJson(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    return { __parseError: err.message };
  }
}

/** Extrai a decisão e os números de um artefato, seja qual for o formato do produtor. */
function extractArtifact(relPath, role) {
  const raw = readJson(relPath);
  if (raw === null) return { present: false, path: relPath, role };
  if (raw.__parseError) return { present: true, path: relPath, role, decision: 'UNKNOWN', parseError: raw.__parseError };

  const decision = raw.finalDecision ?? raw.decision ?? raw.status ?? raw.verdict ?? null;
  const scorecard = raw.scorecard || {};

  return {
    present: true,
    path: relPath,
    role,
    runId: raw.runId || raw.sourceRunId || (raw.source && raw.source.runId) || null,
    decision,
    normalizedDecision: normalizeDecision(decision),
    lifecycle: raw.lifecycle || null,
    supersededBy: raw.supersededBy || null,
    reason: raw.supersessionReason || raw.reason || null,
    semanticNote: raw.semanticNote || raw.declaredContradiction || null,
    runStatus: raw.runStatus || null,
    scorecardTotal: scorecard.total ?? raw.scorecardTotal ?? null,
    scorecardPassed: scorecard.passed ?? raw.scorecardPassed ?? null,
    scorecardBelow10: scorecard.below10 ?? raw.scorecardBelow10 ?? null,
    openBlockers: Array.isArray(raw.blockingReasons) ? raw.blockingReasons.length
      : (raw.openBlockers ?? null),
  };
}

function main() {
  const artifacts = AUTHORITATIVE_FINAL_ARTIFACTS.map(({ path: rel, role }) => extractArtifact(rel, role));

  const coherence = assessFinalCoherence({ artifacts: artifacts.filter((a) => a.present) });

  const semanticChecks = [];
  for (const artifact of artifacts.filter((a) => a.present)) {
    const verdict = assessRunStatusSemantics({
      runStatus: artifact.runStatus,
      scorecardTotal: artifact.scorecardTotal,
      scorecardPassed: artifact.scorecardPassed,
      scorecardBelow10: artifact.scorecardBelow10,
      openBlockers: artifact.openBlockers,
      semanticNote: artifact.semanticNote,
    });
    if (!verdict.coherent) semanticChecks.push({ path: artifact.path, ...verdict });
  }

  const report = {
    artifactType: 'final-snapshot-coherence',
    artifactVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    artifacts: artifacts.map((a) => ({
      path: a.path,
      role: a.role,
      present: a.present,
      runId: a.runId || null,
      decision: a.decision || null,
      normalizedDecision: a.normalizedDecision || null,
      lifecycle: a.lifecycle || 'CURRENT',
      runStatus: a.runStatus || null,
    })),
    coherence: {
      coherent: coherence.coherent,
      code: coherence.code,
      reason: coherence.reason,
      conflicts: coherence.conflicts,
      missingMarkers: coherence.missingMarkers,
    },
    semantics: semanticChecks,
    status: coherence.coherent && semanticChecks.length === 0 ? 'PASS' : 'FAIL',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (report.status === 'PASS') {
    console.log(`  [PASS] GOVERNANCE_FINAL_SNAPSHOT_COHERENCE — ${coherence.reason}`);
    console.log(`  [PASS] GOVERNANCE_STATUS_NUMBERS — nenhuma contradição status×números sem explicação`);
    console.log(`[final-snapshot-coherence] status=PASS artefatos=${artifacts.filter((a) => a.present).length}`);
    console.log(`[final-snapshot-coherence] relatório: ${path.relative(ROOT, REPORT_PATH)}`);
    return 0;
  }

  if (!coherence.coherent) {
    console.error(`  [FAIL] ${coherence.code} — ${coherence.reason}`);
    for (const conflict of coherence.conflicts) {
      console.error(`         run ${conflict.runId}:`);
      for (const p of conflict.goArtifacts) console.error(`           GO    ← ${p}`);
      for (const p of conflict.noGoArtifacts) console.error(`           NO_GO ← ${p}`);
    }
    for (const marker of coherence.missingMarkers) {
      console.error(`         marca de supersessão incompleta: ${marker.path} (${marker.detail})`);
    }
  }
  for (const semantic of semanticChecks) {
    console.error(`  [FAIL] ${semantic.code} — ${semantic.path}: ${semantic.reason}`);
  }
  console.error(`[final-snapshot-coherence] status=FAIL relatório: ${path.relative(ROOT, REPORT_PATH)}`);
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main, AUTHORITATIVE_FINAL_ARTIFACTS, extractArtifact };
