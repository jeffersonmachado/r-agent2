'use strict';

/**
 * Churn Model Service (fitness) — ML real, sem heurística.
 *
 * Cobre: encoding de billing, treino de regressão logística (aprendizado,
 * determinismo, métricas), dataset builder sobre histórico real mockado,
 * persistência/versionamento do modelo, inferência fail-closed e isolamento
 * por tenant. Models e sequelize mockados em memória.
 */

const DAY = 864e5;

function daysAgo(n, now) {
  return new Date(now - n * DAY);
}

function loadService({ attendances = [], memberships = [], mlModels = null } = {}) {
  jest.resetModules();
  const mlStore = mlModels || [];
  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
  jest.doMock('../../api/db/models', () => ({
    VerticalAttendance: () => ({
      findAll: jest.fn(async () => attendances.map((a) => ({ ...a, toJSON() { return { ...a }; } }))),
    }),
    AccessMembership: () => ({
      findAll: jest.fn(async () => memberships.map((m) => ({ ...m, toJSON() { return { ...m }; } }))),
    }),
    VerticalMlModel: () => ({
      findOne: jest.fn(async ({ where } = {}) => {
        const rows = mlStore
          .filter((m) => (!where?.tenant_key || m.tenant_key === where.tenant_key)
            && (!where?.model_type || m.model_type === where.model_type)
            && (!where?.status || m.status === where.status))
          .sort((a, b) => b.version - a.version);
        const row = rows[0];
        return row ? { ...row, toJSON() { return { ...row }; } } : null;
      }),
      update: jest.fn(async (values, { where } = {}) => {
        mlStore.forEach((m) => {
          if (m.tenant_key === where.tenant_key && m.model_type === where.model_type && m.status === where.status) {
            Object.assign(m, values);
          }
        });
        return [mlStore.length];
      }),
      create: jest.fn(async (values) => {
        mlStore.push({ ...values });
        return { ...values, toJSON() { return { ...values }; } };
      }),
    }),
  }));
  // eslint-disable-next-line global-require
  const service = require('../../api/services/vertical/churnModelService');
  return { service, mlStore };
}

// ── encodeBilling ─────────────────────────────────────────────────────────

describe('churnModelService.encodeBilling', () => {
  test('mapeia status de cobrança para flags numéricas', () => {
    const { service } = loadService();
    expect(service.encodeBilling('active')).toEqual({ billing_delinquent: 0, billing_inactive: 0 });
    expect(service.encodeBilling('delinquent')).toEqual({ billing_delinquent: 1, billing_inactive: 0 });
    expect(service.encodeBilling('grace_period')).toEqual({ billing_delinquent: 1, billing_inactive: 0 });
    expect(service.encodeBilling('cancelled')).toEqual({ billing_delinquent: 0, billing_inactive: 1 });
    expect(service.encodeBilling('suspended')).toEqual({ billing_delinquent: 0, billing_inactive: 1 });
  });
});

// ── trainLogisticRegression (função pura) ─────────────────────────────────

