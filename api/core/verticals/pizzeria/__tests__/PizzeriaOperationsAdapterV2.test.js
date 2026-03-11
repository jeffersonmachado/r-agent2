'use strict';

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { PizzeriaOperationsAdapterV2 } = require('../PizzeriaOperationsAdapterV2');

describe('PizzeriaOperationsAdapterV2', () => {
  let mockKernel;
  let adapter;

  beforeEach(() => {
    mockKernel = {
      ingestEvent: jest.fn().mockResolvedValue({ eventId: 'evt_1' }),
      occQueryService: {
        getOccState: jest.fn().mockResolvedValue({
          orders: [{ id: 'order-1', status: 'preparing' }],
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

    adapter = new PizzeriaOperationsAdapterV2(mockKernel);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with kernel', () => {
      expect(adapter.kernel).toBe(mockKernel);
      expect(adapter.verticalName).toBe('pizzeria');
    });

    it('should throw if kernel is missing', () => {
      expect(() => new PizzeriaOperationsAdapterV2(null)).toThrow('requires ServiceOperationsKernel');
    });
  });

  describe('ingestPizzeriaEvent', () => {
    it('should ingest valid pizzeria event', async () => {
      const result = await adapter.ingestPizzeriaEvent({
        type: 'pizzeria:pizza_order.created',
        payload: { orderId: 'order-1' },
        tenantId: 'tenant-1',
      });

      expect(mockKernel.ingestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pizzeria:pizza_order.created',
          payload: expect.objectContaining({ vertical: 'pizzeria' }),
        })
      );
      expect(result.eventId).toBe('evt_1');
    });

    it('should reject unknown event type', async () => {
      await expect(
        adapter.ingestPizzeriaEvent({
          type: 'unknown.event',
          payload: {},
        })
      ).rejects.toThrow('Unknown pizzeria event type');
    });
  });

  describe('generatePizzeriaDecisions', () => {
    it('should generate decisions for event', async () => {
      const result = await adapter.generatePizzeriaDecisions({
        tenantId: 'tenant-1',
        eventId: 'evt_1',
        eventType: 'pizzeria:oven.overload',
        eventPayload: { orderId: 'order-1' },
      });

      expect(mockKernel.decisionEngine.decide).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('executePizzeriaAction', () => {
    it('should execute action through kernel', async () => {
      const result = await adapter.executePizzeriaAction({
        tenantId: 'tenant-1',
        actionId: 'act_1',
        actionType: 'defer_pizzas',
      });

      expect(mockKernel.actionsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          parameters: expect.objectContaining({ vertical: 'pizzeria' }),
        })
      );
      expect(result.actionId).toBe('act_1');
    });
  });

  describe('recordPizzeriaOutcome', () => {
    it('should record outcome with metrics', async () => {
      const result = await adapter.recordPizzeriaOutcome({
        tenantId: 'tenant-1',
        eventId: 'evt_1',
        decisionId: 'dec_1',
        actionId: 'act_1',
        result: 'success',
        metrics: { deliveryTime: 30 },
      });

      expect(mockKernel.outcomesService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.objectContaining({ deliveryTime: 30, vertical: 'pizzeria' }),
        })
      );
      expect(result.outcomeId).toBe('out_1');
    });
  });

  describe('getPizzeriaOperationalState', () => {
    it('should return operational state with all components', async () => {
      const state = await adapter.getPizzeriaOperationalState({ tenantId: 'tenant-1' });

      expect(state).toHaveProperty('orders');
      expect(state).toHaveProperty('ovenStatus');
      expect(state).toHaveProperty('deliveryFleet');
      expect(state).toHaveProperty('demandWindow');
      expect(state).toHaveProperty('customers');
      expect(state).toHaveProperty('kpis');
    });
  });

  describe('listPizzeriaQuickActions', () => {
    it('should return list of quick actions', async () => {
      const actions = await adapter.listPizzeriaQuickActions({ tenantId: 'tenant-1' });

      expect(Array.isArray(actions)).toBe(true);
      actions.forEach((action) => {
        expect(action).toHaveProperty('id');
        expect(action).toHaveProperty('name');
        expect(action).toHaveProperty('description');
      });
    });
  });

  describe('listPizzeriaPlaybooks', () => {
    it('should return playbooks for scenario', async () => {
      const playbooks = await adapter.listPizzeriaPlaybooks({
        tenantId: 'tenant-1',
        scenario: 'oven_management',
      });

      expect(Array.isArray(playbooks)).toBe(true);
    });

    it('should throw if scenario is missing', async () => {
      await expect(
        adapter.listPizzeriaPlaybooks({ tenantId: 'tenant-1' })
      ).rejects.toThrow('Scenario required');
    });
  });

  describe('generatePizzeriaSignals', () => {
    it('should generate signals and specializations', async () => {
      const signals = await adapter.generatePizzeriaSignals({ tenantId: 'tenant-1' });

      expect(signals).toHaveProperty('baseSignals');
      expect(signals).toHaveProperty('pizzeriaSignals');
      expect(signals).toHaveProperty('specializations');
      expect(signals.specializations).toHaveProperty('ovenOverloadDetected');
      expect(signals.specializations).toHaveProperty('deliveryDelayRisk');
      expect(signals.specializations).toHaveProperty('rushWindowDetected');
    });
  });
});
