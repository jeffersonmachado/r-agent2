#!/usr/bin/env node
'use strict';

/**
 * Final Consistency Gate — verifica que TODOS os engines de governança concordam.
 *
 * Nenhum engine pode divergir de outro. Se qualquer engine diz NO_GO
 * enquanto outro diz GO, ou se engines que deveriam concordar discordam,
 * o gate bloqueia com FINAL_CONSISTENCY_NO_GO.
 *
 * Verifica:
 *   1. Replay consistency (hardening vs consistency)
 *   2. Readiness consistency (persisted vs recalculated)
 *   3. Package consistency (integrity vs validation report)
 *   4. Governance consistency (final-governance vs consistency-engine)
 *   5. Contamination consistency (sem GO legado nos relatórios)
 *   6. Cross-engine decision alignment
 *
 * Único ponto de falha para AUTONOMOUS_READY_GO.
 */

const fs   = require('fs');
const path = require('path');
const { assertSourceFreeze, readRunContext } = require('./shared/run-context');
const {
  gate: authorityGate,
  evaluateMasterScorecard,
  evaluateSelfProof,
  evaluateTamperDetection,
  evaluateFinalProof,
  evaluateFinalReadiness,
  evaluateFinalGovernance,
} = require('./shared/certification-authority');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'final-consistency-gate-report.json');

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

function isGo(decision) {
  if (!decision) return null; // indeterminado
  const d = String(decision);
  const goDecisions = new Set([
    'AUTONOMOUS_READY_GO',
    'GO',
    'FINAL_CONSISTENCY_GO',
    'REPLAY_HARDENING_GO',
    'REPLAY_CONSISTENCY_GO',
    'CONSISTENCY_GO',
    'PACKAGE_INTEGRITY_GO',
  ]);
  if (goDecisions.has(d)) return true;
  if (d.startsWith('NO_GO')) return false;
  return null;
}

// ─── Check 1: Replay consistency ─────────────────────────────────────────────
function checkReplayConsistency() {
  const hardening   = readJsonSafe('governance/replay-hardening-report.json');
  const consistency = readJsonSafe('governance/replay-consistency-report.json');

  if (!hardening || !consistency) {
    return {
      check:    'replay_consistency',
      pass:     false,
      severity: 'CRITICAL',
      reason:   `Relatório ausente: hardening=${!!hardening} consistency=${!!consistency}`,
    };
  }

  const hGo = isGo(hardening.decision);
  const cGo = isGo(consistency.decision);

  if (hGo !== true || cGo !== true) {
    return {
      check:      'replay_consistency',
      pass:       false,
      severity:   'CRITICAL',
      hardeningDecision:   hardening.decision,
      consistencyDecision: consistency.decision,
      reason:     `Replay obrigatório não está GO: hardening=${hardening.decision || 'UNKNOWN'} consistency=${consistency.decision || 'UNKNOWN'}`,
    };
  }

  return {
    check:      'replay_consistency',
    pass:       true,
    severity:   'OK',
    hardeningDecision:   hardening.decision,
    consistencyDecision: consistency.decision,
    reason:     null,
  };
}

// ─── Check 2: Readiness consistency ──────────────────────────────────────────
function checkReadinessConsistency() {
  const driftReport = readJsonSafe('governance/readiness-drift-report.json');

  if (!driftReport) return {
    check: 'readiness_consistency', pass: false, severity: 'CRITICAL',
    reason: 'readiness-drift-report ausente',
  };

  const pass = driftReport.pass === true;
  return {
    check:    'readiness_consistency',
    pass,
    severity: pass ? 'OK' : 'CRITICAL',
    driftDecision: driftReport.decision,
    driftCount:    driftReport.driftCount,
    reason:   pass ? null : `Readiness drift detectado: ${driftReport.driftCount} tipo(s) — ${driftReport.decision}`,
  };
}

