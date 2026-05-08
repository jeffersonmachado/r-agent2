'use strict';

describe('preflightEngine strict preflight', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('executeFullPreflight retorna GO quando preconditions obrigatorias reais passam', async () => {
    const preflightEngine = require('../qa/preflightEngine');

    const probes = {
      authenticated_agent: jest.fn().mockResolvedValue({ ok: true, evidence: { sessionId: 'sess-1', token: 'tok-1', userId: 'user-1' } }),
      tenant_loaded: jest.fn().mockResolvedValue({ ok: true, evidence: { tenantId: 'tenant-1' } }),
      open_ticket_exists: jest.fn().mockResolvedValue({ ok: true, evidence: { ticket: { id: 'ticket-1', status: 'in_progress', tenantId: 'tenant-1' } } }),
      ticket_storage_accessible: jest.fn().mockResolvedValue({ ok: true, evidence: { storage: 'tickets' } }),
    };

    const result = await preflightEngine.executeFullPreflight({
      waveId: 'wave-1',
      journeyId: 'support_ticket_flow',
      scenarioIds: ['scenario-1'],
      capabilityIds: ['ticket-reply'],
      tenantId: 'tenant-1',
      context: {
        authToken: 'tok-1',
        user: { id: 'user-1' },
        session: { id: 'sess-1' },
        ticketId: 'ticket-1',
        tenantId: 'tenant-1',
        probes,
      },
    });

    expect(result.status).toBe('GO');
    expect(result.reason).toBeNull();
    expect(result.missing).toEqual([]);
  });

  test('executeFullPreflight retorna NO_GO/PRECONDITION_FAILED em entrada invalida', async () => {
    const preflightEngine = require('../qa/preflightEngine');

    const result = await preflightEngine.executeFullPreflight({
      waveId: 'wave-1',
      scenarioIds: ['scenario-1'],
      capabilityIds: ['ticket-reply'],
      tenantId: 'tenant-1',
      context: {},
    });

    expect(result.status).toBe('NO_GO');
    expect(result.reason).toBe('PRECONDITION_FAILED');
    expect(Array.isArray(result.missing)).toBe(true);
    expect(result.missing.some((item) => String(item.reason).includes('journeyId obrigatório'))).toBe(true);
  });

  test('validateJourneyPreconditions usa fallback de probes padrao quando contexto nao envia probes', async () => {
    jest.doMock('../qa/preflightProbeRegistry', () => ({
      getDefaultPreflightProbes: () => ({
        authenticated_agent: jest.fn().mockResolvedValue({ ok: true, evidence: { sessionId: 'sess-2', token: 'tok-2', userId: 'user-2' } }),
        tenant_loaded: jest.fn().mockResolvedValue({ ok: true, evidence: { tenantId: 'tenant-2' } }),
        open_ticket_exists: jest.fn().mockResolvedValue({ ok: true, evidence: { ticket: { id: 'ticket-2', status: 'waiting', tenantId: 'tenant-2' } } }),
        ticket_storage_accessible: jest.fn().mockResolvedValue({ ok: true, evidence: { storage: 'tickets' } }),
      }),
    }));

    const preflightEngine = require('../qa/preflightEngine');

    const result = await preflightEngine.validateJourneyPreconditions('support_ticket_flow', {
      authToken: 'tok-2',
      user: { id: 'user-2' },
      session: { id: 'sess-2' },
      ticketId: 'ticket-2',
      tenantId: 'tenant-2',
    });

    expect(result.status).toBe('GO');
    expect(result.reason).toBeNull();
  });
});
