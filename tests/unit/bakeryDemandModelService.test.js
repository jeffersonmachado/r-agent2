'use strict';

const mockGetSequelize = jest.fn(() => ({}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

const mockMlFindOne = jest.fn();
const mockMlCreate = jest.fn();
const mockMlUpdate = jest.fn();
const mockOrderFindAll = jest.fn();

jest.mock('../../api/db/models', () => ({
  VerticalMlModel: () => ({
    findOne: (...args) => mockMlFindOne(...args),
    create: (...args) => mockMlCreate(...args),
    update: (...args) => mockMlUpdate(...args),
  }),
  Order: () => ({ findAll: (...args) => mockOrderFindAll(...args) }),
}));

const {
  featureVector,
  trainRidgeRegression,
  trainDemandModel,
  forecastDemand,
  MIN_SAMPLES,
} = require('../../api/services/vertical/bakeryDemandModelService');

describe('bakeryDemandModelService', () => {
  beforeEach(() => jest.clearAllMocks());
  beforeEach(() => {
    mockGetSequelize.mockReturnValue({});
    mockMlCreate.mockImplementation(async (data) => ({ ...data, toJSON() { return this; } }));
    mockMlUpdate.mockResolvedValue([1]);
    mockMlFindOne.mockResolvedValue(null);
    mockOrderFindAll.mockResolvedValue([]);
  });

  describe('featureVector', () => {
    it('codifica bias + weekday one-hot', () => {
      // 2026-09-06 é domingo (weekday 0)
      expect(featureVector('2026-09-06')).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
      // 2026-09-07 é segunda (weekday 1)
      expect(featureVector('2026-09-07')).toEqual([1, 0, 1, 0, 0, 0, 0, 0]);
    });
  });

  describe('trainRidgeRegression', () => {
    it('aprende padrão semanal perfeito', () => {
      // 4 semanas: domingo=50, segunda=10
      const X = [];
      const y = [];
      const sunday = new Date('2026-08-16T12:00:00Z'); // domingo
      for (let w = 0; w < 4; w += 1) {
        const sun = new Date(sunday.getTime() - w * 7 * 86400000).toISOString().slice(0, 10);
        const mon = new Date(sunday.getTime() - w * 7 * 86400000 + 86400000).toISOString().slice(0, 10);
        X.push(featureVector(sun));
        y.push(50);
        X.push(featureVector(mon));
        y.push(10);
      }
      const w = trainRidgeRegression({ X, y });
      // previsão para domingo ≈ 50, segunda ≈ 10 (ridge suaviza levemente)
      const xSun = featureVector('2026-09-06');
      const xMon = featureVector('2026-09-07');
      const predSun = w.reduce((a, wi, i) => a + wi * xSun[i], 0);
      const predMon = w.reduce((a, wi, i) => a + wi * xMon[i], 0);
      expect(predSun).toBeGreaterThan(40);
      expect(predSun).toBeLessThan(60);
      expect(predMon).toBeGreaterThan(5);
      expect(predMon).toBeLessThan(20);
    });
  });

  describe('trainDemandModel', () => {
    it('fail-closed com histórico insuficiente', async () => {
      const perDay = new Map([['2026-09-01', 10], ['2026-09-02', 12]]);
      await expect(trainDemandModel({ tenantId: 't', productKey: 'pao frances', dailySales: perDay }))
        .rejects.toMatchObject({ code: 'INSUFFICIENT_TRAINING_DATA' });
      expect(mockMlCreate).not.toHaveBeenCalled();
    });

    it('treina e persiste modelo versionado com histórico suficiente', async () => {
      const perDay = new Map();
      for (let d = 0; d < MIN_SAMPLES + 6; d += 1) {
        perDay.set(new Date(Date.now() - d * 86400000).toISOString().slice(0, 10), 20 + (d % 5));
      }
      const result = await trainDemandModel({ tenantId: 't', productKey: 'pao frances', dailySales: perDay });
      expect(result.version).toBe(1);
      expect(mockMlCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model_type: 'bakery_demand:pao frances',
          algorithm: 'ridge_regression',
          status: 'active',
          weights: expect.objectContaining({ coefficients: expect.any(Array) }),
        }),
      );
    });
  });

  describe('forecastDemand', () => {
    it('fail-closed sem modelo ativo (insufficient_data, nunca heurística)', async () => {
      mockMlFindOne.mockResolvedValue(null);
      const result = await forecastDemand({ tenantId: 't', productKey: 'sonho', date: '2026-09-08' });
      expect(result.status).toBe('insufficient_data');
      expect(result.forecastQty).toBeUndefined();
    });

    it('prevê demanda a partir dos pesos do modelo ativo', async () => {
      const weights = [30, 20, 0, 0, 0, 0, 0, 0]; // domingo: 30+20=50
      mockMlFindOne.mockResolvedValue({
        model_type: 'bakery_demand:pao frances',
        version: 3,
        weights: { coefficients: weights },
        toJSON() { return this; },
      });
      const result = await forecastDemand({ tenantId: 't', productKey: 'pao frances', date: '2026-09-06' });
      expect(result.status).toBe('ok');
      expect(result.forecastQty).toBe(50);
      expect(result.modelVersion).toBe(3);
      expect(result.computedBy).toBe('ml_ridge_regression');
    });

    it('nunca retorna demanda negativa', async () => {
      mockMlFindOne.mockResolvedValue({
        version: 1,
        weights: { coefficients: [-100, 0, 0, 0, 0, 0, 0, 0] },
        toJSON() { return this; },
      });
      const result = await forecastDemand({ tenantId: 't', productKey: 'x', date: '2026-09-06' });
      expect(result.forecastQty).toBe(0);
    });
  });
});
