#!/usr/bin/env node
'use strict';

/**
 * Readiness Drift Engine — detecta drift semântico entre readiness persistido e recalculado.
 *
 * Drift existe quando os dois engines produzem resultados semanticamente diferentes:
 *   - classificação diferente (GO vs NO_GO)
 *   - blockers diferentes (causas diferentes)
 *   - score diferente (acima de tolerância)
 *   - decisão diferente (mesmo que ambos NO_GO mas por razões distintas)
 *   - origem diferente (engines divergindo sobre a mesma realidade)
 *
 * REGRA CENTRAL: se ambos são NO_GO mas por RAZÕES DIFERENTES, é SEMANTIC_DRIFT.
 * Não basta ambos dizerem NO_GO — devem dizer NO_GO pelo MESMO motivo.
 *
 * Resultado: READINESS_DRIFT_NO_GO se qualquer drift for detectado.
 */

const fs   = require('fs');
const path = require('path');

const ROOT        = path.join(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'governance', 'readiness-drift-report.json');

const { computeReadiness } = require('./shared/readiness-decision-engine');

function readJsonSafe(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Classificar a decisão em categoria semântica ────────────────────────────
function classifyBlocker(decision) {
  if (!decision) return 'UNKNOWN';
  const d = String(decision);
  if (d.includes('MESH'))         return 'MESH_BLOCKED';
  if (d.includes('CONTAMINATION')) return 'CONTAMINATION_BLOCKED';
  if (d.includes('REPLAY'))       return 'REPLAY_BLOCKED';
  if (d.includes('PACKAGE'))      return 'PACKAGE_BLOCKED';
  if (d.includes('SIGNATURE'))    return 'SIGNATURE_BLOCKED';
  if (d.includes('GOVERNANCE'))   return 'GOVERNANCE_BLOCKED';
  if (d.includes('RECALC'))       return 'RECALC_BLOCKED';
  if (d.startsWith('NO_GO'))      return 'GENERIC_BLOCKED';
  if (d === 'AUTONOMOUS_READY_GO') return 'GO';
  return 'UNKNOWN';
}

// ─── Ler readiness persistido (fonte autoritativa) ───────────────────────────
function readPersistedReadiness() {
  // Fonte autoritativa: final-readiness-report (gerado pelo platform-readiness.js)
  const readiness = readJsonSafe('governance/final-readiness-report.json');
  if (readiness) {
    const dec = readiness.finalDecision || readiness.status;
    return {
      decision:       dec,
      classification: classifyBlocker(dec),
      score:          readiness.readinessScore || readiness.score || null,
      blockers:       readiness.blockers || [],
      source:         'governance/final-readiness-report.json',
    };
  }

  // Fallback secundário: final-proof-report
  const proof = readJsonSafe('governance/final-proof-report.json');
  if (proof) {
    const dec = proof.finalDecision;
    return {
      decision:       dec,
      classification: classifyBlocker(dec),
      score:          proof.overallSelfProofScore || null,
      blockers:       proof.blockers || [],
      source:         'governance/final-proof-report.json',
    };
  }

  return { decision: null, classification: 'UNKNOWN', score: null, blockers: [], source: 'not-found' };
}

// ─── Drift checks ─────────────────────────────────────────────────────────────

function checkClassificationDrift(persisted, recalc) {
  const pClass = persisted.classification.startsWith('GO') ? 'GO' : 'NO_GO';
  const rClass = recalc.classification.startsWith('GO')   ? 'GO' : 'NO_GO';
  const drift  = pClass !== rClass;
  return {
    type:      'CLASSIFICATION_DRIFT',
    severity:  drift ? 'CRITICAL' : 'OK',
    drift,
    persisted: pClass,
    recalculated: rClass,
    message:   drift ? `Classificação diverge: persistido=${pClass} recalculado=${rClass}` : null,
  };
}

function checkBlockerDrift(persisted, recalc) {
  // Aplicar classifyBlocker à decisão recalculada também, para comparar na mesma escala
  const pBlockerClass = persisted.classification;
  const rBlockerClass = classifyBlocker(recalc.decision);
  // Drift semântico: ambos NO_GO mas por razões de categorias diferentes
  const pIsNoGo = pBlockerClass !== 'GO' && pBlockerClass !== 'UNKNOWN';
  const rIsNoGo = rBlockerClass !== 'GO' && rBlockerClass !== 'UNKNOWN';

  if (pIsNoGo && rIsNoGo && pBlockerClass !== rBlockerClass) {
    return {
      type:        'BLOCKER_SEMANTIC_DRIFT',
      severity:    'HIGH',
      drift:       true,
      persistedBlocker:   pBlockerClass,
      recalcBlocker:      rBlockerClass,
      persistedDecision:  persisted.decision,
      recalcDecision:     recalc.decision,
      message:     `Drift semântico: ambos NO_GO mas causas divergem — persistido=${pBlockerClass} recalculado=${rBlockerClass}`,
    };
  }

  return {
    type:      'BLOCKER_SEMANTIC_DRIFT',
    severity:  'OK',
    drift:     false,
    persistedBlocker:  pBlockerClass,
    recalcBlocker:     rBlockerClass,
  };
}

function checkDecisionDrift(persisted, recalc) {
  // Comparar categorias semânticas — não strings brutas que podem ter detalhes diferentes
  const pClass = classifyBlocker(persisted.decision);
  const rClass = classifyBlocker(recalc.decision);
  // Drift ocorre quando as CATEGORIAS semânticas diferem
  const drift = pClass !== rClass;
  return {
    type:      'DECISION_DRIFT',
    severity:  drift ? 'HIGH' : 'OK',
    drift,
    persistedCategory:    pClass,
    recalcCategory:       rClass,
    persisted:            persisted.decision,
    recalculated:         recalc.decision,
    message:   drift ? `Decisão semântica diverge: persistido=${pClass} recalculado=${rClass}` : null,
  };
}

function checkScoreDrift(persisted, recalc, tolerance = 15) {
  if (persisted.score == null || recalc.score == null) {
    return { type: 'SCORE_DRIFT', severity: 'OK', drift: false, note: 'score não disponível' };
  }
  const delta = Math.abs(persisted.score - recalc.score);
  const drift  = delta > tolerance;
  return {
    type:         'SCORE_DRIFT',
    severity:     drift ? 'HIGH' : 'OK',
    drift,
    persisted:    persisted.score,
    recalculated: recalc.score,
    delta,
    tolerance,
    message:      drift ? `Score diverge: persistido=${persisted.score} recalculado=${recalc.score} delta=${delta} (tolerância=${tolerance})` : null,
  };
}

function checkComponentDrift(persisted, recalc) {
  // Detectar componentes que bloqueiam de forma DIFERENTE entre persisted e recalc.
  // Se ambos concordam que um componente está bloqueado: NÃO é drift, é consistência.
  // Drift = componente bloqueado em recalc mas não refletido no persisted (ou vice-versa).
  const criticalComponents = ['mesh', 'replay', 'package'];
  const blockedInRecalc = recalc.components
    .filter((c) => criticalComponents.includes(c.component) && c.blocked)
    .map((c) => c.component);

  // Verificar se o persisted classifica o mesmo componente como bloqueado
  const persistedBlockerClass = persisted.classification;
  const recalcBlockerClass    = classifyBlocker(recalc.decision);

  // Se o componente crítico bloqueado no recalc coincide com a categoria do persisted: sem drift
  const componentCategoryMap = {
    mesh:    'MESH_BLOCKED',
    replay:  'REPLAY_BLOCKED',
    package: 'PACKAGE_BLOCKED',
  };

  const unexplainedBlocks = blockedInRecalc.filter((comp) => {
    const expectedClass = componentCategoryMap[comp];
    return expectedClass && persistedBlockerClass !== expectedClass && recalcBlockerClass !== expectedClass;
  });

  if (unexplainedBlocks.length > 0) {
    return {
      type:     'COMPONENT_DRIFT',
      severity: 'HIGH',
      drift:    true,
      blocked:  blockedInRecalc,
      unexplained: unexplainedBlocks,
      message:  `Componentes bloqueados não refletidos no persisted: ${unexplainedBlocks.join(', ')}`,
    };
  }

  return {
    type:    'COMPONENT_DRIFT',
    severity: 'OK',
    drift:   false,
    blocked: blockedInRecalc,
    note:    blockedInRecalc.length > 0 ? `Componentes bloqueados consistentemente: ${blockedInRecalc.join(', ')}` : 'Sem componentes críticos bloqueados',
  };
}

// ─── Motor principal ──────────────────────────────────────────────────────────
function runReadinessDriftEngine() {
  const persisted = readPersistedReadiness();
  const recalc    = computeReadiness(ROOT);

  const checks = [
    checkClassificationDrift(persisted, recalc),
    checkBlockerDrift(persisted, recalc),
    checkDecisionDrift(persisted, recalc),
    checkScoreDrift(persisted, recalc),
    checkComponentDrift(persisted, recalc),
  ];

  const drifts   = checks.filter((c) => c.drift);
  const criticals = drifts.filter((c) => c.severity === 'CRITICAL');
  const highs     = drifts.filter((c) => c.severity === 'HIGH');
  const hasDrift  = drifts.length > 0;

  const report = {
    generatedAt:         new Date().toISOString(),
    engine:              'readiness-drift-engine/v1',
    pass:                !hasDrift,
    decision:            hasDrift ? 'READINESS_DRIFT_NO_GO' : 'READINESS_NO_DRIFT',
    driftDetected:       hasDrift,
    driftCount:          drifts.length,
    criticalDrifts:      criticals.length,
    highDrifts:          highs.length,
    persisted: {
      decision:       persisted.decision,
      classification: persisted.classification,
      score:          persisted.score,
      source:         persisted.source,
    },
    recalculated: {
      decision:       recalc.decision,
      classification: recalc.classification,
      score:          recalc.score,
      blockedCount:   recalc.blockedCount,
    },
    checks,
    driftDetails:        drifts.map((d) => ({ type: d.type, severity: d.severity, message: d.message })),
    summary: hasDrift
      ? `DRIFT DETECTADO: ${drifts.length} tipo(s) — persisted=${persisted.decision} recalc=${recalc.decision}`
      : `Readiness estável. Nenhum drift detectado. Decisão: ${recalc.decision}`,
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

module.exports = { runReadinessDriftEngine };

if (require.main === module) {
  const report = runReadinessDriftEngine();
  // eslint-disable-next-line no-console
  console.log(`[readiness-drift] decision=${report.decision} drifts=${report.driftCount} critical=${report.criticalDrifts}`);
  process.exit(report.pass ? 0 : 1);
}
