#!/usr/bin/env node
'use strict';

/**
 * validate-readiness-consistency.js — GATE §G4/§G5 (bloqueante).
 *
 * Invariante: para a MESMA identidade (`runId` + `sourceFingerprint`), todos os
 * artefatos que publicam CORE readiness devem concordar em estado, score,
 * `blockingGaps` e decisão. Divergência (ex.: 100 × 0) é FALHA DE GOVERNANÇA.
 *
 * O gate NUNCA escolhe o valor mais favorável e nunca degrada divergência para
 * aviso: um número que se contradiz não é evidência.
 *
 * Artefatos varridos (superfícies que publicam readiness):
 *   - governance/final-readiness-report.json
 *   - dev/platform-readiness/latest.json
 *   - docs/governance/_platform-status-source.json
 *   - governance/final-proof-report.json (quando publica core readiness)
 *   - reports/final-readiness-report.json (se existir)
 *
 * Saída: `reports/readiness-consistency-report.json`.
 * Uso: node scripts/governance/validate-readiness-consistency.js [--json]
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  evaluateReadinessConsistency,
} = require('../../governance/readiness-consistency');

const ROOT_DIR = path.join(__dirname, '..', '..');
const REPORT_PATH = path.join(ROOT_DIR, 'reports', 'readiness-consistency-report.json');

const ARTIFACT_CANDIDATES = Object.freeze([
  'governance/final-readiness-report.json',
  'dev/platform-readiness/latest.json',
  'docs/governance/_platform-status-source.json',
  'governance/final-proof-report.json',
  'governance/final-governance-report.json',
  'reports/final-readiness-report.json',
]);

function gitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function loadArtifacts() {
  const entries = [];
  const present = [];
  for (const rel of ARTIFACT_CANDIDATES) {
    const abs = path.join(ROOT_DIR, rel);
    if (!fs.existsSync(abs)) continue;
    present.push(rel);
    let artifact = null;
    try {
      artifact = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (_) {
      artifact = null;
    }
    entries.push({ path: rel, artifact });
  }
  return { entries, present };
}

function main() {
  const { entries, present } = loadArtifacts();
  const result = evaluateReadinessConsistency(entries);

  const report = {
    reportType: 'readiness-consistency',
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    status: result.status,
    invariantFields: ['coreReadinessState', 'coreReadinessScore', 'blockingGapsCount', 'finalDecision'],
    artifactsScanned: present,
    groups: result.groups,
    violations: result.violations,
    // Artefatos sem bloco de core readiness ou sem identidade completa NÃO
    // passam a valer PASS: ficam registrados como não-verificáveis.
    unverifiableArtifacts: result.unreadable,
    decision: result.status === 'PASS' ? 'READINESS_CONSISTENT' : 'READINESS_INCONSISTENT',
  };

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[readiness-consistency] status=${report.status} grupos=${report.groups.length} `
      + `violações=${report.violations.length} nao-verificaveis=${report.unverifiableArtifacts.length}\n`,
    );
    for (const group of report.groups) {
      process.stdout.write(
        `  - ${group.runId.slice(0, 22)}… ${group.consistent ? 'CONSISTENTE' : 'INCONSISTENTE'} `
        + `(${group.members.map((m) => `${m.path.split('/').pop()}=${m.coreReadinessScore}`).join(', ')})\n`,
      );
    }
    for (const violation of report.violations) {
      process.stdout.write(`  ! ${violation.code} campo=${violation.field} valores=${JSON.stringify(violation.values)}\n`);
    }
  }

  process.exit(report.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { main, REPORT_PATH, ARTIFACT_CANDIDATES };
