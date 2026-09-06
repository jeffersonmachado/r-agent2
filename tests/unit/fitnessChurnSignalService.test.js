'use strict';

/**
 * Vertical Fitness → Workspace: sinal de churn/inatividade por telefone
 * (fitnessChurnSignalService). Models mockados em memória.
 */

const { Op } = require('sequelize');

function buildSubjectModel(store) {
  return {
    findAll: jest.fn(async ({ where } = {}) => store.filter((item) => {
      if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
      const profiles = where?.vertical_profile?.[Op.in];
      if (profiles && !profiles.includes(item.vertical_profile)) return false;
      return true;
    })),
  };
}

function buildSignalModel(store) {
  return {
    findOne: jest.fn(async ({ where, order } = {}) => {
      const rows = store
        .filter((item) => {
          if (where?.tenant_key && item.tenant_key !== where.tenant_key) return false;
          if (where?.vertical && item.vertical !== where.vertical) return false;
          const types = where?.signal_type?.[Op.in];
          if (types && !types.includes(item.signal_type)) return false;
          const subjectIds = where?.subject_id?.[Op.in];
          if (subjectIds && !subjectIds.includes(item.subject_id)) return false;
          const since = where?.computed_at?.[Op.gte];
          if (since && new Date(item.computed_at).getTime() < since.getTime()) return false;
          return true;
        })
        .sort((a, b) => new Date(b.computed_at) - new Date(a.computed_at));
      const row = rows[0];
      return row ? { ...row, toJSON() { return { ...row }; } } : null;
    }),
  };
}

function loadService({ subjects = [], signals = [] } = {}) {
  jest.resetModules();
  jest.doMock('../../api/db/models', () => ({
    AccessSubject: () => buildSubjectModel(subjects),
    VerticalEngagementSignal: () => buildSignalModel(signals),
  }));
  // eslint-disable-next-line global-require
  const service = require('../../api/services/vertical/fitnessChurnSignalService');
  return { service };
}

const fitnessSubject = {
  id: 'subj-fit-1',
  tenant_key: 'tenant-a',
  vertical_profile: 'fitness',
  metadata: { name: 'Carlos', phone: '+55 (11) 97777-6655' },
};

const churnSignal = {
  id: 'ves-1',
  tenant_key: 'tenant-a',
  vertical: 'fitness',
  subject_id: 'subj-fit-1',
  signal_type: 'churn_risk',
  score: 0.81,
  days_since_last_visit: 32,
  frequency_last_30d: 1,
  metadata: { computed_by: 'ml_logreg:v3' },
  computed_at: new Date(Date.now() - 2 * 3600e3).toISOString(),
};

describe('fitnessChurnSignalService.latestFitnessSignalByPhone', () => {
  test('resolve telefone → subject fitness → sinal mais recente', async () => {
    const { service } = loadService({ subjects: [fitnessSubject], signals: [churnSignal] });
    const signal = await service.latestFitnessSignalByPhone({ tenantId: 'tenant-a', phone: '5511977776655' });
    expect(signal).not.toBeNull();
    expect(signal.signalType).toBe('churn_risk');
    expect(signal.score).toBe(0.81);
    expect(signal.daysSinceLastVisit).toBe(32);
    expect(signal.frequency30d).toBe(1);
    expect(signal.computedBy).toBe('ml_logreg:v3');
  });

  test('telefone com formatação diferente casa por dígitos', async () => {
    const { service } = loadService({ subjects: [fitnessSubject], signals: [churnSignal] });
    const signal = await service.latestFitnessSignalByPhone({ tenantId: 'tenant-a', phone: '+55 11 97777-6655' });
    expect(signal).not.toBeNull();
  });

  test('sem subject para o telefone ⇒ null', async () => {
    const { service } = loadService({ subjects: [], signals: [churnSignal] });
    expect(await service.latestFitnessSignalByPhone({ tenantId: 'tenant-a', phone: '5511977776655' })).toBeNull();
  });

  test('sinal healthy não é projetado (só churn_risk/low_frequency/inactive)', async () => {
    const { service } = loadService({
      subjects: [fitnessSubject],
      signals: [{ ...churnSignal, signal_type: 'healthy' }],
    });
    expect(await service.latestFitnessSignalByPhone({ tenantId: 'tenant-a', phone: '5511977776655' })).toBeNull();
  });

  test('sinal antigo fora do lookback ⇒ null', async () => {
    const { service } = loadService({
      subjects: [fitnessSubject],
      signals: [{ ...churnSignal, computed_at: new Date(Date.now() - 60 * 864e5).toISOString() }],
    });
    expect(await service.latestFitnessSignalByPhone({ tenantId: 'tenant-a', phone: '5511977776655' })).toBeNull();
  });

  test('isolamento de tenant', async () => {
    const { service } = loadService({ subjects: [fitnessSubject], signals: [churnSignal] });
    expect(await service.latestFitnessSignalByPhone({ tenantId: 'tenant-b', phone: '5511977776655' })).toBeNull();
  });

  test('mais recente vence entre múltiplos sinais', async () => {
    const older = { ...churnSignal, id: 'ves-0', signal_type: 'low_frequency', score: 0.3, computed_at: new Date(Date.now() - 5 * 864e5).toISOString() };
    const { service } = loadService({ subjects: [fitnessSubject], signals: [older, churnSignal] });
    const signal = await service.latestFitnessSignalByPhone({ tenantId: 'tenant-a', phone: '5511977776655' });
    expect(signal.signalId).toBe('ves-1');
    expect(signal.signalType).toBe('churn_risk');
  });
});
