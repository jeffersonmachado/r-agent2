'use strict';

/**
 * Engagement Engine (fitness): scoring via ML real (churnModelService).
 * Fail-closed: sem modelo treinado, AI_ML_REQUIRED propaga — nunca heurística.
 */

function loadEngine({ scoreResult = null, scoreError = null, attendances = [] } = {}) {
  jest.resetModules();
  const signalStore = [];
  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
  jest.doMock('../../api/db/models', () => ({
    VerticalAttendance: () => ({
      findAll: jest.fn(async () => attendances.map((a) => ({ ...a, toJSON() { return { ...a }; } }))),
      findOne: jest.fn(async () => {
        const sorted = [...attendances].sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at));
        const row = sorted[0];
        return row ? { ...row, toJSON() { return { ...row }; } } : null;
      }),
    }),
    VerticalEngagementSignal: () => ({
      create: jest.fn(async (values) => {
        signalStore.push(values);
        return { ...values, toJSON() { return { ...values }; } };
      }),
    }),
  }));
  jest.doMock('../../api/services/vertical/churnModelService', () => ({
    scoreFitnessChurn: jest.fn(async () => {
      if (scoreError) throw scoreError;
      return scoreResult;
    }),
  }));
  jest.doMock('../../api/services/eventLedgerService', () => ({
    appendEventV1: jest.fn(async () => ({})),
  }));
  // eslint-disable-next-line global-require
  const engine = require('../../api/services/vertical/engagementEngine');
  return { engine, signalStore };
}

const baseAttendance = [{ subject_id: 's1', checked_in_at: new Date(Date.now() - 45 * 864e5) }];

describe('engagementEngine (fitness) — scoring ML', () => {
  test('score alto do modelo ⇒ signal churn_risk com computed_by ml_logreg', async () => {
    const { engine, signalStore } = loadEngine({
      scoreResult: { score: 0.83, modelId: 'vmm-1', modelVersion: 2 },
      attendances: baseAttendance,
    });
    const signal = await engine.computeEngagementSignal({
      tenantId: 'tenant-a', vertical: 'fitness', subjectId: 's1', membershipId: 'm1', billingStatus: 'delinquent',
    });
    expect(signal.signal_type).toBe('churn_risk');
    expect(signal.score).toBe(0.83);
    expect(signal.metadata.computed_by).toBe('ml_logreg:v2');
    expect(signalStore).toHaveLength(1);
  });

  test('score baixo + frequência boa ⇒ healthy', async () => {
    const recent = [];
    for (let d = 1; d <= 10; d += 1) recent.push({ subject_id: 's1', checked_in_at: new Date(Date.now() - d * 864e5) });
    const { engine } = loadEngine({
      scoreResult: { score: 0.12, modelId: 'vmm-1', modelVersion: 1 },
      attendances: recent,
    });
    const signal = await engine.computeEngagementSignal({
      tenantId: 'tenant-a', vertical: 'fitness', subjectId: 's1', membershipId: 'm1', billingStatus: 'active',
    });
    expect(signal.signal_type).toBe('healthy');
    expect(signal.metadata.computed_by).toBe('ml_logreg:v1');
  });

  test('fail-closed: AI_ML_REQUIRED propaga sem gerar sinal', async () => {
    const { engine, signalStore } = loadEngine({
      scoreError: Object.assign(new Error('AI_ML_REQUIRED: nenhum modelo fitness_churn treinado'), { code: 'AI_ML_REQUIRED' }),
      attendances: baseAttendance,
    });
    await expect(engine.computeEngagementSignal({
      tenantId: 'tenant-sem-modelo', vertical: 'fitness', subjectId: 's1', membershipId: 'm1', billingStatus: 'active',
    })).rejects.toThrow('AI_ML_REQUIRED');
    expect(signalStore).toHaveLength(0);
  });

  test('computeFitnessChurnScore delega ao churnModelService com tenantId', async () => {
    const { engine } = loadEngine({
      scoreResult: { score: 0.66, modelId: 'vmm-9', modelVersion: 9 },
    });
    const score = await engine.computeFitnessChurnScore({
      tenantId: 'tenant-a', daysSinceLastVisit: 30, frequency30d: 0, billingStatus: 'delinquent',
    });
    expect(score).toBe(0.66);
    // eslint-disable-next-line global-require
    const { scoreFitnessChurn } = require('../../api/services/vertical/churnModelService');
    expect(scoreFitnessChurn).toHaveBeenCalledWith({
      tenantId: 'tenant-a', daysSinceLastVisit: 30, frequency30d: 0, billingStatus: 'delinquent',
    });
  });

  test('aluno fora da janela de 30d tem dias reais desde a última visita (não o sentinela 999)', async () => {
    const old = [{ subject_id: 's1', checked_in_at: new Date(Date.now() - 45 * 864e5) }];
    const { engine } = loadEngine({
      scoreResult: { score: 0.9, modelId: 'vmm-1', modelVersion: 1 },
      attendances: old,
    });
    const signal = await engine.computeEngagementSignal({
      tenantId: 'tenant-a', vertical: 'fitness', subjectId: 's1', membershipId: 'm1', billingStatus: 'delinquent',
    });
    expect(signal.days_since_last_visit).toBe(45);
    expect(signal.signal_type).toBe('churn_risk');
  });

  test('beauty continua fail-closed (stub AI_ML_REQUIRED) — fora do escopo deste ciclo', async () => {
    const { engine } = loadEngine({});
    await expect(engine.computeEngagementSignal({
      tenantId: 'tenant-a', vertical: 'beauty', subjectId: 's1',
    })).rejects.toThrow('AI_ML_REQUIRED');
  });
});
