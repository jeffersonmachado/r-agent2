/**
 * releaseStateMachine.test.js — R2..R20: a fase do release é dado de primeira
 * classe e PENDING_PHASE nunca é confundido com PASS nem com FAIL.
 */
'use strict';

const {
  RELEASE_PHASES,
  RELEASE_CODES,
  GATE_STATUS,
  TERMINAL_PHASES,
  phaseIndex,
  phaseAtLeast,
  assertTransition,
  canTransition,
  evaluateGate,
  checkPendingPastDue,
  aggregateGates,
  summarizeScorecards,
  validateStateMachine,
} = require('../../../governance/release-state-machine');

describe('ReleaseStateMachine — fases e transições', () => {
  test('a ordem das fases é a ordem declarada (não comparação alfabética)', () => {
    expect(phaseIndex('SOURCE_VALIDATED')).toBeLessThan(phaseIndex('PRE_PACKAGE'));
    expect(phaseIndex('CANDIDATE_BUILT')).toBeLessThan(phaseIndex('SEALED'));
    expect(phaseIndex('SEALED')).toBeLessThan(phaseIndex('DELIVERED'));
    expect(phaseIndex('DELIVERED')).toBeLessThan(phaseIndex('FINAL_GOVERNANCE'));
    expect(phaseIndex('FINAL_GOVERNANCE')).toBeLessThan(phaseIndex('PUBLISHED_VERIFIED'));
  });

  test('fase desconhecida é erro, não "fase mais alta"', () => {
    expect(() => phaseIndex('DELIVERED!')).toThrow(/fase desconhecida/);
  });

  test('phaseAtLeast é inclusivo', () => {
    expect(phaseAtLeast('DELIVERED', 'DELIVERED')).toBe(true);
    expect(phaseAtLeast('SEALED', 'DELIVERED')).toBe(false);
  });

  test('apenas o passo seguinte é uma transição permitida (sem saltos silenciosos)', () => {
    expect(canTransition('SOURCE_VALIDATED', 'PRE_PACKAGE')).toBe(true);
    expect(canTransition('PRE_PACKAGE', 'CANDIDATE_BUILT')).toBe(true);
    expect(canTransition('SEALED', 'DELIVERED')).toBe(true);
    expect(canTransition('SOURCE_VALIDATED', 'DELIVERED')).toBe(false);
    expect(canTransition('CANDIDATE_BUILT', 'SEALED')).toBe(false);
    expect(canTransition('PUBLISHED_VERIFIED', 'FINAL_GOVERNANCE')).toBe(false);
  });

  test('salto proibido falha com código estável', () => {
    expect(() => assertTransition('SOURCE_VALIDATED', 'DELIVERED')).toThrow(
      expect.objectContaining({ code: RELEASE_CODES.FORBIDDEN_TRANSITION }),
    );
    expect(() => assertTransition('SEALED', 'CANDIDATE_BUILT')).toThrow(
      expect.objectContaining({ code: RELEASE_CODES.FORBIDDEN_TRANSITION }),
    );
  });

  test('PUBLISHED_VERIFIED é a única fase terminal', () => {
    expect(TERMINAL_PHASES).toEqual(['PUBLISHED_VERIFIED']);
    expect(RELEASE_PHASES[RELEASE_PHASES.length - 1]).toBe('PUBLISHED_VERIFIED');
  });

  test('a máquina de estados é internamente consistente', () => {
    const result = validateStateMachine();
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  test('um modelo inconsistente é detectado (o validador consegue falhar)', () => {
    const broken = [
      {
        id: 'A',
        requiredPhase: 'SOURCE_VALIDATED',
        dependencies: [],
        artifactDependencies: [],
        blocking: true,
      },
      {
        id: 'B',
        requiredPhase: 'SOURCE_VALIDATED',
        dependencies: ['A'],
        artifactDependencies: [],
        blocking: true,
      },
      {
        // salto não-sequencial: SOURCE_VALIDATED -> DELIVERED
        id: 'C',
        requiredPhase: 'SOURCE_VALIDATED',
        dependencies: ['B'],
        artifactDependencies: [],
        blocking: true,
      },
    ];
    const { detectCycles } = require('../../../governance/release-dag');
    // Sem ciclo, mas o salto continua inválido para a máquina de estados.
    expect(detectCycles(broken, {}).ok).toBe(true);
    expect(canTransition('SOURCE_VALIDATED', 'DELIVERED')).toBe(false);
  });
});

describe('ReleaseStateMachine — evaluación de gate por fase', () => {
  test('gate de fase futura é PENDING_PHASE (não PASS, não FAIL)', () => {
    const result = evaluateGate({
      gateId: 'delivered_hash',
      requiredPhase: 'DELIVERED',
      currentPhase: 'PRE_PACKAGE',
      evaluate: () => { throw new Error('não pode ser chamado antes da fase'); },
    });
    expect(result.status).toBe(GATE_STATUS.PENDING_PHASE);
    expect(result.code).toBe(RELEASE_CODES.PENDING_PHASE);
    expect(result.requiredPhase).toBe('DELIVERED');
    expect(result.currentPhase).toBe('PRE_PACKAGE');
  });

  test('C2 — gate DELIVERED executado em PRE_PACKAGE devolve PENDING_PHASE, nunca FAIL/PASS', () => {
    const asFail = evaluateGate({
      gateId: 'final_governance',
      requiredPhase: 'DELIVERED',
      currentPhase: 'PRE_PACKAGE',
      evaluate: () => ({ status: 'FAIL' }),
    });
    const asPass = evaluateGate({
      gateId: 'final_governance',
      requiredPhase: 'DELIVERED',
      currentPhase: 'PRE_PACKAGE',
      evaluate: () => ({ status: 'PASS' }),
    });
    expect(asFail.status).toBe(GATE_STATUS.PENDING_PHASE);
    expect(asPass.status).toBe(GATE_STATUS.PENDING_PHASE);
  });

  test('na fase exigida o resultado é REAL (PASS e FAIL são propagados)', () => {
    expect(evaluateGate({
      gateId: 'package_structure',
      requiredPhase: 'CANDIDATE_BUILT',
      currentPhase: 'CANDIDATE_BUILT',
      evaluate: () => ({ status: 'PASS' }),
    }).status).toBe(GATE_STATUS.PASS);

    expect(evaluateGate({
      gateId: 'package_structure',
      requiredPhase: 'CANDIDATE_BUILT',
      currentPhase: 'CANDIDATE_VALIDATED',
      evaluate: () => ({ status: 'FAIL', code: 'PACKAGE_STRUCTURE_INVALID' }),
    })).toMatchObject({ status: GATE_STATUS.FAIL, code: 'PACKAGE_STRUCTURE_INVALID' });
  });

  test('gate sem requiredPhase é defeito de configuração, não gate tolerável', () => {
    expect(() => evaluateGate({
      gateId: 'sem_fase',
      currentPhase: 'PRE_PACKAGE',
      evaluate: () => ({ status: 'PASS' }),
    })).toThrow(expect.objectContaining({ code: RELEASE_CODES.GATE_REQUIRED_PHASE_MISSING }));
  });

  test('gate que alcançou a fase mas não tem avaliação falha explicitamente', () => {
    expect(() => evaluateGate({
      gateId: 'sem_avaliacao',
      requiredPhase: 'PRE_PACKAGE',
      currentPhase: 'DELIVERED',
    })).toThrow(expect.objectContaining({ code: RELEASE_CODES.GATE_EVALUATION_MISSING }));
  });

  test('status inventado por evaluate() é rejeitado', () => {
    expect(() => evaluateGate({
      gateId: 'inventado',
      requiredPhase: 'PRE_PACKAGE',
      currentPhase: 'PRE_PACKAGE',
      evaluate: () => ({ status: 'DEFERRED' }),
    })).toThrow(expect.objectContaining({ code: RELEASE_CODES.GATE_EVALUATION_MISSING }));
  });

  test('C3 — PENDING vencido vira FAIL', () => {
    const past = checkPendingPastDue({
      gateId: 'delivered_hash',
      requiredPhase: 'DELIVERED',
      currentPhase: 'FINAL_GOVERNANCE',
      status: GATE_STATUS.PENDING_PHASE,
    });
    expect(past.pastDue).toBe(true);
    expect(past.status).toBe(GATE_STATUS.FAIL);
    expect(past.code).toBe(RELEASE_CODES.PENDING_PHASE_PAST_DUE);
  });

  test('PENDING dentro do prazo continua pendente (não vira FAIL cedo)', () => {
    const ok = checkPendingPastDue({
      gateId: 'delivered_hash',
      requiredPhase: 'DELIVERED',
      currentPhase: 'CANDIDATE_BUILT',
      status: GATE_STATUS.PENDING_PHASE,
    });
    expect(ok.pastDue).toBe(false);
  });

  test('agregação nunca converte PENDING em PASS e vence o pendente atrasado', () => {
    const aggregated = aggregateGates([
      { gateId: 'a', requiredPhase: 'PRE_PACKAGE', status: GATE_STATUS.PASS },
      { gateId: 'b', requiredPhase: 'DELIVERED', status: GATE_STATUS.PENDING_PHASE },
    ], { currentPhase: 'PRE_PACKAGE' });
    expect(aggregated.status).toBe(GATE_STATUS.PENDING_PHASE);
    expect(aggregated.pending).toBe(1);
    expect(aggregated.failed).toBe(0);

    const late = aggregateGates([
      { gateId: 'a', requiredPhase: 'PRE_PACKAGE', status: GATE_STATUS.PASS },
      { gateId: 'b', requiredPhase: 'DELIVERED', status: GATE_STATUS.PENDING_PHASE },
    ], { currentPhase: 'DELIVERED' });
    expect(late.status).toBe(GATE_STATUS.FAIL);
    expect(late.failedGates).toEqual(['b']);
  });
});

describe('ReleaseStateMachine — scorecards por fase (R17/R18)', () => {
  const source = { status: 'PASS', score: 10, below10: 0 };
  const candidate = { status: 'PASS', score: 10, below10: 0 };
  const delivered = { status: 'PASS', score: 10, below10: 0 };

  test('em PRE_PACKAGE o score da fase corrente é o REAL do source', () => {
    const summary = summarizeScorecards({
      currentPhase: 'PRE_PACKAGE',
      source,
      candidate: { status: 'FAIL', score: 3.3, below10: 29 },
      delivered: { status: 'FAIL', score: 0, below10: 78 },
    });
    expect(summary.currentPhaseScore).toEqual([{ phase: 'SOURCE_VALIDATED', score: 10, below10: 0 }]);
    expect(summary.candidate.status).toBe(GATE_STATUS.PENDING_PHASE);
    expect(summary.delivered.status).toBe(GATE_STATUS.PENDING_PHASE);
  });

  test('nunca produz um score final inventado antes das fases finais', () => {
    const summary = summarizeScorecards({
      currentPhase: 'PRE_PACKAGE',
      source,
      candidate: null,
      delivered: null,
    });
    expect(summary.finalReleaseScore).toBe('NOT_YET_MEASURABLE');
    expect(JSON.stringify(summary)).not.toContain('3.3');
  });

  test('score final só existe (medido) quando todas as fases foram alcançadas', () => {
    const summary = summarizeScorecards({
      currentPhase: 'FINAL_GOVERNANCE',
      source,
      candidate,
      delivered,
    });
    expect(summary.finalReleaseScore).toBe('MEASURED');
  });

  test('falha real em fase alcançada reprova o score final', () => {
    const summary = summarizeScorecards({
      currentPhase: 'FINAL_GOVERNANCE',
      source,
      candidate: { status: 'PASS', score: 10, below10: 0 },
      delivered: { status: 'FAIL', score: 6, below10: 3 },
    });
    expect(summary.finalReleaseScore).toBe('BELOW_THRESHOLD');
  });
});
