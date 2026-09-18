'use strict';

/**
 * §P1 FINAL_PROOF_DECISION_SEMANTICS — MATURIDADE ≠ DECISÃO.
 *
 * DEFEITO REPRODUZIDO (medido em `governance/final-proof-report.json`):
 *
 *   finalDecision: "NO_GO:AUTONOMOUS_READY_GO"
 *   blockingGaps: 1
 *
 * A string afirma as duas coisas ao mesmo tempo: quem faz
 * `startsWith('NO_GO')` lê BLOQUEIO; quem lê o rótulo lê "autonomous ready".
 * Nenhum consumidor consegue responder "está aprovado?" sem interpretar texto —
 * e um relatório assim é exatamente o tipo de ambiguidade que permite declarar
 * sucesso onde a governança diz o contrário.
 *
 * Invariantes provados:
 *   1. blocker obrigatório ⇒ `finalDecision` da família NO_GO;
 *   2. `candidateMaturityLevel` PRESERVA a maturidade técnica alcançada;
 *   3. `blockingReasons` é NOMINAL (inclui a causa de gate obrigatório);
 *   4. a string de decisão NUNCA carrega rótulo da família GO;
 *   5. sem blocker, a decisão segue o veredito da fase (nada é rebaixado por
 *      precaução nem promovido por conveniência).
 */

const {
  _internal: { _computeFinalDecisionSemantics, _computeMandatoryDecision },
} = require('../../../tools/system/platform-readiness');

const DECISION_IS_BLOCKED = (decision) => String(decision).startsWith('NO_GO');

describe('blocker obrigatório separa maturidade de decisão', () => {
  test('maturidade AUTONOMOUS_READY + evidência de QA vencida ⇒ NO_GO com causa nominal', () => {
    const result = _computeFinalDecisionSemantics({
      blockingGapIds: ['STALE_QA_EVIDENCE'],
      proofDecision: 'AUTONOMOUS_READY_GO',
    });

    expect(result.candidateMaturityLevel).toBe('AUTONOMOUS_READY_GO');
    expect(result.stageReadiness).toBe('AUTONOMOUS_READY_GO');
    expect(DECISION_IS_BLOCKED(result.finalDecision)).toBe(true);
    expect(result.blockingReasons).toContain('STALE_QA_EVIDENCE');
  });

  test('a decisão bloqueada NUNCA carrega rótulo da família GO', () => {
    const result = _computeFinalDecisionSemantics({
      blockingGapIds: ['STALE_QA_EVIDENCE'],
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(result.finalDecision).not.toContain('AUTONOMOUS_READY');
    expect(result.finalDecision).not.toBe('NO_GO:AUTONOMOUS_READY_GO');
  });

  test('gate mandatório bloqueado nomeia o gate e mantém a maturidade visível', () => {
    const result = _computeFinalDecisionSemantics({
      govDecision: 'NO_GO:STRICT_ENTERPRISE [visual_journeys]',
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(result.finalDecision).toMatch(/^NO_GO:MANDATORY_GATE_BLOCKED/);
    expect(result.blockingReasons.join(' ')).toContain('governance=NO_GO:STRICT_ENTERPRISE');
    expect(result.candidateMaturityLevel).toBe('AUTONOMOUS_READY_GO');
  });

  test('o wrapper legado devolve a MESMA decisão da função pura', () => {
    expect(_computeMandatoryDecision({ blockingGaps: 2, proofDecision: 'AUTONOMOUS_READY_GO' }))
      .toBe('NO_GO:BLOCKING_GAPS');
    expect(_computeMandatoryDecision({ proofDecision: 'AUTONOMOUS_READY_GO' }))
      .toBe('AUTONOMOUS_READY_GO');
  });
});

describe('sem blocker a decisão segue o veredito da fase', () => {
  test('proof GO e nenhum gap ⇒ mantém o veredito', () => {
    const result = _computeFinalDecisionSemantics({ proofDecision: 'AUTONOMOUS_READY_GO' });
    expect(result.finalDecision).toBe('AUTONOMOUS_READY_GO');
    expect(result.blockingReasons).toEqual([]);
    expect(result.candidateMaturityLevel).toBe('AUTONOMOUS_READY_GO');
  });

  test('governance com gate diferido NÃO promove a AUTONOMOUS_READY_GO', () => {
    const result = _computeFinalDecisionSemantics({
      govDecision: 'PASS_WITH_DEFERRED_PACKAGE_GATE',
      proofDecision: 'AUTONOMOUS_READY_GO',
    });
    expect(result.finalDecision).toBe('PASS_WITH_DEFERRED_PACKAGE_GATE');
  });

  test('maturidade de um proof já bloqueado não vira decisão', () => {
    const result = _computeFinalDecisionSemantics({ proofDecision: 'NO_GO:STRICT_ENTERPRISE' });
    expect(result.finalDecision).toBe('NO_GO:STRICT_ENTERPRISE');
    expect(DECISION_IS_BLOCKED(result.finalDecision)).toBe(true);
  });
});

describe('a maturidade nunca é derivada da CAUSA do bloqueio', () => {
  test('veredito bloqueado não publica a causa como estágio alcançado', () => {
    const result = _computeFinalDecisionSemantics({ proofDecision: 'NO_GO:BLOCKING_GAPS' });
    expect(result.candidateMaturityLevel).toBeNull();
    expect(result.candidateMaturityLevel).not.toBe('BLOCKING_GAPS');
  });

  test('estágio informado explicitamente é PRESERVADO mesmo com a decisão bloqueada', () => {
    const result = _computeFinalDecisionSemantics({
      proofDecision: 'NO_GO:BLOCKING_GAPS',
      candidateMaturity: 'ENTERPRISE_READY_GO',
    });
    expect(result.candidateMaturityLevel).toBe('ENTERPRISE_READY_GO');
    expect(DECISION_IS_BLOCKED(result.finalDecision)).toBe(true);
    expect(result.finalDecision).not.toContain('ENTERPRISE_READY');
  });

  test('o wrapper legado não inventa maturidade a partir do veredito', () => {
    expect(_computeMandatoryDecision({ proofDecision: 'NO_GO:UNKNOWN' })).toBe('NO_GO:UNKNOWN');
    expect(_computeMandatoryDecision({ proofDecision: 'ENTERPRISE_READY_GO' })).toBe('ENTERPRISE_READY_GO');
  });
});
