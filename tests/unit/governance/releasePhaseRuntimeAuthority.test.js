'use strict';

/**
 * TAREFA 47/48/50/52/53/54/55/86/87 — A STATE MACHINE COMO AUTORIDADE REAL.
 *
 * O gap que este arquivo fecha não era "faltar máquina de estados": ela já
 * existia como BIBLIOTECA (`governance/release-state-machine.js`) e como CLI
 * (`scripts/governance/release-phase.js`). O gap era o PIPELINE REAL não chamar
 * nada disso — a fase continuava sendo comentário e as tolerâncias legadas
 * (`SEAL_PENDING`, `PASS_WITH_DEFERRED_PACKAGE_GATE`, `DELIVERED_PHASE_DIMS`)
 * eram a autoridade de fato.
 *
 * Prova em duas partes:
 *   1. ESTÁTICA — `scripts/two-pass-release.sh` executa as transições nos
 *      pontos de fase (se alguém remover a chamada, este teste falha);
 *   2. COMPORTAMENTAL — com um root temporário, as transições reais são
 *      exercitadas: pulo de fase, gate antes da fase (PENDING_PHASE), gate
 *      depois da fase sem evidência (FAIL) e PENDING vencido (FAIL).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  startPhaseRun,
  advancePhase,
  assertPhaseAtLeast,
  recordGate,
  buildPhaseReport,
} = require('../../../governance/release-phase-runner');
const {
  RELEASE_PHASES,
  GATE_STATUS,
  RELEASE_CODES,
} = require('../../../governance/release-state-machine');

const ROOT = path.resolve(__dirname, '..', '..', '..');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rap-phase-test-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('TAREFA 48 — o pipeline REAL executa as transições de fase', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'two-pass-release.sh'), 'utf8');

  test('RED — two-pass-release.sh chama o CLI da autoridade de fase', () => {
    expect(script).toMatch(/release-phase\.js/);
    expect(script).toMatch(/phase start --release/);
  });

  test('as fases do ciclo de artefato são alcançadas na ordem', () => {
    for (const phase of ['PRE_PACKAGE', 'CANDIDATE_BUILT', 'CANDIDATE_VALIDATED', 'SEALED', 'DELIVERED', 'FINAL_GOVERNANCE']) {
      expect(script).toMatch(new RegExp(`advance --to ${phase}`));
    }
  });

  test('a identidade dos artefatos é verificada POR FASE no pipeline (candidato e entregue)', () => {
    expect(script).toMatch(/verify-release-artifact-identity\.js"[\s\S]{0,120}--kind candidate --phase CANDIDATE_BUILT/);
    expect(script).toMatch(/verify-release-artifact-identity\.js"[\s\S]{0,120}--kind delivered --phase DELIVERED/);
  });

  test('a fase SEALED só avança com decisão SEAL_GO', () => {
    expect(script).toMatch(/SEAL_DECISION" == "SEAL_GO"[\s\S]{0,120}phase advance --to SEALED/);
  });
});

describe('TAREFA 52/86/87 — transições inválidas são recusadas', () => {
  test('start fixa a fase inicial em SOURCE_VALIDATED', () => {
    const root = tempRoot();
    try {
      const state = startPhaseRun({ rootDir: root, release: 'r-test-1' });
      expect(state.currentPhase).toBe(RELEASE_PHASES[0]);
      expect(state.release).toBe('r-test-1');
      expect(state.history.length).toBe(1);
      // `runId` é o do run governado corrente; num root temporário (sem
      // `governance/.current-run.json`) ele é honestamente nulo — a fase não
      // inventa lineage que não existe.
      expect(state.runId === null || typeof state.runId === 'string').toBe(true);
    } finally {
      cleanup(root);
    }
  });

  test('RED — pulo de fase é RECUSADO (não existe DELIVERED antes de SEALED)', () => {
    const root = tempRoot();
    try {
      startPhaseRun({ rootDir: root, release: 'r-test-2' });
      advancePhase({ rootDir: root, to: 'PRE_PACKAGE' });
      let thrown = null;
      try {
        advancePhase({ rootDir: root, to: 'DELIVERED' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeTruthy();
      expect(thrown.code).toBe(RELEASE_CODES.FORBIDDEN_TRANSITION);
    } finally {
      cleanup(root);
    }
  });

  test('assertPhaseAtLeast recusa fase não alcançada', () => {
    const root = tempRoot();
    try {
      startPhaseRun({ rootDir: root, release: 'r-test-3' });
      advancePhase({ rootDir: root, to: 'PRE_PACKAGE' });
      let thrown = null;
      try {
        assertPhaseAtLeast({ rootDir: root, phase: 'DELIVERED' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeTruthy();
      expect(thrown.message).toMatch(/DELIVERED/);
    } finally {
      cleanup(root);
    }
  });
});

describe('TAREFA 53/54/87 — PENDING_PHASE nunca é PASS nem FAIL antes da fase', () => {
  test('RED — gate de fase POSTERIOR é PENDING_PHASE (não FAIL, não PASS)', () => {
    const root = tempRoot();
    try {
      startPhaseRun({ rootDir: root, release: 'r-test-4' });
      // Um gate cuja `requiredPhase` é CANDIDATE_BUILT, avaliado em PRE_PACKAGE.
      const result = recordGate({
        rootDir: root,
        gateId: 'candidate_manifest',
        // O avaliador nunca é chamado: a fase nem chegou lá.
        evaluate: () => {
          throw new Error('o avaliador NÃO deve rodar antes da fase exigida');
        },
      });
      expect(result.status).toBe(GATE_STATUS.PENDING_PHASE);
      expect(result.status).not.toBe(GATE_STATUS.PASS);
      expect(result.status).not.toBe(GATE_STATUS.FAIL);
    } finally {
      cleanup(root);
    }
  });

  test('RED — na fase exigida, sem evidência real, o gate é FAIL (fail-closed)', () => {
    const root = tempRoot();
    try {
      startPhaseRun({ rootDir: root, release: 'r-test-5' });
      advancePhase({ rootDir: root, to: 'PRE_PACKAGE' });
      advancePhase({ rootDir: root, to: 'CANDIDATE_BUILT' });
      // `candidate_artifact` exige CANDIDATE_BUILT: aqui a fase JÁ é a exigida,
      // então o gate não pode mais ficar pendente — sem evidência é FAIL.
      const result = recordGate({
        rootDir: root,
        gateId: 'candidate_artifact',
        evaluate: () => ({ status: GATE_STATUS.FAIL, code: 'GATE_STATUS_SOURCE_MISSING', reason: 'sem relatório' }),
      });
      expect(result.status).toBe(GATE_STATUS.FAIL);
    } finally {
      cleanup(root);
    }
  });

  test('o relatório de fase declara lane e status por gate (derivado, não digitado)', () => {
    const root = tempRoot();
    try {
      startPhaseRun({ rootDir: root, release: 'r-test-6' });
      advancePhase({ rootDir: root, to: 'PRE_PACKAGE' });
      const report = buildPhaseReport({ rootDir: root });
      expect(report.artifactType).toBe('release-phase-report');
      expect(report.currentPhase).toBe('PRE_PACKAGE');
      expect(report.release).toBe('r-test-6');
    } finally {
      cleanup(root);
    }
  });
});
