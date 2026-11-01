'use strict';

/**
 * MISSAO-B4 — REVISÃO INDEPENDENTE tem de ser PROVADA, não declarada.
 *
 * O campo `independent_of_coder` é gravado pelo próprio Router, isto é, pelo executor. Confiar só
 * nele é confiar no atestado de quem se beneficia da aprovação. A regra canônica
 * (`missionReviewService.deriveGates`) exige três provas juntas:
 *   (a) declaração explícita `independent_of_coder === true`;
 *   (b) identidade completa — provider E modelo do revisor, provider do coder;
 *   (c) provider do revisor DIFERENTE do provider do coder.
 *
 * A suíte mede o gate `review` nos quatro cenários que a regra distingue, mais o controle positivo.
 */

const {
  deriveGates,
  REQUIRED_GATES_FOR_GREEN,
} = require('../../../api/services/engineeringMission/missionReviewService');

const TASK_GREEN = { id: 't1', status: 'GREEN' };
const CODER = 'mistral';

const gateReview = (gates) => gates.find((g) => g.id === 'review');

/** Base com TODOS os outros gates satisfeitos, para isolar o gate de revisão. */
const base = (reviews, greenAttemptOver = {}) => ({
  task: TASK_GREEN,
  testRuns: [
    { status: 'PASS', exit_code: 0, command: 'npx jest tests/unit' },
    { status: 'PASS', exit_code: 0, command: 'npx jest tests/integration' },
  ],
  reviews,
  regressionRuns: [{ status: 'PASS' }],
  greenAttempt: {
    id: 'a1',
    coder_provider: CODER,
    regression_evidence: { checked: true },
    governance_evidence: { ok: true },
    promotion_evidence: { code: null },
    promotion_status: 'PROMOTED',
    ...greenAttemptOver,
  },
});

const aprovacao = (over = {}) => ({
  attempt_id: 'a1',
  decision: 'APPROVE',
  reviewer_provider: 'anthropic',
  reviewer_model: 'claude-sonnet',
  independent_of_coder: true,
  ...over,
});

describe('MISSAO-B4 — prova positiva de independência', () => {
  test('declarado + identidades completas + providers diferentes ⇒ gate review PASS/EVIDENCE', () => {
    const g = gateReview(deriveGates(base([aprovacao()])));
    expect(g.status).toBe('PASS');
    expect(g.verification).toBe('EVIDENCE');
  });

  test('sem declaração (`independent_of_coder` ausente) ⇒ NÃO é PASS', () => {
    const semDeclaracao = aprovacao();
    delete semDeclaracao.independent_of_coder;
    const g = gateReview(deriveGates(base([semDeclaracao])));
    expect(g.status).not.toBe('PASS');
  });

  test('declarado FALSE explicitamente ⇒ NÃO é PASS', () => {
    const g = gateReview(deriveGates(base([aprovacao({ independent_of_coder: false })])));
    expect(g.status).not.toBe('PASS');
  });

  test('declarado TRUE mas MESMO provider do coder ⇒ contradição, NÃO é PASS', () => {
    // É o caso perigoso: o atestado do executor diz "sou independente" e os DADOS dizem o contrário.
    const g = gateReview(deriveGates(base([aprovacao({ reviewer_provider: CODER })])));
    expect(g.status).not.toBe('PASS');
  });

  test('identidade do revisor INCOMPLETA (sem modelo) ⇒ fail-closed, NÃO é PASS', () => {
    const semModelo = aprovacao();
    delete semModelo.reviewer_model;
    const g = gateReview(deriveGates(base([semModelo])));
    expect(g.status).not.toBe('PASS');
  });

  test('coder sem provider ⇒ não há contra o que comparar, NÃO é PASS', () => {
    const g = gateReview(deriveGates(base([aprovacao()], { coder_provider: null })));
    expect(g.status).not.toBe('PASS');
  });
});

describe('MISSAO-B4 — aprovação de OUTRA tentativa não vale', () => {
  test('APPROVE de tentativa anterior é ignorado (não aprova a tentativa que avançou)', () => {
    const deOutraTentativa = aprovacao({ attempt_id: 'a0', independent_of_coder: true });
    const g = gateReview(deriveGates(base([deOutraTentativa])));
    expect(g.status).not.toBe('PASS');
  });

  test('sem revisão nenhuma ⇒ gate review não é PASS (ausência nunca vira aprovação)', () => {
    const g = gateReview(deriveGates(base([])));
    expect(g.status).not.toBe('PASS');
  });
});

describe('MISSAO-B4 — o gate de revisão é obrigatório para GREEN', () => {
  test('`review` está na lista de gates obrigatórios', () => {
    expect(REQUIRED_GATES_FOR_GREEN).toContain('review');
  });

  test('com independência NÃO provada, a lista de gates obrigatórios não fica completa', () => {
    const gates = deriveGates(base([aprovacao({ reviewer_provider: CODER })]));
    const faltando = REQUIRED_GATES_FOR_GREEN.filter((id) => {
      const g = gates.find((x) => x.id === id);
      return !g || g.status !== 'PASS';
    });
    expect(faltando).toContain('review');
  });
});
