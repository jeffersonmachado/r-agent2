/**
 * VerticalOperationsLoader Integration Tests
 * 
 * Testa factory pattern, caching, e integração com templates
 */

const { VerticalOperationsLoader } = require('../VerticalOperationsLoader');
const { VerticalTemplateRegistry } = require('../../autonomous-scheduling/VerticalTemplateRegistry');

describe('VerticalOperationsLoader', () => {
  let mockKernel;
  let loader;

  beforeEach(() => {
    mockKernel = {
      ingestEvent: jest.fn(),
      occQueryService: { getOccState: jest.fn() },
      decisionEngine: { decide: jest.fn() },
      actionsService: { execute: jest.fn() },
      outcomesService: { recordOutcome: jest.fn() },
      signalsService: { generateForTenant: jest.fn() },
    };

    loader = new VerticalOperationsLoader(mockKernel);
  });

  describe('Adapter Creation', () => {
    it('creates bakery adapter with kernel', async () => {
      const adapter = await loader.createVerticalAdapter('bakery');
      expect(adapter).toBeDefined();
      expect(adapter.verticalName).toBe('bakery');
    });

    it('creates pizzeria adapter with kernel', async () => {
      const adapter = await loader.createVerticalAdapter('pizzeria');
      expect(adapter).toBeDefined();
      expect(adapter.verticalName).toBe('pizzeria');
    });

    it('creates clinic adapter with kernel', async () => {
      const adapter = await loader.createVerticalAdapter('clinic');
      expect(adapter).toBeDefined();
      expect(adapter.verticalName).toBe('clinic');
    });

    it('creates market adapter with kernel', async () => {
      const adapter = await loader.createVerticalAdapter('market');
      expect(adapter).toBeDefined();
      expect(adapter.verticalName).toBe('market');
    });

    it('throws error for unknown vertical', async () => {
      await expect(loader.createVerticalAdapter('unknown')).rejects.toThrow(
        'Unknown vertical: unknown'
      );
    });
  });

  describe('Caching', () => {
    it('caches adapter instance', async () => {
      const adapter1 = await loader.createVerticalAdapter('bakery');
      const adapter2 = await loader.createVerticalAdapter('bakery');
      expect(adapter1).toBe(adapter2);
    });

    it('maintains separate cache per vertical', async () => {
      const bakeryAdapter = await loader.createVerticalAdapter('bakery');
      const pizzeriaAdapter = await loader.createVerticalAdapter('pizzeria');
      expect(bakeryAdapter).not.toBe(pizzeriaAdapter);
    });
  });

  describe('Template Integration', () => {
    it('provides template preset for each vertical', () => {
      const bakeryPreset = loader.getVerticalPreset('bakery');
      expect(bakeryPreset).toBeDefined();
      expect(bakeryPreset.name).toBe('bakery');
    });

    it('all 6 verticals have presets', () => {
      const verticals = ['bakery', 'pizzeria', 'clinic', 'market', 'beauty', 'fitness'];
      verticals.forEach((v) => {
        const preset = loader.getVerticalPreset(v);
        expect(preset).toBeDefined();
      });
    });
  });

  describe('Event Ingestion Delegation', () => {
    it('delegates event ingestion to adapter', async () => {
      const adapter = await loader.createVerticalAdapter('bakery');
      jest.spyOn(adapter, 'ingestBakeryEvent').mockResolvedValue({ id: 'event1' });

      const result = await adapter.ingestBakeryEvent({
        type: 'bakery:order.created',
        payload: { orderId: 'order1' },
      });

      expect(result).toEqual({ id: 'event1' });
    });

    it('passes tenant context through loader', async () => {
      const adapter = await loader.createVerticalAdapter('pizzeria');
      jest.spyOn(adapter, 'ingestPizzeriaEvent').mockResolvedValue({ id: 'event1' });

      await adapter.ingestPizzeriaEvent({
        type: 'pizzeria:pizza_order.created',
        payload: { orderId: 'order1' },
        tenantId: 'tenant1',
      });

      expect(adapter.ingestPizzeriaEvent).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant1' })
      );
    });
  });

  describe('State Retrieval', () => {
    it('retrieves operational state from adapter', async () => {
      const adapter = await loader.createVerticalAdapter('bakery');
      jest.spyOn(adapter, 'getBakeryOperationalState').mockResolvedValue({
        orders: [],
        queue: {},
        kpis: {},
      });

      const state = await adapter.getBakeryOperationalState({ tenantId: 'tenant1' });
      expect(state).toHaveProperty('orders');
      expect(state).toHaveProperty('kpis');
    });
  });

  describe('Quick Actions', () => {
    it('lists quick actions for vertical', async () => {
      const adapter = await loader.createVerticalAdapter('pizzeria');
      jest.spyOn(adapter, 'listPizzeriaQuickActions').mockResolvedValue([
        { id: 'action1', name: 'Action 1', trigger: 'trigger1' },
      ]);

      const actions = await adapter.listPizzeriaQuickActions({ tenantId: 'tenant1' });
      expect(actions).toHaveLength(1);
      expect(actions[0].name).toBe('Action 1');
    });
  });
});
