'use strict';

const {
  computeRecovery,
  assessSkills,
  DEFAULT_THRESHOLDS,
} = require('../../src/core/learning/assessment-engine');

const ROUTE_MAP = {
  '/inbox': 'tickets',
  '/tickets': 'tickets',
  '/crm': 'crm',
};

function nav(route, at, durationMs = 3000) {
  return { id: `evt-${route}-${at}`, type: 'learning.interaction.navigation', occurredAt: at, payload: { route, durationMs } };
}

function apiError(route, at, status = 500) {
  return { id: `evt-err-${route}-${at}`, type: 'learning.interaction.api_call', occurredAt: at, payload: { route, status } };
}

function flowCompleted(route, at) {
  return { id: `evt-flow-${route}-${at}`, type: 'learning.interaction.flow_completed', occurredAt: at, payload: { route, flowId: 'f1' } };
}

describe('learning assessment-engine — computeRecovery', () => {
  it('erro seguido de sucesso na mesma skill dentro da janela conta como recuperado', () => {
    const events = [
      apiError('/inbox', '2026-07-20T10:00:00Z'),
      nav('/inbox', '2026-07-20T10:05:00Z'),
      apiError('/inbox', '2026-07-21T10:00:00Z'),
    ];
    const recovery = computeRecovery({ events, routeSkillMap: ROUTE_MAP });
    expect(recovery.tickets.errorCount).toBe(2);
    expect(recovery.tickets.recoveredCount).toBe(1);
    expect(recovery.tickets.recoveryRate).toBe(0.5);
    expect(recovery.tickets.exceptionCount).toBe(2);
  });

  it('erro sem sucesso posterior não é recuperado; skill sem erros tem recoveryRate null', () => {
    const events = [
      apiError('/inbox', '2026-07-20T10:00:00Z'),
      nav('/crm', '2026-07-20T11:00:00Z'),
    ];
    const recovery = computeRecovery({ events, routeSkillMap: ROUTE_MAP });
    expect(recovery.tickets.errorCount).toBe(1);
    expect(recovery.tickets.recoveredCount).toBe(0);
    expect(recovery.crm.recoveryRate).toBeNull();
  });

  it('sucesso fora da janela de 24h não conta como recuperação', () => {
    const events = [
      apiError('/inbox', '2026-07-20T10:00:00Z'),
      nav('/inbox', '2026-07-22T11:00:00Z'),
    ];
    const recovery = computeRecovery({ events, routeSkillMap: ROUTE_MAP });
    expect(recovery.tickets.recoveredCount).toBe(0);
  });

  it('rotas fora do mapa são ignoradas', () => {
    const events = [apiError('/desconhecida', '2026-07-20T10:00:00Z')];
    const recovery = computeRecovery({ events, routeSkillMap: ROUTE_MAP });
    expect(Object.keys(recovery)).toHaveLength(0);
  });
});

describe('learning assessment-engine — assessSkills', () => {
  const strongCompetency = {
    skillKey: 'tickets',
    score: 0.9,
    components: { precision: 0.95, coverage: 0.8, tempo: 0.7, autonomia: 0.9, consistencia: 0.8 },
    evidenceRefs: ['evt-1'],
    eventCount: 30,
  };

  it('skill com todos os critérios acima do threshold é certificável', () => {
    const assessments = assessSkills({
      competencies: [strongCompetency],
      recoveryBySkill: { tickets: { errorCount: 2, recoveredCount: 2, recoveryRate: 1, exceptionCount: 0 } },
    });
    expect(assessments).toHaveLength(1);
    expect(assessments[0].certifiable).toBe(true);
    expect(assessments[0].missingEvidence).toHaveLength(0);
    expect(assessments[0].criteria.erros).toBe(2);
  });

  it('recuperação null (sem erros) é não-aplicável e não bloqueia', () => {
    const assessments = assessSkills({
      competencies: [strongCompetency],
      recoveryBySkill: { tickets: { errorCount: 0, recoveredCount: 0, recoveryRate: null, exceptionCount: 0 } },
    });
    expect(assessments[0].certifiable).toBe(true);
    expect(assessments[0].evaluations.recuperacao.reason).toBe('nao_aplicavel');
  });

  it('componente sem evidência (null) bloqueia certificação com motivo explícito', () => {
    const assessments = assessSkills({
      competencies: [{
        ...strongCompetency,
        components: { ...strongCompetency.components, tempo: null },
      }],
      recoveryBySkill: {},
    });
    expect(assessments[0].certifiable).toBe(false);
    expect(assessments[0].missingEvidence).toContain('tempo:sem_evidencia');
  });

  it('critério abaixo do threshold bloqueia com motivo abaixo_do_threshold', () => {
    const assessments = assessSkills({
      competencies: [{
        ...strongCompetency,
        components: { ...strongCompetency.components, precision: 0.7 },
      }],
      recoveryBySkill: {},
    });
    expect(assessments[0].certifiable).toBe(false);
    expect(assessments[0].missingEvidence).toContain('precisao:abaixo_do_threshold');
  });

  it('poucos eventos bloqueiam certificação (evidência insuficiente)', () => {
    const assessments = assessSkills({
      competencies: [{ ...strongCompetency, eventCount: 5 }],
      recoveryBySkill: {},
    });
    expect(assessments[0].certifiable).toBe(false);
    expect(assessments[0].missingEvidence[0]).toContain('eventos_insuficientes');
  });

  it('thresholds customizados são respeitados', () => {
    const assessments = assessSkills({
      competencies: [{ ...strongCompetency, eventCount: 10 }],
      recoveryBySkill: {},
      thresholds: { ...DEFAULT_THRESHOLDS, minEvents: 10 },
    });
    expect(assessments[0].certifiable).toBe(true);
  });
});
