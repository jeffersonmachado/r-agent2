'use strict';

/**
 * Readiness Decision Engine — algoritmo ÚNICO de cálculo de prontidão de produção.
 *
 * Todos os módulos que precisam calcular ou verificar readiness DEVEM usar este módulo:
 *   - tools/system/platform-readiness.js
 *   - tools/system/recalculate-readiness.js
 *   - governance/readiness-drift-engine.js
 *   - governance/final-governance-engine.js
 *
 * Garante:
 *   - mesmo algoritmo
 *   - mesmos blockers
 *   - mesma classificação
 *   - mesma semântica
 *   - mesma origem
 *
 * Saída canônica: { decision, blockers[], components[], score, classification }
 */

const fs   = require('fs');
const path = require('path');
const { getPackageContext } = require('./package-context');

function readJsonSafe(relPath, ROOT) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, 'utf8')); } catch (_) { return null; }
}

// ─── Componentes de readiness ─────────────────────────────────────────────────

function evalMesh(ROOT) {
  const goNoGo  = readJsonSafe('qa-mesh/go-no-go-report.json', ROOT)    || {};
  const gate    = readJsonSafe('qa-mesh/release-gate-report.json', ROOT) || {};

  const meshStatus = goNoGo.status || goNoGo.gate;
  const gateStatus = gate.gate     || gate.status;
  const blocked    = meshStatus === 'NO_GO' || gateStatus === 'NO_GO';

  return {
    component:   'mesh',
    blocked,
    meshStatus:  meshStatus || 'UNKNOWN',
    gateStatus:  gateStatus || 'UNKNOWN',
    reasons:     goNoGo.reasons || [],
    blocker:     blocked ? `mesh=${meshStatus} gate=${gateStatus}` : null,
  };
}

function evalReplay(ROOT) {
  // Fonte autoritativa: replay-hardening-report (análise profunda de steps)
  const hardeningReport = readJsonSafe('governance/replay-hardening-report.json', ROOT);
  if (hardeningReport) {
    const blocked = !hardeningReport.pass;
    return {
      component:  'replay',
      blocked,
      decision:   hardeningReport.decision,
      violations: hardeningReport.violations || 0,
      source:     'replay-hardening-report.json',
      blocker:    blocked ? `replay-hardening=${hardeningReport.decision} violations=${hardeningReport.violations}` : null,
    };
  }

  // Fallback: proof-signature (menos completo)
  const proofSig = readJsonSafe('governance/proof-signature.json', ROOT) || {};
  const auditSigs = proofSig.signatureAudit?.signatures || [];
  const allValid  = auditSigs.length > 0 && auditSigs.every((s) => s.valid);
  const blocked   = !allValid;
  return {
    component:  'replay',
    blocked,
    source:     'proof-signature.json',
    blocker:    blocked ? `replay-signatures invalid` : null,
  };
}

function evalPackage(ROOT) {
  const ctx = getPackageContext(ROOT);
  if (!ctx.zipFound) {
    return {
      component: 'package',
      blocked:   true,
      blocker:   'ZIP não encontrado em dist/',
    };
  }
  if (!ctx.hashMatch) {
    return {
      component: 'package',
      blocked:   true,
      zipName:   ctx.zipName,
      blocker:   `package hash diverge: computed≠recorded [source: ${ctx.hashSource}]`,
    };
  }
  return {
    component: 'package',
    blocked:   false,
    zipName:   ctx.zipName,
    blocker:   null,
  };
}

function evalGovernanceConsistency(ROOT) {
  const consistency = readJsonSafe('governance/governance-consistency-report.json', ROOT) || {};
  const blocked = consistency.contradictions > 0 || consistency.pass === false;
  return {
    component: 'governance_consistency',
    blocked,
    contradictions: consistency.contradictions || 0,
    blocker: blocked ? `governance contradictions=${consistency.contradictions}` : null,
  };
}

function evalContamination(ROOT) {
  const contamination = readJsonSafe('governance/report-contamination-report.json', ROOT) || {};
  const blocked = contamination.pass === false || contamination.contaminatedFiles > 0;
  return {
    component:  'contamination',
    blocked,
    contaminations: contamination.totalContaminations || 0,
    blocker:    blocked ? `contamination=${contamination.totalContaminations} files=${contamination.contaminatedFiles}` : null,
  };
}

function evalGovernanceSignature(ROOT) {
  try {
    const { verifySeal } = require('../sign-governance');
    const distDir = path.join(ROOT, 'dist');
    const candidates = [
      path.join(ROOT, 'governance', 'governance.sig'),
      path.join(distDir, 'governance', 'governance.sig'),
      path.join(distDir, 'governance.sig'),
      path.join(distDir, 'governance-artifacts', 'governance.sig'),
    ];
    const sigPath = candidates.find((p) => fs.existsSync(p));
    if (!sigPath) {
      return { component: 'governance_signature', blocked: true, blocker: 'governance.sig não encontrado' };
    }

    // Se a chave de assinatura não está no ambiente, não é possível verificar —
    // isso não é tamper, é ausência de chave de CI; reportar como não-verificável.
    const hasKey = !!(process.env.REPLAY_SIGNING_KEY || process.env.ENCRYPTION_KEY);
    if (!hasKey) {
      return {
        component: 'governance_signature', blocked: false, blocker: null,
        note: 'REPLAY_SIGNING_KEY ausente no ambiente; verificação de assinatura pulada',
      };
    }

    const sig   = JSON.parse(fs.readFileSync(sigPath, 'utf8'));
    const valid = verifySeal(sig);
    return { component: 'governance_signature', blocked: !valid, blocker: valid ? null : 'governance signature inválida' };
  } catch (e) {
    return { component: 'governance_signature', blocked: true, blocker: `signature error: ${e.message}` };
  }
}

