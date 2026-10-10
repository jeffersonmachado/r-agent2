'use strict';

/**
 * tests/unit/engineeringMission/deriveGatesEvidence.test.js
 *
 * Regressão do DEFEITO MEDIDO (2026-10-08): `task.status === 'GREEN'` era aceito como atestado
 * suficiente para os CINCO gates da revisão da missão virarem `PASS`. Qualquer escrita de
 * `status='GREEN'` em `engineering_tasks` — bug, migração, script de manutenção ou manipulação —
 * liberava o handover sem que REGRESSION/GOVERNANCE/PROMOTION tivessem rodado.
 *
 * A correção deriva cada gate da evidência de fase que o Router PERSISTE. O atestado de
 * `task.status` continua visível como rótulo (`verification: 'ATTESTED'`), mas NÃO produz `PASS` —
 * e o Meta Reviewer (MR-06) exige `status === 'PASS'` para todo gate obrigatório.
 */

const {
  deriveGates,
  REQUIRED_GATES_FOR_GREEN,
} = require('../../../api/services/engineeringMission/missionReviewService');

const TASK_GREEN = { id: 't1', status: 'GREEN' };
const TASK_EXECUTING = { id: 't1', status: 'EXECUTING' };

const semEvidencia = {
  task: TASK_GREEN, testRuns: [], reviews: [], regressionRuns: [], greenAttempt: null,
};

const comEvidencia = {
  task: TASK_GREEN,
  testRuns: [{ status: 'PASS', exit_code: 0, command: 'npx jest tests/unit' }],
  // `attempt_id` é obrigatório no banco (FK para a tentativa): sem ele a revisão não
  // pertence a tentativa nenhuma e o gate não pode aceitá-la como APPROVE da corrente.
  reviews: [{ attempt_id: 'a1', decision: 'APPROVE', reviewer_provider: 'anthropic', independent_of_coder: true }],
  regressionRuns: [],
  greenAttempt: {
    id: 'a1',
    coder_provider: 'mistral',
    regression_evidence: { checked: true, commands: ['npx jest'] },
    governance_evidence: { ok: true, gate: 'validate-engineering-router-v1' },
    promotion_evidence: { code: null, candidateBranch: 'engineering/task-t1' },
    promotion_status: 'PROMOTED',
  },
};

const gateById = (gates, id) => gates.find((g) => g.id === id);

describe('missionReviewService.deriveGates — verificação independente do atestado do executor', () => {
  test('GREEN isolado (sem evidência de fase) NÃO produz PASS em NENHUM gate obrigatório', () => {
    const gates = deriveGates(semEvidencia);

    expect(REQUIRED_GATES_FOR_GREEN.length).toBeGreaterThan(0);
    for (const id of REQUIRED_GATES_FOR_GREEN) {
      const g = gateById(gates, id);
      expect(g).toBeTruthy();
      expect(g.status).not.toBe('PASS');
      expect(g.status).toBe('ATTESTED');
      expect(g.verification).toBe('ATTESTED');
      // A evidência registrada precisa ser HONESTA sobre a origem: atestado, não verificação.
      expect(String(g.evidence.source)).toContain('task.status');
    }
  });

  test('o Meta Reviewer (MR-06) bloquearia: nenhum gate obrigatório fica PASS', () => {
    const gates = deriveGates(semEvidencia);
    const missing = REQUIRED_GATES_FOR_GREEN.filter(
      (id) => !gateById(gates, id) || gateById(gates, id).status !== 'PASS',
    );
    expect(missing).toEqual([...REQUIRED_GATES_FOR_GREEN]);
  });

  test('evidência REAL de fase ⇒ PASS com verification=EVIDENCE', () => {
    const gates = deriveGates(comEvidencia);

    for (const id of REQUIRED_GATES_FOR_GREEN) {
      const g = gateById(gates, id);
      expect(g.status).toBe('PASS');
      expect(g.verification).toBe('EVIDENCE');
    }
    expect(gateById(gates, 'regression').evidence.source).toBe('engineering_attempts.regression_evidence');
    expect(gateById(gates, 'governance').evidence.source).toBe('engineering_attempts.governance_evidence');
    expect(gateById(gates, 'promotion').status).toBe('PASS');
  });

  test('evidência VAZIA ({}) não conta como evidência', () => {
    const gates = deriveGates({
      task: TASK_GREEN,
      testRuns: [],
      reviews: [],
      regressionRuns: [],
      greenAttempt: {
        id: 'a1', regression_evidence: {}, governance_evidence: {}, promotion_evidence: {}, promotion_status: null,
      },
    });

    expect(gateById(gates, 'regression').status).toBe('ATTESTED');
    expect(gateById(gates, 'governance').status).toBe('ATTESTED');
    expect(gateById(gates, 'promotion').status).toBe('ATTESTED');
  });

  test('task NÃO-GREEN sem evidência ⇒ MISSING (não é atestado: não há nada a atestar)', () => {
    const gates = deriveGates({ ...semEvidencia, task: TASK_EXECUTING });
    expect(gateById(gates, 'governance').status).toBe('MISSING');
    expect(gateById(gates, 'unit').status).toBe('MISSING');
  });

  test('regressão também é aceita por linhas reais de EngineeringRegressionRun', () => {
    const gates = deriveGates({
      ...comEvidencia,
      regressionRuns: [{ status: 'PASS' }],
      greenAttempt: { id: 'a1', governance_evidence: { ok: true }, promotion_status: 'PROMOTED' },
    });
    expect(gateById(gates, 'regression').status).toBe('PASS');
    expect(gateById(gates, 'regression').evidence.source).toBe('engineering_regression_runs');
  });

  test('promotion_status READY_FOR_PROMOTION NÃO vira PASS (candidate não verificado)', () => {
    const gates = deriveGates({
      ...comEvidencia,
      greenAttempt: { ...comEvidencia.greenAttempt, promotion_status: 'READY_FOR_PROMOTION' },
    });
    expect(gateById(gates, 'promotion').status).toBe('ATTESTED');
  });
});
