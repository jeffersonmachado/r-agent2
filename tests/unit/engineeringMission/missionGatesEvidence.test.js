'use strict';

/**
 * Gates da revisão da missão: EVIDÊNCIA por categoria e INDEPENDÊNCIA verificada.
 *
 * Protege três defeitos medidos na auditoria de 2026-10-10:
 *   1. `unit` e `integration` alimentados pela mesma condição genérica;
 *   2. revisão colhida de QUALQUER tentativa da task — um APPROVE de um patch
 *      anterior (já substituído) satisfazia o gate da tentativa corrente;
 *   3. independência apenas DECLARADA (`independent_of_coder`) sem cruzamento com
 *      os dados (provider do revisor vs provider do coder).
 */

const { deriveGates } = require('../../../api/services/engineeringMission/missionReviewService');

function run({ command = 'npx jest tests/unit', status = 'PASS', exit_code = 0 } = {}) {
  return { command, status, exit_code };
}

function attempt(overrides = {}) {
  return {
    id: 'attempt-current',
    coder_provider: 'anthropic',
    regression_evidence: { checked: true },
    governance_evidence: { ok: true },
    promotion_evidence: { code: null },
    promotion_status: 'PROMOTED',
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    attempt_id: 'attempt-current',
    decision: 'APPROVE',
    reviewer_provider: 'mistral',
    // Identidade COMPLETA é requisito desde 2026-10-20: provider sem modelo não
    // prova quem revisou.
    reviewer_model: 'mistral-large-latest',
    independent_of_coder: true,
    created_at: '2026-10-20T12:00:00.000Z',
    ...overrides,
  };
}

function gateOf(gates, id) {
  return gates.find((g) => g.id === id);
}

describe('deriveGates — categoria da evidência de teste', () => {
  test('comando genérico satisfaz unit mas o gate de integração DIZ que não tem evidência distinta', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run({ command: 'npx jest DR-ALGO --no-coverage' })],
      reviews: [review()],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt(),
    });

    expect(gateOf(gates, 'unit')).toMatchObject({ status: 'PASS', verification: 'EVIDENCE' });
    const integration = gateOf(gates, 'integration');
    expect(integration.evidence.hasDistinctIntegrationEvidence).toBe(false);
    expect(integration.evidence.note).toMatch(/sem evidência de integração distinta/);
  });

  test('suíte de integração executada vira evidência distinta', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run({ command: 'npm run test:flow' })],
      reviews: [review()],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt(),
    });
    const integration = gateOf(gates, 'integration');
    expect(integration.evidence.hasDistinctIntegrationEvidence).toBe(true);
    expect(integration.evidence.integrationCommands).toContain('npm run test:flow');
  });
});

describe('deriveGates — revisão vinculada à tentativa que avançou', () => {
  test('APPROVE de OUTRA tentativa NÃO satisfaz o gate (reuso de revisão de outro patch)', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run()],
      reviews: [review({ attempt_id: 'attempt-ANTIGA' })],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt(),
    });

    const reviewGate = gateOf(gates, 'review');
    expect(reviewGate.status).not.toBe('PASS');
    expect(reviewGate.evidence.diagnostic.note).toMatch(/nenhum APPROVE na tentativa que avançou/);
  });

  test('APPROVE da tentativa corrente, com provider diferente, é PASS', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run()],
      reviews: [review()],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt(),
    });

    const reviewGate = gateOf(gates, 'review');
    expect(reviewGate).toMatchObject({ status: 'PASS', verification: 'EVIDENCE' });
    expect(reviewGate.evidence).toMatchObject({
      providersDiffer: true,
      independentOfCoder: true,
      reviewerIdentityComplete: true,
      attemptId: 'attempt-current',
    });
  });

  test('P1: APPROVE SEM declaração de independência NÃO passa (prova positiva obrigatória)', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run()],
      reviews: [review({ independent_of_coder: false })],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt(),
    });

    const reviewGate = gateOf(gates, 'review');
    expect(reviewGate.status).not.toBe('PASS');
    expect(reviewGate.evidence.diagnostic.code).toBe('INDEPENDENT_REVIEW_NOT_PROVEN');
  });

  test('P1: identidade do revisor incompleta (sem modelo) NÃO passa', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run()],
      reviews: [review({ reviewer_model: null })],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt(),
    });

    expect(gateOf(gates, 'review').status).not.toBe('PASS');
    expect(gateOf(gates, 'review').evidence.diagnostic.code).toBe('INDEPENDENT_REVIEW_NOT_PROVEN');
  });

  test('P1: provider do coder ausente NÃO vira independência por omissão', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run()],
      reviews: [review()],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt({ coder_provider: null }),
    });

    expect(gateOf(gates, 'review').status).not.toBe('PASS');
    expect(gateOf(gates, 'review').evidence.diagnostic.code).toBe('INDEPENDENT_REVIEW_NOT_PROVEN');
  });
});

describe('deriveGates — independência CONTRADITA pelos dados', () => {
  test('declarar independente com o MESMO provider do coder não passa, e o código é nomeado', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run()],
      // Revisor "independente" no campo, mas o mesmo provider que escreveu o código.
      reviews: [review({ reviewer_provider: 'anthropic', independent_of_coder: true })],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt({ coder_provider: 'anthropic' }),
    });

    const reviewGate = gateOf(gates, 'review');
    expect(reviewGate.status).not.toBe('PASS');
    expect(reviewGate.evidence.diagnostic).toMatchObject({
      code: 'INDEPENDENT_REVIEW_CONTRADICTED_BY_PROVIDER',
      providersDiffer: false,
    });
  });

  test('sem APPROVE o gate não passa (revisão é requisito)', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [run()],
      reviews: [review({ decision: 'REJECT' })],
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: attempt(),
    });
    expect(gateOf(gates, 'review').status).not.toBe('PASS');
  });
});

describe('deriveGates — fail-closed no atestado', () => {
  test('task.status=GREEN sem evidência de fase produz ATTESTED, nunca PASS', () => {
    const gates = deriveGates({
      task: { status: 'GREEN' },
      testRuns: [],
      reviews: [],
      regressionRuns: [],
      greenAttempt: null,
    });
    for (const id of ['unit', 'integration', 'review', 'regression', 'governance', 'promotion']) {
      const gate = gateOf(gates, id);
      expect([id, gate.status]).toEqual([id, 'ATTESTED']);
      expect(gate.verification).toBe('ATTESTED');
    }
  });
});