// ─── Check 3: Package consistency ────────────────────────────────────────────
function checkPackageConsistency() {
  const integrityReport  = readJsonSafe('governance/package-integrity-report.json');
  const validationReport = readJsonSafe('governance/package-validation-report.json');

  if (!integrityReport || !validationReport) {
    return {
      check: 'package_consistency', pass: false, severity: 'CRITICAL',
      reason: `Relatório de pacote ausente: integrity=${!!integrityReport} validation=${!!validationReport}`,
    };
  }

  const integrityGo  = isGo(integrityReport.decision);
  const validationOk = validationReport.ok === true;

  // Integrity falhou
  if (integrityGo === false) {
    return {
      check:    'package_consistency',
      pass:     false,
      severity: 'CRITICAL',
      integrityDecision: integrityReport.decision,
      failedChecks: integrityReport.failedChecks,
      reason:   `Package integrity falhou: ${integrityReport.decision} (${integrityReport.failedChecks} checks falharam)`,
    };
  }

  if (integrityGo !== true || validationOk !== true) {
    return {
      check:    'package_consistency',
      pass:     false,
      severity: 'HIGH',
      reason:   `Package obrigatório não está PASS: integrity=${integrityReport.decision || 'UNKNOWN'} validation=${validationReport.ok}`,
    };
  }

  return { check: 'package_consistency', pass: true, severity: 'OK' };
}

// ─── Check 4: Governance engine consistency ───────────────────────────────────
function checkGovernanceConsistency() {
  const govReport   = readJsonSafe('governance/final-governance-report.json');
  const consistReport = readJsonSafe('governance/governance-consistency-report.json');

  if (!govReport || !consistReport) {
    return {
      check: 'governance_engine_consistency', pass: false, severity: 'CRITICAL',
      reason: `Relatório de governança ausente: final=${!!govReport} consistency=${!!consistReport}`,
    };
  }

  const govGo    = isGo(govReport.finalDecision);
  const consistGo = consistReport ? isGo(consistReport.decision) : null;

  if (govGo !== true || consistGo !== true) {
    return {
      check:      'governance_engine_consistency',
      pass:       false,
      severity:   'CRITICAL',
      govDecision:     govReport.finalDecision,
      consistDecision: consistReport.decision,
      reason:     `Governança obrigatória não está GO: final=${govReport.finalDecision || 'UNKNOWN'} consistency=${consistReport.decision || 'UNKNOWN'}`,
    };
  }

  return {
    check:      'governance_engine_consistency',
    pass:       true,
    severity:   'OK',
    govDecision:     govReport.finalDecision,
    consistDecision: consistReport?.decision || 'not-generated',
  };
}

// ─── Check 5: Contamination consistency ──────────────────────────────────────
function checkContaminationConsistency() {
  const contamReport = readJsonSafe('governance/report-contamination-report.json');

  if (!contamReport) {
    return {
      check: 'contamination_consistency', pass: false, severity: 'HIGH',
      reason: 'report-contamination-report ausente',
    };
  }

  const pass = contamReport.pass === true && contamReport.decision === 'NO_CONTAMINATION';
  return {
    check:          'contamination_consistency',
    pass,
    severity:       pass ? 'OK' : 'CRITICAL',
    contaminatedFiles: contamReport.contaminatedFiles,
    totalContaminations: contamReport.totalContaminations,
    reason:         pass ? null : `${contamReport.totalContaminations} contaminação(ões) em ${contamReport.contaminatedFiles} arquivo(s): ${contamReport.decision}`,
  };
}

function checkRunContext() {
  try {
    const runContext = assertSourceFreeze({ rootDir: ROOT, stage: 'final-consistency' });
    return authorityGate('run_context', true, runContext, null, { runContext });
  } catch (error) {
    let runContext = null;
    try { runContext = readRunContext(ROOT); } catch (_) {}
    return authorityGate('run_context', false, runContext, `${error.code || 'INVALID_RUN_CONTEXT'}: ${error.message}`, { runContext });
  }
}

