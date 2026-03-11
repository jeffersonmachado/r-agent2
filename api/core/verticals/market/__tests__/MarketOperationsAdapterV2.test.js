'use strict';

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { MarketOperationsAdapterV2 } = require('../MarketOperationsAdapterV2');

describe('MarketOperationsAdapterV2', () => {
  let mockKernel;
  let adapter;

  beforeEach(() => {
    mockKernel = {
      ingestEvent: jest.fn().mockResolvedValue({ eventId: 'evt_1' }),
      occQueryService: {
        getOccState: jest.fn().mockResolvedValue({
          orders: [{ id: 'order-1', status: 'pending' }],
        }),
      },
      decisionEngine: {
        decide: jest.fn().mockResolvedValue({ decisionId: 'dec_1' }),
      },
      actionsService: {
        execute: jest.fn().mockResolvedValue({ actionId: 'act_1' }),
      },
      outcomesService: {
        recordOutcome: jest.fn().mockResolvedValue({ outcomeId: 'out_1' }),
      },
      signalsService: {
        generateForTenant: jest.fn().mockResolvedValue([]),
      },
    };

    adapter = new MarketOperationsAdapterV2(mockKernel);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with kernel', () => {
      expect(adapter.kernel).toBe(mockKernel);
      expect(adapter.verticalName).toBe('market');
    });

    it('should throw if kernel is missing', () => {
      expect(() => new MarketOperationsAdapterV2(null)).toThrow('requires ServiceOperationsKernel');
    });
  });

  describe('ingestMarketEvent', () => {
    it('should ingest valid market event', async () => {
      const result = await adapter.ingestMarketEvent({
        type: 'market:order.created',
        payload: { orderId: 'order-1' },
        tenantId: 'tenant-1',
      });

      expect(mockKernel.ingestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'market:order.created',
          payload: expect.objectContaining({ vertical: 'market' }),
        })
      );
      expect(result.eventId).toBe('evt_1');
    });

    it('should reject unknown event type', async () => {
      await expect(
        adapter.ingestMarketEvent({
          type: 'unknown.event',
          payload: {},
        })
      ).rejects.toThrow('Unknown market event type');
    });
  });

  describe('generateMarketDecisions', () => {
    it('should generate decisions for event', async () => {
      const result = await adapter.generateMarketDecisions({
        tenantId: 'tenant-1',
        eventId: 'evt_1',
        eventType: 'inventory.low_stock',
        eventPayload: { productId: 'prod-1' },
      });

      expect(mockKernel.decisionEngine.decide).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('executeMarketAction', () => {
    it('should execute action through kernel', async () => {
      const result = await adapter.executeMarketAction({
        tenantId: 'tenant-1',
        actionId: 'act_1',
        actionType: 'restock_notification',
      });

      expect(mockKernel.actionsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ vertical: 'market' }),
        })
      );
      expect(result.actionId).toBe('act_1');
    });
  });

  describe('recordMarketOutcome', () => {
    it('should record outcome with metrics', async () => {
      const result = await adapter.recordMarketOutcome({
        tenantId: 'tenant-1',
        eventId: 'evt_1',
        decisionId: 'dec_1',
        actionId: 'act_1',
        result: 'success',
        metrics: { fulfillmentTime: 24 },
      });

      expect(mockKernel.outcomesService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.objectContaining({ fulfillmentTime: 24, vertical: 'market' }),
        })
      );
      expect(result.outcomeId).toBe('out_1');
    });
  });

  describe('getMarketOperationalState', () => {
    it('should return operational state with all components', async () => {
      const state = await adapter.getMarketOperationalState({ tenantId: 'tenant-1' });

      expect(state).toHaveProperty('inventory');
      expect(state).toHaveProperty('orders');
      expect(state).toHaveProperty('fulfillment');
      expect(state).toHaveProperty('customers');
      expect(state).toHaveProperty('promotions');
      expect(state).toHaveProperty('kpis');
    });
  });

  describe('listMarketQuickActions', () => {
    it('should return list of quick actions', async () => {
      const actions = await adapter.listMarketQuickActions({ tenantId: 'tenant-1' });

      expect(Array.isArray(actions)).toBe(true);
      actions.forEach((action) => {
        expect(action).toHaveProperty('id');
        expect(action).toHaveProperty('name');
        expect(action).toHaveProperty('description');
      });
    });
  });

  describe('listMarketPlaybooks', () => {
    it('should return playbooks for scenario', async () => {
      const playbooks = await adapter.listMarketPlaybooks({
        tenantId: 'tenant-1',
        scenario: 'inventory_management',
      });

      expect(Array.isArray(playbooks)).toBe(true);
    });

    it('should throw if scenario is missing', async () => {
      await expect(
        adapter.listMarketPlaybooks({ tenantId: 'tenant-1' })
      ).rejects.toThrow('Scenario required');
    });
  });

  describe('generateMarketSignals', () => {
    it('should generate signals and specializations', async () => {
      const signals = await adapter.generateMarketSignals({ tenantId: 'tenant-1' });

      expect(signals).toHaveProperty('baseSignals');
      expect(signals).toHaveProperty('marketSignals');
      expect(signals).toHaveProperty('specializations');
      expect(signals.specializations).toHaveProperty('inventoryRisk');
      expect(signals.specializations).toHaveProperty('customerPatternDetected');
      expect(signals.specializations).toHaveProperty('promotionOpportunity');
    });
  });
});
