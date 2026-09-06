'use strict';

/**
 * Trigger pós-loop de retreino do modelo de churn fitness
 * (handleFitnessChurnModelRetrain no verticalJourneyJobHandler).
 *
 * Prova: dispara após o loop do tick, respeita throttle, é fail-soft para
 * INSUFFICIENT_TRAINING_DATA e erros genéricos, e nunca quebra a jornada.
 */

const getActiveModel = jest.fn();
const trainFitnessChurnModel = jest.fn();

function loadHandler({ memberships = [] } = {}) {
  jest.resetModules();
  getActiveModel.mockReset();
  trainFitnessChurnModel.mockReset();

  jest.doMock('../../api/db/sequelize', () => ({ getSequelize: () => ({}) }));
  jest.doMock('../../api/db/models', () => ({
    VerticalJourneyEvent: () => ({ findOne: jest.fn(async () => null) }),
    VerticalAttendance: () => ({ findAll: jest.fn(async () => []) }),
    AccessMembership: () => ({ findAll: jest.fn(async () => memberships) }),
  }));
  jest.doMock('../../api/services/vertical/churnModelService', () => ({
    getActiveModel,
    trainFitnessChurnModel,
  }));
  jest.doMock('../../api/services/vertical/fitnessAttendanceService', () => ({
    closeStaleOpenAttendances: jest.fn(async () => ({ closed: 0 })),
  }));
  // eslint-disable-next-line global-require
  const handler = require('../../api/services/vertical/verticalJourneyJobHandler');
  return handler;
}

describe('handleFitnessChurnModelRetrain (trigger pós-loop)', () => {
  test('sem modelo ativo ⇒ treina e reporta versão', async () => {
    const handler = loadHandler();
    getActiveModel.mockResolvedValue(null);
    trainFitnessChurnModel.mockResolvedValue({ version: 1, metrics: { auc: 0.95, samples: 100 } });

    const result = await handler.handleFitnessChurnModelRetrain({ tenantId: 'tenant-a' });
    expect(result).toEqual({ retrained: true, modelVersion: 1 });
    expect(trainFitnessChurnModel).toHaveBeenCalledWith({ tenantId: 'tenant-a' });
  });

  test('modelo fresco (< intervalo) ⇒ throttle, não retreina', async () => {
    const handler = loadHandler();
    getActiveModel.mockResolvedValue({ version: 3, trained_at: new Date(Date.now() - 3600e3).toISOString() });

    const result = await handler.handleFitnessChurnModelRetrain({ tenantId: 'tenant-a' });
    expect(result).toEqual({ retrained: false, reason: 'fresh_model', modelVersion: 3 });
    expect(trainFitnessChurnModel).not.toHaveBeenCalled();
  });

  test('modelo velho (> intervalo) ⇒ retreina', async () => {
    const handler = loadHandler();
    getActiveModel.mockResolvedValue({ version: 3, trained_at: new Date(Date.now() - 48 * 3600e3).toISOString() });
    trainFitnessChurnModel.mockResolvedValue({ version: 4, metrics: { auc: 0.96, samples: 120 } });

    const result = await handler.handleFitnessChurnModelRetrain({ tenantId: 'tenant-a' });
    expect(result).toEqual({ retrained: true, modelVersion: 4 });
  });

  test('INSUFFICIENT_TRAINING_DATA ⇒ fail-soft, sem throw', async () => {
    const handler = loadHandler();
    getActiveModel.mockResolvedValue(null);
    trainFitnessChurnModel.mockRejectedValue(Object.assign(new Error('INSUFFICIENT_TRAINING_DATA: amostras=3'), { code: 'INSUFFICIENT_TRAINING_DATA' }));

    const result = await handler.handleFitnessChurnModelRetrain({ tenantId: 'tenant-novo' });
    expect(result.retrained).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_TRAINING_DATA');
  });

  test('erro genérico de treino ⇒ fail-soft, sem throw', async () => {
    const handler = loadHandler();
    getActiveModel.mockResolvedValue(null);
    trainFitnessChurnModel.mockRejectedValue(new Error('db down'));

    const result = await handler.handleFitnessChurnModelRetrain({ tenantId: 'tenant-a' });
    expect(result.retrained).toBe(false);
    expect(result.reason).toBe('error');
  });

  test('sem tenantId ⇒ skipped', async () => {
    const handler = loadHandler();
    const result = await handler.handleFitnessChurnModelRetrain({ tenantId: '' });
    expect(result).toEqual({ retrained: false, reason: 'skipped' });
  });
});

describe('handleFitnessJourneyTick — retreino dispara após o loop', () => {
  test('tick completo executa o trigger de retreino ao final', async () => {
    const handler = loadHandler();
    getActiveModel.mockResolvedValue(null);
    trainFitnessChurnModel.mockResolvedValue({ version: 1, metrics: { auc: 0.9, samples: 50 } });

    await handler.handleFitnessJourneyTick({ payload: { tenantId: 'tenant-a' } });
    expect(trainFitnessChurnModel).toHaveBeenCalledTimes(1);
    expect(trainFitnessChurnModel).toHaveBeenCalledWith({ tenantId: 'tenant-a' });
  });

  test('falha no retreino não quebra o tick', async () => {
    const handler = loadHandler();
    getActiveModel.mockResolvedValue(null);
    trainFitnessChurnModel.mockRejectedValue(new Error('training exploded'));

    await expect(handler.handleFitnessJourneyTick({ payload: { tenantId: 'tenant-a' } })).resolves.toBeUndefined();
  });
});