// ─── Blocking gaps do final-proof-report (FASE 16) ───────────────────────────
// A decisão de readiness DEVE consumir os findings do proof engine: um blocker
// fatal (severity 'critical') nunca pode coexistir com GO/AUTONOMOUS_READY.
// Gaps 'high' não bloqueiam a decisão, mas rebaixam o nível para
// CONTROLLED_PILOT (ver classifyReadinessLevel).
function evalProofGaps(ROOT) {
  const proof = readJsonSafe('governance/final-proof-report.json', ROOT);
  if (!proof) {
    return {
      component: 'proof_gaps',
      blocked:   true,
      fatalGaps: 0,
      highGaps:  0,
      blocker:   'final-proof-report.json ausente — blockingGaps não verificáveis',
    };
  }
  const gaps = Array.isArray(proof.blockingGaps) ? proof.blockingGaps : [];
  const fatal = gaps.filter((g) => g && g.severity === 'critical');
  const high  = gaps.filter((g) => g && g.severity === 'high');
  return {
    component: 'proof_gaps',
    blocked:   fatal.length > 0,
    fatalGaps: fatal.length,
    highGaps:  high.length,
    blocker:   fatal.length > 0
      ? `proof-blocking-gaps=${fatal.length} critical [${fatal.slice(0, 3).map((g) => g.id).join(', ')}]`
      : null,
  };
}

// ─── Níveis canônicos de readiness ────────────────────────────────────────────
// NO_GO             blockers fatais presentes
// CONTROLLED_PILOT  sem blocker fatal, mas com findings high pendentes
// PRODUCTION_READY  sem blockers e sem findings high
// AUTONOMOUS_READY  PRODUCTION_READY com score máximo (todos os componentes OK)
const READINESS_LEVELS = ['NO_GO', 'CONTROLLED_PILOT', 'PRODUCTION_READY', 'AUTONOMOUS_READY'];

function classifyReadinessLevel({ decision, score, components }) {
  if (String(decision).startsWith('NO_GO')) return 'NO_GO';
  const highFindings = components.reduce((acc, c) => acc + (Number(c.highGaps) || 0), 0);
  if (highFindings > 0) return 'CONTROLLED_PILOT';
  return score >= 100 ? 'AUTONOMOUS_READY' : 'PRODUCTION_READY';
}

// ─── Classificação da decisão ─────────────────────────────────────────────────
function classifyDecision(blockers) {
  if (blockers.length === 0) return 'AUTONOMOUS_READY_GO';

  // Classificação por tipo de bloqueio (ordem de prioridade)
  const has = (pattern) => blockers.some((b) => b && String(b).includes(pattern));

  if (has('mesh=NO_GO') || has('gate=NO_GO') || has('mesh='))
    return 'NO_GO:MESH_BLOCKED';
  if (has('proof-blocking-gaps=') || has('final-proof-report'))
    return 'NO_GO:PROOF_BLOCKING_GAPS';
  if (has('contamination=') || has('contaminations='))
    return 'NO_GO:CONTAMINATION_BLOCKED';
  if (has('replay-hardening=REPLAY_NO_GO') || has('replay-signatures'))
    return 'NO_GO:REPLAY_BLOCKED';
  if (has('package hash') || has('ZIP não encontrado'))
    return 'NO_GO:PACKAGE_BLOCKED';
  if (has('governance contradictions'))
    return 'NO_GO:GOVERNANCE_CONSISTENCY_BLOCKED';
  if (has('signature'))
    return 'NO_GO:SIGNATURE_BLOCKED';

  return `NO_GO:BLOCKED [${blockers.slice(0, 2).join(' | ')}]`;
}

// ─── API pública ───────────────────────────────────────────────────────────────
/**
 * Calcula readiness do zero a partir dos artefatos reais.
 * @param {string} ROOT — raiz do projeto
 * @returns {{ decision, classification, score, blockers, components, blockedCount }}
 */
function computeReadiness(ROOT) {
  const components = [
    evalMesh(ROOT),
    evalReplay(ROOT),
    evalPackage(ROOT),
    evalGovernanceConsistency(ROOT),
    evalContamination(ROOT),
    evalGovernanceSignature(ROOT),
    evalProofGaps(ROOT),
  ];

  const blocked    = components.filter((c) => c.blocked);
  const blockers   = blocked.map((c) => c.blocker).filter(Boolean);
  const decision   = classifyDecision(blockers);
  const score      = Math.round(((components.length - blocked.length) / components.length) * 100);
  const level      = classifyReadinessLevel({ decision, score, components });

  return {
    decision,
    classification: decision.startsWith('NO_GO') ? 'NO_GO' : 'GO',
    level,
    score,
    blockedCount:   blocked.length,
    blockers,
    components,
  };
}

module.exports = {
  computeReadiness,
  evalMesh,
  evalReplay,
  evalPackage,
  evalGovernanceConsistency,
  evalContamination,
  evalGovernanceSignature,
  evalProofGaps,
  classifyDecision,
  classifyReadinessLevel,
  READINESS_LEVELS,
};
