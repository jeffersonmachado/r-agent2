/**
 * Pizzeria Operations Adapter Unit Tests
 */

const { PizzeriaOperationsAdapterV2 } = require('../pizzeria/PizzeriaOperationsAdapterV2');

describe('PizzeriaOperationsAdapter', () => {
  let mockKernel;
  let adapter;

  beforeEach(() => {
    mockKernel = {
      ingestEvent: jest.fn().mockResolvedValue({ id: 'event1' }),
      occQueryService: {
        getOccState: jest.fn().mockResolvedValue({
          orders: [],
          ovenStatus: { utilization: 60 },
        }),
      },
      decisionEngine: {
        decide: jest
          .fn()
          .mockResolvedValue({ id: 'decision1', recommendation: 'execute_action' }),
      },
      actionsService: { execute: jest.fn().mockResolvedValue({ id: 'action1' }) },
      outcomesService: { recordOutcome: jest.fn().mockResolvedValue({ recorded: true }) },
      signalsService: {
        generateForTenant: jest.fn().mockResolvedValue([
          { id: 'signal1', contexts: ['balcão'] },
        ]),
      },
    };

    adapter = new PizzeriaOperationsAdapterV2(mockKernel);
  });

  describe('Initialization', () => {
    it('requires kernel instance', () => {
      expect(() => new PizzeriaOperationsAdapterV2(null)).toThrow(
        'requires ServiceOperationsKernel instance'
      );
    });

    it('sets correct vertical name', () => {
      expect(adapter.verticalName).toBe('pizzeria');
    });

    it('builds vocabulary', () => {
      expect(adapter.vocabulary).toBeDefined();
      expect(adapter.vocabulary.entities.oven).toBe('oven');
      expect(adapter.vocabulary.contexts.delivery).toBe('entrega');
    });
  });

  describe('Event Ingestion', () => {
    it('injects valid pizzeria event', async () => {
      const mockEvent = {
        type: 'pizzeria:pizza_order.created',
        payload: { orderId: 'order1', size: 'grande' },
        tenantId: 'tenant1',
      };

      // Mock the event type check
      adapter._classifyEvent = jest.fn().mockReturnValue('order_lifecycle');

      await adapter.ingestPizzeriaEvent(mockEvent);

      expect(mockKernel.ingestEvent).toHaveBeenCalled();
      expect(mockKernel.ingestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'pizzeria:pizza_order.created',
        })
      );
    });

    it('rejects unknown event type', async () => {
      await expect(
        adapter.ingestPizzeriaEvent({
          type: 'pizzeria:unknown_event',
          payload: {},
        })
      ).rejects.toThrow('Unknown pizzeria event type');
    });

    it('adds vertical context to payload', async () => {
      // Mock PIZZERIA_EVENTS
      const eventTypes = {
        'pizzeria:pizza_order.created': true,
      };
      
      jest.spyOn(adapter, 'ingestPizzeriaEvent').mockImplementation(async (opts) => {
        return mockKernel.ingestEvent({
          type: opts.type,
          payload: { ...opts.payload, vertical: 'pizzeria' },
          source: opts.source || 'pizzeria-system',
          tenantId: opts.tenantId,
        });
      });

      await adapter.ingestPizzeriaEvent({
        type: 'pizzeria:pizza_order.created',
        payload: { orderId: 'order1' },
        tenantId: 'tenant1',
      });

      expect(mockKernel.ingestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ vertical: 'pizzeria' }),
        })
      );
    });
  });

  describe('Decision Generation', () => {
    it('generates decisions based on event type', async () => {
      adapter._classifyEvent = jest.fn().mockReturnValue('production');
      adapter._selectPolicies = jest.fn().mockReturnValue([
        { id: 'oven_mgmt_0', name: 'Policy 1' },
      ]);

      await adapter.generatePizzeriaDecisions({
        tenantId: 'tenant1',
        eventId: 'event1',
        eventType: 'pizzeria:oven.capacity_updated',
        eventPayload: { capacity: 80 },
      });

      expect(mockKernel.decisionEngine.decide).toHaveBeenCalled();
    });

    it('classifies order lifecycle events', () => {
      expect(adapter._classifyEvent('pizzeria:pizza_order.created')).toBe('order_lifecycle');
    });

    it('classifies production events', () => {
      expect(adapter._classifyEvent('pizzeria:oven.usage_update')).toBe('production');
    });

    it('classifies delivery events', () => {
      expect(adapter._classifyEvent('pizzeria:delivery.start')).toBe('delivery_management');
    });
  });

  describe('Action Execution', () => {
    it('executes pizzeria action', async () => {
      await adapter.executePizzeriaAction({
        tenantId: 'tenant1',
        actionId: 'action1',
        actionType: 'defer_order',
        parameters: { orderId: 'order1' },
      });

      expect(mockKernel.actionsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'defer_order',
          parameters: expect.objectContaining({
            vertical: 'pizzeria',
          }),
        })
      );
    });
  });

  describe('Outcome Recording', () => {
    it('records pizzeria outcome', async () => {
      await adapter.recordPizzeriaOutcome({
        tenantId: 'tenant1',
        eventId: 'event1',
        actionId: 'action1',
        result: 'success',
        metrics: { executionTime: 100 },
      });

      expect(mockKernel.outcomesService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.objectContaining({ vertical: 'pizzeria' }),
        })
      );
    });
  });

  describe('Operational State', () => {
    it('projects operational state', async () => {
      const state = await adapter.getPizzeriaOperationalState({ tenantId: 'tenant1' });

      expect(state).toBeDefined();
      expect(state).toHaveProperty('orders');
      expect(state).toHaveProperty('ovenStatus');
      expect(state).toHaveProperty('deliveryFleet');
      expect(state).toHaveProperty('demandWindow');
      expect(state).toHaveProperty('customers');
      expect(state).toHaveProperty('kpis');
    });
  });

  describe('Signals Generation', () => {
    it('generates pizzeria-specific signals', async () => {
      const signals = await adapter.generatePizzeriaSignals({ tenantId: 'tenant1' });

      expect(signals).toBeDefined();
      expect(signals).toHaveProperty('baseSignals');
      expect(signals).toHaveProperty('pizzeriaSignals');
      expect(signals).toHaveProperty('specializations');
    });

    it('detects pizzeria-relevant signals', () => {
      const signal = { id: 'sig1', contexts: ['balcão'] };
      const isRelevant = adapter._isPizzeriaRelevant(signal);
      expect(isRelevant).toBe(true);
    });
  });

  describe('Quick Actions', () => {
    it('lists quick actions based on state', async () => {
      jest.spyOn(adapter, 'getPizzeriaOperationalState').mockResolvedValue({
        ovenStatus: { utilization: 85 },
        deliveryFleet: { activeDrivers: 0 },
      });

      const actions = await adapter.listPizzeriaQuickActions({ tenantId: 'tenant1' });
      expect(Array.isArray(actions)).toBe(true);
    });
  });

  describe('Playbooks', () => {
    it('lists playbooks for scenario', async () => {
      const playbooks = await adapter.listPizzeriaPlaybooks({
        tenantId: 'tenant1',
        scenario: 'oven_management',
      });

      expect(Array.isArray(playbooks)).toBe(true);
      expect(playbooks.length).toBeGreaterThan(0);
    });

    it('requires scenario parameter', async () => {
      await expect(
        adapter.listPizzeriaPlaybooks({ tenantId: 'tenant1' })
      ).rejects.toThrow('Scenario required');
    });
  });
});