describe('churnModelService.trainLogisticRegression', () => {
  test('aprende fronteira separável (quanto mais dias sem visita, maior o churn)', () => {
    const { service } = loadService();
    // Feature única: days_since_last_visit. 0-10 → fica; 20-40 → churn.
    const X = [];
    const y = [];
    for (let d = 0; d <= 10; d += 1) { X.push([d, 8, 0, 0]); y.push(0); }
    for (let d = 20; d <= 40; d += 2) { X.push([d, 0, 0, 0]); y.push(1); }

    const trained = service.trainLogisticRegression({ X, y });
    expect(trained.metrics.auc).toBe(1);
    expect(trained.metrics.accuracy).toBe(1);
    expect(trained.metrics.logloss).toBeLessThan(0.2);
    // Coeficiente de days_since_last_visit deve ser positivo (mais dias ⇒ mais churn)
    expect(trained.coefficients[0]).toBeGreaterThan(0);
  });

  test('é determinístico: mesmos dados ⇒ mesmos pesos', () => {
    const { service } = loadService();
    const X = [[1, 5, 0, 0], [2, 4, 0, 0], [30, 0, 1, 0], [35, 1, 0, 1], [3, 6, 0, 0], [28, 0, 0, 0]];
    const y = [0, 0, 1, 1, 0, 1];
    const a = service.trainLogisticRegression({ X, y });
    const b = service.trainLogisticRegression({ X, y });
    expect(a.coefficients).toEqual(b.coefficients);
    expect(a.bias).toBe(b.bias);
  });

  test('class_weight balanced: dataset desbalanceado não condena perfil saudável', () => {
    const { service } = loadService();
    // Simula o histórico real: muitos pontos de silêncio profundo (churn)
    // e poucos pontos de frequência saudável.
    const X = [];
    const y = [];
    for (let i = 0; i < 200; i += 1) { X.push([60 + (i % 40), 0, 1, 0]); y.push(1); }
    for (let i = 0; i < 200; i += 1) { X.push([20 + (i % 10), 1, 0, 0]); y.push(1); }
    for (let i = 0; i < 30; i += 1) { X.push([1 + (i % 5), 10, 0, 0]); y.push(0); }

    const trained = service.trainLogisticRegression({ X, y });
    const { means, stds, coefficients, bias } = trained;
    const scoreOf = (raw) => {
      let z = bias;
      for (let j = 0; j < raw.length; j += 1) z += coefficients[j] * ((raw[j] - means[j]) / stds[j]);
      return service.sigmoid(z);
    };
    // Perfil "treina 4x/mês, última visita há 10 dias" não pode ser churn quase certo
    expect(scoreOf([10, 4, 0, 0])).toBeLessThan(0.6);
    // Silêncio profundo continua churn alto
    expect(scoreOf([80, 0, 1, 0])).toBeGreaterThan(0.8);
  });

  test('rejeita dados inválidos', () => {
    const { service } = loadService();
    expect(() => service.trainLogisticRegression({ X: [], y: [] })).toThrow('TRAINING_DATA_INVALID');
    expect(() => service.trainLogisticRegression({ X: [[1]], y: [0, 1] })).toThrow('TRAINING_DATA_INVALID');
  });
});

// ── buildFitnessChurnDataset ──────────────────────────────────────────────

describe('churnModelService.buildFitnessChurnDataset', () => {
  const NOW = new Date('2026-09-01T12:00:00Z').getTime();

  test('rotula churn por ausência de retorno no horizonte e calcula features', async () => {
    const attendances = [];
    // Aluno fiel: treina a cada 3 dias até ontem
    for (let d = 60; d >= 1; d -= 3) {
      attendances.push({ subject_id: 'fiel', checked_in_at: daysAgo(d, NOW) });
    }
    // Aluno que abandonou: treinava a cada 3 dias, parou há 45 dias
    for (let d = 100; d >= 45; d -= 3) {
      attendances.push({ subject_id: 'abandonou', checked_in_at: daysAgo(d, NOW) });
    }
    const memberships = [
      { id: 'm1', subject_id: 'fiel', billing_status: 'active', status: 'active' },
      { id: 'm2', subject_id: 'abandonou', billing_status: 'delinquent', status: 'active' },
    ];

    const { service } = loadService({ attendances, memberships });
    const dataset = await service.buildFitnessChurnDataset({ tenantId: 'tenant-a', horizonDays: 30, spacingDays: 7, now: NOW });

    expect(dataset.subjects).toBe(2);
    expect(dataset.X.length).toBeGreaterThan(5);
    expect(dataset.y.filter((v) => v === 1).length).toBeGreaterThan(0);
    expect(dataset.y.filter((v) => v === 0).length).toBeGreaterThan(0);

    // Todo ponto com horizonte não observável foi excluído: o aluno fiel,
    // que treinou ontem, não gera label positivo.
    const featureIdx = dataset.featureNames;
    const delinquentIdx = featureIdx.indexOf('billing_delinquent');
    const positives = dataset.X.filter((_, i) => dataset.y[i] === 1);
    // Positivos vêm do aluno que abandonou (flag delinquent ligada)
    expect(positives.every((row) => row[delinquentIdx] === 1)).toBe(true);
  });

  test('ignora check-ins sem subject ou data inválida', async () => {
    const attendances = [
      { subject_id: null, checked_in_at: daysAgo(10, NOW) },
      { subject_id: 's1', checked_in_at: 'data-invalida' },
      { subject_id: 's1', checked_in_at: daysAgo(50, NOW) },
      { subject_id: 's1', checked_in_at: daysAgo(10, NOW) },
    ];
    const { service } = loadService({ attendances });
    const dataset = await service.buildFitnessChurnDataset({ tenantId: 'tenant-a', horizonDays: 5, spacingDays: 7, now: NOW });
    expect(dataset.subjects).toBe(1);
  });
});

// ── trainFitnessChurnModel + persistência ─────────────────────────────────

