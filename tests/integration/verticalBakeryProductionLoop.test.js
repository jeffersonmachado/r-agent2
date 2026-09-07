'use strict';

/**
 * Bakery Production Loop — End-to-End Integration Test
 * (previsão ML → produção → sobra/ruptura → aprendizado)
 *
 * Complementa verticalBakeryEndToEnd.test.js (jornadas/registry) cobrindo o
 * loop operacional de fornada implementado em bakeryDemandModelService +
 * bakeryProductionService:
 *
 * 1. Treino ML a partir de pedidos entregues (buildDailySales → ridge)
 * 2. Forecast fail-closed sem modelo (insufficient_data)
 * 3. Plano de produção: forecast × fator adaptativo
 * 4. Outcome: leftover = produced − sold; ruptura somente explícita
 * 5. Aprendizado: rupturas sobem o fator; sobra alta desce; limites respeitados
 * 6. Acurácia (MAPE) sobre batches com forecast + venda real
 * 7. Upsert do outcome (mesma data/produto não duplica batch)
 *
 * Boundary: mocks DB calls but uses real service logic.
 */

const mockGetSequelize = jest.fn(() => ({}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

const mockMlFindOne = jest.fn();
const mockMlCreate = jest.fn();
const mockMlUpdate = jest.fn();
const mockOrderFindAll = jest.fn();
const mockBatchFindOne = jest.fn();
const mockBatchFindAll = jest.fn();
const mockBatchCreate = jest.fn();

jest.mock('../../api/db/models', () => ({
  VerticalMlModel: () => ({
    findOne: (...args) => mockMlFindOne(...args),
    create: (...args) => mockMlCreate(...args),
    update: (...args) => mockMlUpdate(...args),
  }),
  Order: () => ({ findAll: (...args) => mockOrderFindAll(...args) }),
  VerticalProductionBatch: () => ({
    findOne: (...args) => mockBatchFindOne(...args),
    findAll: (...args) => mockBatchFindAll(...args),
    create: (...args) => mockBatchCreate(...args),
  }),
}));

const { buildDailySales, trainDemandModel } = require('../../api/services/vertical/bakeryDemandModelService');
const {
  computeSafetyFactor,
  generateProductionPlan,
  recordProductionOutcome,
  computeForecastAccuracy,
  SAFETY_MAX,
} = require('../../api/services/vertical/bakeryProductionService');

const TENANT = 'tenant-bakery-e2e';

function deliveredOrder(daysAgo, items) {
  return {
    items,
    delivered_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    toJSON() { const { toJSON, ...rest } = this; return rest; },
  };
}

describe('Bakery Production Loop — End-to-End', () => {
  beforeEach(() => jest.clearAllMocks());
  beforeEach(() => {
    mockGetSequelize.mockReturnValue({});
    mockMlFindOne.mockResolvedValue(null);
    mockMlCreate.mockImplementation(async (d) => ({ ...d, toJSON() { return this; } }));
    mockMlUpdate.mockResolvedValue([1]);
    mockOrderFindAll.mockResolvedValue([]);
    mockBatchFindOne.mockResolvedValue(null);
    mockBatchFindAll.mockResolvedValue([]);
    mockBatchCreate.mockImplementation(async (d) => ({ ...d, toJSON() { return this; } }));
  });

  // ── 1. Dataset + treino ──────────────────────────────────────────────────
  describe('1. Dataset e treino ML', () => {
    test('buildDailySales agrega itens por produto e dia', async () => {
      mockOrderFindAll.mockResolvedValue([
        deliveredOrder(1, [{ name: 'Pão Francês', qty: 30 }, { name: 'Sonho', qty: 5 }]),
        deliveredOrder(1, [{ name: 'Pão Francês', qty: 10 }]),
        deliveredOrder(2, [{ name: 'Pão Francês', qty: 25 }]),
      ]);
      const sales = await buildDailySales({ tenantId: TENANT });
      const pao = sales.get('pão francês');
      expect(pao).toBeTruthy();
      const day1 = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      expect(pao.get(day1)).toBe(40);
    });

    test('trainDemandModel fail-closed abaixo do mínimo de amostras', async () => {
      mockOrderFindAll.mockResolvedValue([
        deliveredOrder(1, [{ name: 'Rosca', qty: 3 }]),
        deliveredOrder(2, [{ name: 'Rosca', qty: 4 }]),
      ]);
      await expect(trainDemandModel({ tenantId: TENANT, productKey: 'rosca' }))
        .rejects.toMatchObject({ code: 'INSUFFICIENT_TRAINING_DATA' });
    });
  });

  // ── 2. Plano de produção ─────────────────────────────────────────────────
  describe('2. Plano de produção', () => {
    test('produto sem modelo entra como insufficient_data no plano', async () => {
      mockOrderFindAll.mockResolvedValue([deliveredOrder(1, [{ name: 'Rosca', qty: 3 }])]);
      const plan = await generateProductionPlan({ tenantId: TENANT, date: '2026-09-08', productKeys: ['rosca'] });
      expect(plan.items[0].status).toBe('insufficient_data');
      expect(plan.items[0].recommendedQty).toBeNull();
    });

    test('plano = forecast × fator adaptativo (ceil)', async () => {
      mockMlFindOne.mockResolvedValue({
        version: 2,
        weights: { coefficients: [100, 0, 0, 0, 0, 0, 0, 0] },
        toJSON() { return this; },
      });
      const plan = await generateProductionPlan({ tenantId: TENANT, date: '2026-09-08', productKeys: ['pao frances'] });
      expect(plan.items[0].status).toBe('ok');
      expect(plan.items[0].forecastQty).toBe(100);
      expect(plan.items[0].safetyFactor).toBe(1.1);
      expect(plan.items[0].recommendedQty).toBe(110);
    });
  });

  // ── 3. Outcome ───────────────────────────────────────────────────────────
  describe('3. Resultado da fornada', () => {
    test('leftover = produced − sold; ruptura somente explícita', async () => {
      const batch = await recordProductionOutcome({
        tenantId: TENANT, productKey: 'Pão Francês', date: '2026-09-07', producedQty: 100, soldQty: 87,
      });
      expect(batch.leftover_qty).toBe(13);
      expect(batch.stockout).toBe(false);

      const ruptura = await recordProductionOutcome({
        tenantId: TENANT, productKey: 'Pão Francês', date: '2026-09-08', producedQty: 100, soldQty: 100, hadUnmetDemand: true,
      });
      expect(ruptura.leftover_qty).toBe(0);
      expect(ruptura.stockout).toBe(true);
    });

    test('upsert: mesma data/produto atualiza em vez de duplicar', async () => {
      const existing = {
        planned_qty: 110,
        payload: { origem: 'plano' },
        update: jest.fn(async function (data) { Object.assign(this, data); }),
        toJSON() { const { update, ...rest } = this; return rest; },
      };
      mockBatchFindOne.mockResolvedValue(existing);
      await recordProductionOutcome({ tenantId: TENANT, productKey: 'pao', date: '2026-09-07', producedQty: 50, soldQty: 40 });
      expect(mockBatchCreate).not.toHaveBeenCalled();
      expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({ produced_qty: 50, leftover_qty: 10 }));
    });
  });

  // ── 4. Aprendizado do fator de segurança ─────────────────────────────────
  describe('4. Aprendizado (fator adaptativo)', () => {
    const batch = (over) => ({ produced_qty: 100, leftover_qty: 5, stockout: false, ...over, toJSON() { const { toJSON, ...r } = this; return r; } });

    test('rupturas recentes sobem o fator', async () => {
      mockBatchFindAll.mockResolvedValue([batch({ stockout: true }), batch({ stockout: true }), batch({ stockout: true })]);
      const safety = await computeSafetyFactor({ tenantId: TENANT, productKey: 'pao' });
      expect(safety.factor).toBe(1.25); // 1.1 + 3×0.05
      expect(safety.stockouts).toBe(3);
    });

    test('sobra média alta sem ruptura desce o fator', async () => {
      mockBatchFindAll.mockResolvedValue([batch({ leftover_qty: 40 }), batch({ leftover_qty: 35 })]);
      const safety = await computeSafetyFactor({ tenantId: TENANT, productKey: 'pao' });
      expect(safety.factor).toBe(1.05); // 1.1 − 0.05
      expect(safety.avgLeftoverRatio).toBeGreaterThan(0.2);
    });

    test('limite SAFETY_MAX respeitado com muitas rupturas', async () => {
      mockBatchFindAll.mockResolvedValue(Array.from({ length: 20 }, () => batch({ stockout: true })));
      const hi = await computeSafetyFactor({ tenantId: TENANT, productKey: 'pao' });
      expect(hi.factor).toBe(SAFETY_MAX);
    });
  });

  // ── 5. Acurácia (MAPE) ───────────────────────────────────────────────────
  describe('5. Acurácia do forecast', () => {
    test('MAPE sobre batches com forecast e venda real', async () => {
      mockBatchFindAll.mockResolvedValue([
        { forecast_qty: 100, sold_qty: 90, toJSON() { return this; } },
        { forecast_qty: 100, sold_qty: 110, toJSON() { return this; } },
        { forecast_qty: 80, sold_qty: 0, toJSON() { return this; } }, // ignorado (venda 0)
      ]);
      const acc = await computeForecastAccuracy({ tenantId: TENANT });
      expect(acc.samples).toBe(2);
      // (|90-100|/90 + |110-100|/110) / 2 = (0.1111 + 0.0909) / 2 ≈ 0.101
      expect(acc.mape).toBeCloseTo(0.101, 2);
    });

    test('sem amostras → mape null', async () => {
      mockBatchFindAll.mockResolvedValue([]);
      const acc = await computeForecastAccuracy({ tenantId: TENANT });
      expect(acc).toEqual({ samples: 0, mape: null });
    });
  });
});
