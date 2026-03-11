'use strict';

const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const { ClinicOperationsAdapterV2 } = require('../ClinicOperationsAdapterV2');

describe('ClinicOperationsAdapterV2', () => {
  let mockKernel;
  let adapter;

  beforeEach(() => {
    mockKernel = {
      ingestEvent: jest.fn().mockResolvedValue({ eventId: 'evt_1' }),
      occQueryService: {
        getOccState: jest.fn().mockResolvedValue({
          appointments: [{ id: 'appt-1', status: 'scheduled' }],
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

    adapter = new ClinicOperationsAdapterV2(mockKernel);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with kernel', () => {
      expect(adapter.kernel).toBe(mockKernel);
      expect(adapter.verticalName).toBe('clinic');
    });

    it('should throw if kernel is missing', () => {
      expect(() => new ClinicOperationsAdapterV2(null)).toThrow('requires ServiceOperationsKernel');
    });
  });

  describe('ingestClinicEvent', () => {
    it('should ingest valid clinic event', async () => {
      const result = await adapter.ingestClinicEvent({
        type: 'appointment.scheduled',
        payload: { appointmentId: 'appt-1' },
        tenantId: 'tenant-1',
      });

      expect(mockKernel.ingestEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'appointment.scheduled',
          payload: expect.objectContaining({ vertical: 'clinic' }),
        })
      );
      expect(result.eventId).toBe('evt_1');
    });

    it('should reject unknown event type', async () => {
      await expect(
        adapter.ingestClinicEvent({
          type: 'unknown.event',
          payload: {},
        })
      ).rejects.toThrow('Unknown clinic event type');
    });
  });

  describe('generateClinicDecisions', () => {
    it('should generate decisions for event', async () => {
      const result = await adapter.generateClinicDecisions({
        tenantId: 'tenant-1',
        eventId: 'evt_1',
        eventType: 'no_show.detected',
        eventPayload: { appointmentId: 'appt-1' },
      });

      expect(mockKernel.decisionEngine.decide).toHaveBeenCalled();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('executeClinicAction', () => {
    it('should execute action through kernel', async () => {
      const result = await adapter.executeClinicAction({
        tenantId: 'tenant-1',
        actionId: 'act_1',
        actionType: 'reschedule_appointment',
      });

      expect(mockKernel.actionsService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          vertical: 'clinic',
        })
      );
      expect(result.actionId).toBe('act_1');
    });
  });

  describe('recordClinicOutcome', () => {
    it('should record outcome with metrics', async () => {
      const result = await adapter.recordClinicOutcome({
        tenantId: 'tenant-1',
        eventId: 'evt_1',
        decisionId: 'dec_1',
        actionId: 'act_1',
        result: 'success',
        metrics: { reschedulingTime: 2 },
      });

      expect(mockKernel.outcomesService.recordOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          vertical: 'clinic',
          metrics: expect.objectContaining({ reschedulingTime: 2 }),
        })
      );
      expect(result.outcomeId).toBe('out_1');
    });
  });

  describe('getClinicOperationalState', () => {
    it('should return operational state with all components', async () => {
      const state = await adapter.getClinicOperationalState({ tenantId: 'tenant-1' });

      expect(state).toHaveProperty('schedule');
      expect(state).toHaveProperty('patients');
      expect(state).toHaveProperty('doctors');
      expect(state).toHaveProperty('rooms');
      expect(state).toHaveProperty('kpis');
    });
  });

  describe('listClinicQuickActions', () => {
    it('should return list of quick actions', async () => {
      const actions = await adapter.listClinicQuickActions({ tenantId: 'tenant-1' });

      expect(Array.isArray(actions)).toBe(true);
      actions.forEach((action) => {
        expect(action).toHaveProperty('id');
        expect(action).toHaveProperty('name');
        expect(action).toHaveProperty('description');
      });
    });
  });

  describe('listClinicPlaybooks', () => {
    it('should return playbooks for scenario', async () => {
      const playbooks = await adapter.listClinicPlaybooks({
        tenantId: 'tenant-1',
        scenario: 'no_show_prevention',
      });

      expect(Array.isArray(playbooks)).toBe(true);
    });

    it('should throw if scenario is missing', async () => {
      await expect(
        adapter.listClinicPlaybooks({ tenantId: 'tenant-1' })
      ).rejects.toThrow('Scenario required');
    });
  });

  describe('generateClinicSignals', () => {
    it('should generate signals and specializations', async () => {
      const signals = await adapter.generateClinicSignals({ tenantId: 'tenant-1' });

      expect(signals).toHaveProperty('baseSignals');
      expect(signals).toHaveProperty('clinicSignals');
      expect(signals).toHaveProperty('specializations');
      expect(signals.specializations).toHaveProperty('noShowRiskDetected');
      expect(signals.specializations).toHaveProperty('gapFillOpportunity');
      expect(signals.specializations).toHaveProperty('patientChurnRisk');
    });
  });
});