function buildFinalConsistencyAuthorityChecks({
  runContext,
  scorecard,
  selfProof,
  tamper,
  proof,
  readiness,
  finalGovernance,
} = {}) {
  return [
    evaluateMasterScorecard(scorecard, runContext),
    evaluateSelfProof(selfProof, runContext),
    evaluateTamperDetection(tamper, runContext),
    evaluateFinalProof(proof, runContext),
    evaluateFinalReadiness(readiness, runContext),
    evaluateFinalGovernance(finalGovernance, runContext),
  ];
}

// ─── Check 6: Cross-engine decision alignment ────────────────────────────────
// Verifica engines que medem o MESMO domínio e devem concordar entre si.
// Sub-engines (package-integrity, replay-hardening) podem ser GO enquanto
// engines superiores são NO_GO — isso é esperado e NÃO é contradição.
function checkCrossEngineAlignment() {
  const contradictions = [];

  // Par 1: replay-hardening vs replay-consistency (mesmo domínio de replay)
  const hardening   = readJsonSafe('governance/replay-hardening-report.json');
  const consistency = readJsonSafe('governance/replay-consistency-report.json');
  if (hardening && consistency) {
    const hGo = isGo(hardening.decision);
    const cGo = isGo(consistency.decision);
    if (hGo === false && cGo === true) {
      contradictions.push({
        pair:    'replay-hardening vs replay-consistency',
        left:    hardening.decision,
        right:   consistency.decision,
        message: `replay-hardening=${hardening.decision} mas replay-consistency=${consistency.decision}`,
      });
    }
  }

  // Par 2: final-governance vs governance-consistency (domínios complementares)
  // governance-consistency verifica INCONSISTÊNCIAS entre relatórios;
  // final-governance verifica PRONTIDÃO para deploy.
  // A contradição real: governance diz AUTONOMOUS_READY_GO mas consistency diz NO_GO.
  const govReport   = readJsonSafe('governance/final-governance-report.json');
  const consistRep  = readJsonSafe('governance/governance-consistency-report.json');
  if (govReport && consistRep) {
    const gGo = isGo(govReport.finalDecision);
    const cGo = isGo(consistRep.decision);
    // Governance GO + consistency NO_GO = contradição (não pode estar pronto se há inconsistências)
    if (gGo === true && cGo === false) {
      contradictions.push({
        pair:    'final-governance vs governance-consistency',
        left:    govReport.finalDecision,
        right:   consistRep.decision,
        message: `final-governance=${govReport.finalDecision} mas consistency detectou inconsistências: ${consistRep.decision}`,
      });
    }
    // Nota: governance=NO_GO + consistency=GO é esperado (mesh pode bloquear sem inconsistências)
  }

  // Par 3: readiness-drift vs final-readiness (mesmo domínio de readiness)
  const driftRep    = readJsonSafe('governance/readiness-drift-report.json');
  const readinessRep = readJsonSafe('governance/final-readiness-report.json');
  if (driftRep && readinessRep) {
    const readinessGo = isGo(readinessRep.finalDecision || readinessRep.status);
    const driftPass   = driftRep.pass === true;
    // Readiness diz GO mas drift detectado = contradição
    if (readinessGo === true && !driftPass) {
      contradictions.push({
        pair:    'final-readiness vs readiness-drift',
        left:    readinessRep.finalDecision || readinessRep.status,
        right:   driftRep.decision,
        message: `final-readiness=${readinessRep.finalDecision} mas readiness-drift detectou drift`,
      });
    }
  }

  // Par 4: contamination + qualquer engine afirmando GO final
  const contamRep = readJsonSafe('governance/report-contamination-report.json');
  if (contamRep && !contamRep.pass) {
    // Se contamination detectou problemas, nenhum engine superior pode dizer AUTONOMOUS_READY_GO
    if (govReport && govReport.finalDecision === 'AUTONOMOUS_READY_GO') {
      contradictions.push({
        pair:    'contamination vs final-governance',
        left:    contamRep.decision,
        right:   govReport.finalDecision,
        message: `Contaminação detectada mas final-governance diz AUTONOMOUS_READY_GO`,
      });
    }
  }

  const pass = contradictions.length === 0;

  // Coletar todas as decisões para referência
  const allDecisions = [
    hardening   && { engine: 'replay-hardening',    decision: hardening.decision },
    consistency && { engine: 'replay-consistency',  decision: consistency.decision },
    govReport   && { engine: 'final-governance',    decision: govReport.finalDecision },
    consistRep  && { engine: 'governance-consistency', decision: consistRep.decision },
    driftRep    && { engine: 'readiness-drift',     decision: driftRep.decision },
    contamRep   && { engine: 'contamination',       decision: contamRep.decision },
  ].filter(Boolean);

  return {
    check:       'cross_engine_alignment',
    pass,
    severity:    pass ? 'OK' : 'CRITICAL',
    contradictions,
    allDecisions,
    reason:      pass ? null : `${contradictions.length} contradição(ões) entre engines do mesmo domínio`,
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runFinalConsistencyGate() {
  const runCheck = checkRunContext();
  let runContext = runCheck.runContext || null;
  if (!runContext) {
    try { runContext = readRunContext(ROOT); } catch (_) {}
  }
  const authorityChecks = buildFinalConsistencyAuthorityChecks({
    runContext,
    scorecard:       readJsonSafe('governance/rap-master-scorecard.json'),
    selfProof:       readJsonSafe('governance/self-proving-report.json'),
    tamper:          readJsonSafe('governance/tamper-detection-report.json'),
    proof:           readJsonSafe('governance/final-proof-report.json'),
    readiness:       readJsonSafe('governance/final-readiness-report.json'),
    finalGovernance: readJsonSafe('governance/final-governance-report.json'),
  });
  const checks = [
    runCheck,
    ...authorityChecks,
    checkReplayConsistency(),
    checkReadinessConsistency(),
    checkPackageConsistency(),
    checkGovernanceConsistency(),
    checkContaminationConsistency(),
    checkCrossEngineAlignment(),
  ];

  const failed    = checks.filter((c) => !c.pass);
  const criticals = failed.filter((c) => c.severity === 'CRITICAL');
  const highs     = failed.filter((c) => c.severity === 'HIGH');
  const pass      = failed.length === 0;

  const report = {
    generatedAt:      new Date().toISOString(),
    engine:           'final-consistency-gate/v1',
    artifactType:     'final-consistency-report',
    artifactVersion:  '2.0.0',
    runId:            runContext?.runId || null,
    sourceFingerprint: runContext?.sourceFingerprint || null,
    pass,
    decision:         pass ? 'FINAL_CONSISTENCY_GO' : 'FINAL_CONSISTENCY_NO_GO',
    totalChecks:      checks.length,
    failedChecks:     failed.length,
    criticalFailures: criticals.length,
    highFailures:     highs.length,
    checks,
    failures:         failed.map((c) => ({ check: c.check, severity: c.severity, reason: c.reason })),
    summary: pass
      ? `Todos os ${checks.length} engines concordam. Consistência final validada.`
      : `${failed.length} inconsistência(s) entre engines: ${criticals.length} crítica(s). BLOQUEADO.`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = {
  runFinalConsistencyGate,
  buildFinalConsistencyAuthorityChecks,
  checkRunContext,
  isGo,
};

if (require.main === module) {
  const report = runFinalConsistencyGate();
  // eslint-disable-next-line no-console
  console.log(`[final-consistency-gate] decision=${report.decision} failed=${report.failedChecks} critical=${report.criticalFailures}`);
  process.exit(report.pass ? 0 : 1);
}
