#!/usr/bin/env node
'use strict';

/**
 * validate-release-dag.js — gate do grafo de dependências do release.
 *
 * Roda ANTES de qualquer mutação de pacote. Ele prova três coisas sobre o
 * modelo de release (não sobre o workspace):
 *
 *   1. a máquina de estados é internamente consistente (transições completas,
 *      fases terminais, estados com inputs/outputs/gates);
 *   2. o DAG é ACÍCLICO — um ciclo significa que o pipeline exigiria um
 *      artefato que só existe depois do passo que o produz (o deadlock
 *      "para selar você precisa do selo");
 *   3. nenhum gate exige artefato de fase POSTERIOR à sua, e nenhum artefato
 *      exige o próprio hash.
 *
 * Saída: reports/release-dag-report.json + cópia canônica
 * governance/release-dag-report.json (packageRequired — verificada offline pelo
 * verify-payload-governance).
 *
 * Exit 1 em qualquer bloqueador. Nunca converte ciclo em aviso.
 */

const fs = require('fs');
const path = require('path');

const {
  RELEASE_PHASES,
  GATE_STATUS,
  TERMINAL_PHASES,
  validateStateMachine,
  phaseIndex,
} = require('../../governance/release-state-machine');
const {
  RELEASE_DAG_NODES,
  RELEASE_ARTIFACTS,
  validateReleaseDag,
  detectCycles,
} = require('../../governance/release-dag');

const ARTIFACT_TYPE = 'release-dag-report';
const ARTIFACT_VERSION = '1.0.0';
const ROOT = path.resolve(__dirname, '..', '..');

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function loadLineage() {
  const runContext = readJsonSafe(path.join(ROOT, 'governance', '.current-run.json'));
  if (!runContext || typeof runContext !== 'object') return {};
  return {
    runId: runContext.runId || null,
    sourceFingerprint: runContext.sourceFingerprint || null,
  };
}

function gatePhaseMatrix() {
  return RELEASE_DAG_NODES
    .slice()
    .sort((a, b) => phaseIndex(a.requiredPhase) - phaseIndex(b.requiredPhase) || a.id.localeCompare(b.id))
    .map((gate) => ({
      gate: gate.id,
      requiredPhase: gate.requiredPhase,
      blocking: gate.blocking,
      dependencies: gate.dependencies,
      artifactDependencies: gate.artifactDependencies,
      outputs: gate.outputs,
    }));
}

function main() {
  const machine = validateStateMachine();
  const dag = validateReleaseDag();
  const cycles = detectCycles();

  const blockers = [
    ...machine.problems.map((problem) => ({ ...problem, area: 'state_machine' })),
    ...dag.blockers,
  ];

  const status = blockers.length === 0 ? GATE_STATUS.PASS : GATE_STATUS.FAIL;
  const lineage = loadLineage();

  const report = {
    status,
    decision: status === GATE_STATUS.PASS
      ? 'RELEASE_DAG_ACYCLIC_AND_PHASE_AWARE'
      : 'RELEASE_DAG_INVALID',
    generatedAt: new Date().toISOString(),
    artifactType: ARTIFACT_TYPE,
    artifactVersion: ARTIFACT_VERSION,
    ...lineage,
    phases: RELEASE_PHASES,
    terminalPhases: TERMINAL_PHASES,
    nodeCount: dag.nodeCount,
    artifactCount: dag.artifactCount,
    cycleFound: !cycles.ok,
    cycles: cycles.cycles,
    cyclePaths: cycles.cycles.map((entry) => entry.join(' -> ')),
    phaseOrderViolations: dag.phaseOrderViolations,
    stateMachineProblems: machine.problems,
    blockers,
    gatePhaseMatrix: gatePhaseMatrix(),
  };

  const reportsDir = path.join(ROOT, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  // SOMENTE reports/ (ver nota em verify-release-artifact-identity.js): o gate
  // roda também DEPOIS do empacotamento, e uma cópia versionada em governance/
  // entraria no payload e viraria stale reference para o self-proving.
  fs.writeFileSync(path.join(reportsDir, 'release-dag-report.json'), serialized);

  console.log(`[release-dag] status=${status} decision=${report.decision}`);
  console.log(`[release-dag] nós=${dag.nodeCount} artefatos=${dag.artifactCount} ciclos=${cycles.cycles.length}`);
  if (cycles.cycles.length > 0) {
    for (const cycle of cycles.cycles) {
      console.log(`[release-dag] RELEASE_DEPENDENCY_CYCLE: ${cycle.join(' -> ')}`);
    }
  }
  if (blockers.length > 0) {
    for (const blocker of blockers) {
      console.log(`[release-dag] BLOQUEADOR ${blocker.code}: ${blocker.detail || JSON.stringify(blocker)}`);
    }
  }
  console.log('[release-dag] relatório: reports/release-dag-report.json');

  process.exit(status === GATE_STATUS.PASS ? 0 : 1);
}

main();