function buildTrainingStore({ subjects = 10, now } = {}) {
  const NOW = now || Date.now();
  const attendances = [];
  const memberships = [];
  for (let s = 0; s < subjects; s += 1) {
    const churned = s % 2 === 0;
    const subjectId = `aluno-${s}`;
    const start = 120;
    const stop = churned ? 45 + (s % 3) * 10 : 1;
    for (let d = start; d >= stop; d -= 3) {
      attendances.push({ subject_id: subjectId, checked_in_at: daysAgo(d, NOW) });
    }
    memberships.push({
      id: `m-${s}`,
      subject_id: subjectId,
      billing_status: churned ? 'delinquent' : 'active',
      status: 'active',
    });
  }
  return { attendances, memberships, NOW };
}

describe('churnModelService.trainFitnessChurnModel', () => {
  test('falha fechado com INSUFFICIENT_TRAINING_DATA quando não há massa mínima', async () => {
    const attendances = [
      { subject_id: 's1', checked_in_at: daysAgo(50, Date.now()) },
      { subject_id: 's1', checked_in_at: daysAgo(10, Date.now()) },
    ];
    const { service } = loadService({ attendances });
    await expect(service.trainFitnessChurnModel({ tenantId: 'tenant-a' }))
      .rejects.toThrow('INSUFFICIENT_TRAINING_DATA');
  });

  test('treina, persiste modelo ativo versionado e supersede versão anterior', async () => {
    const { attendances, memberships, NOW } = buildTrainingStore({ subjects: 10 });
    const { service, mlStore } = loadService({ attendances, memberships });

    const first = await service.trainFitnessChurnModel({ tenantId: 'tenant-a', now: NOW });
    expect(first.version).toBe(1);
    expect(first.metrics.samples).toBeGreaterThanOrEqual(30);
    expect(first.metrics.auc).toBeGreaterThan(0.7);

    const second = await service.trainFitnessChurnModel({ tenantId: 'tenant-a', now: NOW });
    expect(second.version).toBe(2);

    const actives = mlStore.filter((m) => m.status === 'active');
    expect(actives).toHaveLength(1);
    expect(actives[0].version).toBe(2);
    expect(mlStore.filter((m) => m.status === 'superseded')).toHaveLength(1);

    // Pesos persistidos com features e padronização
    const weights = actives[0].weights;
    expect(weights.features).toEqual(service.FEATURES);
    expect(weights.coefficients).toHaveLength(service.FEATURES.length);
    expect(weights.means).toHaveLength(service.FEATURES.length);
  });

  test('isolamento de tenant: modelo do tenant A não serve ao tenant B', async () => {
    const { attendances, memberships, NOW } = buildTrainingStore({ subjects: 10 });
    const { service } = loadService({ attendances, memberships });
    await service.trainFitnessChurnModel({ tenantId: 'tenant-a', now: NOW });

    await expect(service.scoreFitnessChurn({ tenantId: 'tenant-b', daysSinceLastVisit: 40, frequency30d: 0, billingStatus: 'delinquent' }))
      .rejects.toThrow('AI_ML_REQUIRED');
  });
});

// ── scoreFitnessChurn ─────────────────────────────────────────────────────

describe('churnModelService.scoreFitnessChurn', () => {
  test('fail-closed: sem modelo treinado lança AI_ML_REQUIRED', async () => {
    const { service } = loadService();
    await expect(service.scoreFitnessChurn({ tenantId: 'tenant-x', daysSinceLastVisit: 30, frequency30d: 0, billingStatus: 'active' }))
      .rejects.toThrow('AI_ML_REQUIRED');
  });

  test('score é maior para aluno inativo e inadimplente do que para aluno fiel', async () => {
    const { attendances, memberships, NOW } = buildTrainingStore({ subjects: 10 });
    const { service } = loadService({ attendances, memberships });
    await service.trainFitnessChurnModel({ tenantId: 'tenant-a', now: NOW });

    const risk = await service.scoreFitnessChurn({ tenantId: 'tenant-a', daysSinceLastVisit: 45, frequency30d: 0, billingStatus: 'delinquent' });
    const safe = await service.scoreFitnessChurn({ tenantId: 'tenant-a', daysSinceLastVisit: 1, frequency30d: 12, billingStatus: 'active' });

    expect(risk.score).toBeGreaterThan(0.5);
    expect(safe.score).toBeLessThan(risk.score);
    expect(risk.modelVersion).toBe(1);
    expect(risk.score).toBeGreaterThan(0);
    expect(risk.score).toBeLessThan(1);
  });
});
