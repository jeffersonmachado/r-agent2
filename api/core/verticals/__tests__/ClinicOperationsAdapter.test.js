/**
 * Clinic Operations Adapter Unit Tests
 */

const { ClinicOperationsAdapterV2 } = require('../clinic/ClinicOperationsAdapterV2');

describe('ClinicOperationsAdapter', () => {
  let mockKernel;
  let adapter;

  beforeEach(() => {
    mockKernel = {
      ingestEvent: jest.fn().mockResolvedValue({ id: 'event1' }),
      occQueryService: {
        getOccState: jest.fn().mockResolvedValue({
          appointments: [],
          schedule: { fillRate: 70 },
        }),
      },
      decisionEngine: {
        decide: jest
          .fn()
          .mockResolvedValue({ id: 'decision1', recommendation: 'reschedule' }),
      },
      actionsService: { execute: jest.fn().mockResolvedValue({ id: 'action1' }) },
      outcomesService: { recordOutcome: jest.fn().mockResolvedValue({ recorded: true }) },
      signalsService: {
        generateForTenant: jest.fn().mockResolvedValue([
          { id: 'signal1', contexts: ['recepção'] },
        ]),
      },
    };

    adapter = new ClinicOperationsAdapterV2(mockKernel);
  });

  describe('Initialization', () => {
    it('requires kernel instance', () => {
      expect(() => new ClinicOperationsAdapterV2(null)).toThrow(
        'requires ServiceOperationsKernel instance'
      );
    });

    it('sets correct vertical name', () => {
      expect(adapter.verticalName).toBe('clinic');
    });

    it('builds vocabulary with medical contexts', () => {
      expect(adapter.vocabulary).toBeDefined();
      expect(adapter.vocabulary.entities.patient).toBe('patient');
      expect(adapter.vocabulary.contexts.consultation).toBe('consulta');
    });
  });

  describe('Event Ingestion', () => {
    it('injects valid clinic event', async () => {
      adapter._classifyEvent = jest.fn().mockReturnValue('appointment_management');

      await adapter.ingestClinicEvent({
        type: 'clinic:appointment.scheduled',
        payload: { patientId: 'patient1', doctorId: 'doctor1' },
        tenantId: 'tenant1',
      });

      expect(mockKernel.ingestEvent).toHaveBeenCalled();
    });

    it('adds vertical context to payload', async () => {
      jest.spyOn(adapter, 'ingestClinicEvent').mockImplementation(async (opts) => {
        return mockKernel.ingestEvent({
          type: opts.type,
          payload: { ...opts.payload, vertical: 'clinic' },
          source: opts.source || 'clinic-system',
          tenantId: opts.tenantId,
        });
      });

      await adapter.ingestClinicEvent({
        type: 'clinic:appointment.scheduled',
        payload: { patientId: 'patient1' },
        tenantId: 'tenant1',
      });

      expect(mockKernel.ingestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ vertical: 'clinic' }),
        })
      );
    });
  });

  describe('Decision Generation', () => {
    it('generates decisions for no-show prevention', async () => {
      adapter._classifyEvent = jest.fn().mockReturnValue('no_show_management');
      adapter._selectPolicies = jest.fn().mockReturnValue([
        { id: 'appt_reschedule_0', name: 'Reschedule Policy' },
      ]);

      await adapter.generateClinicDecisions({
        tenantId: 'tenant1',
        eventId: 'event1',
        eventType: 'clinic:appointment.no_show',
        eventPayload: { appointmentId: 'appt1' },
      });

      expect(mockKernel.decisionEngine.decide).toHaveBeenCalled();
    });

    it('classifies appointment events', () => {
      expect(adapter._classifyEvent('clinic:appointment.scheduled')).toBe('appointment_management');
    });

    it('classifies no-show events', () => {
      expect(adapter._classifyEvent('clinic:appointment.no_show')).toBe('no_show_management');
    });

    it('classifies patient lifecycle events', () => {
      expect(adapter._classifyEvent('clinic:patient.admitted')).toBe('patient_lifecycle');
    });
  });

  describe('Action Execution', () => {
    it('executes clinic action', async () => {
      await adapter.executeClinicAction({
        tenantId: 'tenant1',
        actionId: 'action1',
        actionType: 'reschedule_appointment',
        parameters: { appointmentId: 'appt1' },
      });

      expect(mockKernel.actionsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'reschedule_appointment',
          parameters: expect.objectContaining({
            vertical: 'clinic',
          }),
        })
      );
    });
  });

  describe('Outcome Recording', () => {
    it('records clinic outcome', async () => {
      await adapter.recordClinicOutcome({
        tenantId: 'tenant1',
        eventId: 'event1',
        actionId: 'action1',
        result: 'success',
        metrics: { appointmentConfirmed: true },
      });

      expect(mockKernel.outcomesService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.objectContaining({ vertical: 'clinic' }),
        })
      );
    });
  });

  describe('Operational State', () => {
    it('projects operational state', async () => {
      const state = await adapter.getClinicOperationalState({ tenantId: 'tenant1' });

      expect(state).toBeDefined();
      expect(state).toHaveProperty('schedule');
      expect(state).toHaveProperty('patients');
      expect(state).toHaveProperty('doctors');
      expect(state).toHaveProperty('rooms');
      expect(state).toHaveProperty('kpis');
    });
  });

  describe('Signals Generation', () => {
    it('generates clinic-specific signals', async () => {
      const signals = await adapter.generateClinicSignals({ tenantId: 'tenant1' });

      expect(signals).toBeDefined();
      expect(signals).toHaveProperty('baseSignals');
      expect(signals).toHaveProperty('clinicSignals');
      expect(signals).toHaveProperty('specializations');
    });

    it('detects clinic-relevant signals', () => {
      const signal = { id: 'sig1', contexts: ['consulta'] };
      const isRelevant = adapter._isClinicRelevant(signal);
      expect(isRelevant).toBe(true);
    });
  });

  describe('Quick Actions', () => {
    it('lists quick actions based on state', async () => {
      jest.spyOn(adapter, 'getClinicOperationalState').mockResolvedValue({
        schedule: { availableSlots: 10 },
        patients: { noShowRisk: 15 },
      });

      const actions = await adapter.listClinicQuickActions({ tenantId: 'tenant1' });
      expect(Array.isArray(actions)).toBe(true);
    });
  });

  describe('Playbooks', () => {
    it('lists playbooks for scenario', async () => {
      const playbooks = await adapter.listClinicPlaybooks({
        tenantId: 'tenant1',
        scenario: 'no_show_prevention',
      });

      expect(Array.isArray(playbooks)).toBe(true);
      expect(playbooks.length).toBeGreaterThan(0);
    });

    it('requires scenario parameter', async () => {
      await expect(
        adapter.listClinicPlaybooks({ tenantId: 'tenant1' })
      ).rejects.toThrow('Scenario required');
    });
  });
});
