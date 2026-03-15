jest.mock('../../api/modules/access-control/accessControlRepository', () => ({
  findDecision: jest.fn(),
  listEvents: jest.fn(),
  findDevice: jest.fn(),
  findPolicy: jest.fn(),
  listDecisions: jest.fn(),
}));

const repository = require('../../api/modules/access-control/accessControlRepository');
const {
  getDecisionExecutionStatus,
  listDecisionExecutionStatuses,
  summarizeDecisionExecutionStatuses,
  getDecisionHealthSnapshot,
} = require('../../api/modules/access-control/decisions/decisionStatusService');

describe('decisionStatusService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findDevice.mockResolvedValue(null);
    repository.findPolicy.mockResolvedValue(null);
    repository.listDecisions.mockResolvedValue([]);
  });

  it('retorna null quando decisão não existe', async () => {
    repository.findDecision.mockResolvedValueOnce(null);
    const result = await getDecisionExecutionStatus({ tenantId: 'tenant-1', decisionId: 'dec-1' });
    expect(result).toBeNull();
  });

  it('marca como executed quando há callback de sucesso', async () => {
    repository.findDecision.mockResolvedValueOnce({
      id: 'dec-1',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    repository.listEvents.mockResolvedValueOnce([
      { id: 'evt-1', event_type: 'device_callback', raw_payload: { status: 'executed' } },
    ]);

    const result = await getDecisionExecutionStatus({ tenantId: 'tenant-1', decisionId: 'dec-1' });

    expect(result.execution_status).toBe('executed');
    expect(result.callback_event).toEqual(expect.objectContaining({ id: 'evt-1' }));
  });

  it('marca como expired quando a decisão venceu sem confirmação', async () => {
    repository.findDecision.mockResolvedValueOnce({
      id: 'dec-2',
      expires_at: '2000-01-01T00:00:00.000Z',
      issued_at: '1999-12-31T23:59:00.000Z',
    });
    repository.listEvents.mockResolvedValueOnce([]);

    const result = await getDecisionExecutionStatus({ tenantId: 'tenant-1', decisionId: 'dec-2' });

    expect(result.execution_status).toBe('expired');
  });

  it('reconcilia lista de decisões em lote', async () => {
    repository.findDecision
      .mockResolvedValueOnce({
        id: 'dec-10',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        issued_at: new Date(Date.now() - 1000).toISOString(),
      })
      .mockResolvedValueOnce({
        id: 'dec-11',
        expires_at: '2000-01-01T00:00:00.000Z',
        issued_at: '1999-12-31T23:59:00.000Z',
      });
    repository.listEvents
      .mockResolvedValueOnce([{ id: 'evt-10', event_type: 'device_callback', raw_payload: { status: 'executed' } }])
      .mockResolvedValueOnce([]);

    const result = await listDecisionExecutionStatuses({
      tenantId: 'tenant-1',
      decisions: [
        { id: 'dec-10', decision: 'allow' },
        { id: 'dec-11', decision: 'allow' },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({ id: 'dec-10', execution_status: 'executed' }),
      expect.objectContaining({ id: 'dec-11', execution_status: 'expired' }),
    ]);
  });

  it('filtra lista reconciliada por execution_status', async () => {
    repository.findDecision
      .mockResolvedValueOnce({
        id: 'dec-20',
        expires_at: new Date(Date.now() + 60000).toISOString(),
        issued_at: new Date(Date.now() - 1000).toISOString(),
      })
      .mockResolvedValueOnce({
        id: 'dec-21',
        expires_at: '2000-01-01T00:00:00.000Z',
        issued_at: '1999-12-31T23:59:00.000Z',
      });
    repository.listEvents
      .mockResolvedValueOnce([{ id: 'evt-20', event_type: 'device_callback', raw_payload: { status: 'executed' } }])
      .mockResolvedValueOnce([]);

    const result = await listDecisionExecutionStatuses({
      tenantId: 'tenant-1',
      decisions: [
        { id: 'dec-20', decision: 'allow' },
        { id: 'dec-21', decision: 'allow' },
      ],
      executionStatus: 'expired',
    });

    expect(result).toEqual([
      expect.objectContaining({ id: 'dec-21', execution_status: 'expired' }),
    ]);
  });

  it('filtra lista reconciliada só para pending crítico', async () => {
    repository.findDecision
      .mockResolvedValueOnce({
        id: 'dec-22',
        issued_at: new Date(Date.now() - (5 * 60 * 1000)).toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
      })
      .mockResolvedValueOnce({
        id: 'dec-23',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
      });
    repository.listEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listDecisionExecutionStatuses({
      tenantId: 'tenant-1',
      decisions: [
        { id: 'dec-22', decision: 'allow' },
        { id: 'dec-23', decision: 'allow' },
      ],
      pendingCriticalOnly: true,
    });

    expect(result).toEqual([
      expect.objectContaining({ id: 'dec-22', pending_critical: true }),
    ]);
  });

  it('resume contagem por execution_status', () => {
    const result = summarizeDecisionExecutionStatuses([
      { id: 'a', execution_status: 'pending', pending_critical: true },
      { id: 'b', execution_status: 'executed' },
      { id: 'c', execution_status: 'executed' },
      { id: 'd', execution_status: 'failed' },
      { id: 'e', execution_status: 'custom' },
    ]);

    expect(result).toEqual({
      total: 5,
      pending: 1,
      pending_critical: 1,
      executed: 2,
      failed: 1,
      expired: 0,
      unknown: 1,
    });
  });

  it('marca pending crítico quando a decisão envelheceu sem ack', async () => {
    repository.findDecision.mockResolvedValueOnce({
      id: 'dec-30',
      issued_at: new Date(Date.now() - (5 * 60 * 1000)).toISOString(),
      expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
    });
    repository.listEvents.mockResolvedValueOnce([]);

    const result = await getDecisionExecutionStatus({ tenantId: 'tenant-1', decisionId: 'dec-30' });

    expect(result.execution_status).toBe('pending');
    expect(result.pending_critical).toBe(true);
  });

  it('usa threshold configurado na policy por unidade quando disponível', async () => {
    repository.findDecision.mockResolvedValueOnce({
      id: 'dec-31',
      device_id: 'dev-31',
      metadata: { policyId: 'policy-31' },
      issued_at: new Date(Date.now() - (2 * 60 * 1000)).toISOString(),
      expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
    });
    repository.findDevice.mockResolvedValueOnce({
      id: 'dev-31',
      unit_id: 'unit-a',
      metadata: {},
    });
    repository.findPolicy.mockResolvedValueOnce({
      id: 'policy-31',
      metadata: {
        pending_critical_age_by_unit: {
          'unit-a': 60000,
        },
      },
      grace_policy: {},
    });
    repository.listEvents.mockResolvedValueOnce([]);

    const result = await getDecisionExecutionStatus({ tenantId: 'tenant-1', decisionId: 'dec-31' });

    expect(result.execution_status).toBe('pending');
    expect(result.pending_critical).toBe(true);
    expect(result.pending_critical_threshold_ms).toBe(60000);
    expect(result.pending_critical_threshold_source).toBe('policy_metadata:unit');
  });

  it('faz fallback para threshold configurado no device quando não há policy específica', async () => {
    repository.findDecision.mockResolvedValueOnce({
      id: 'dec-32',
      device_id: 'dev-32',
      issued_at: new Date(Date.now() - (2 * 60 * 1000)).toISOString(),
      expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
    });
    repository.findDevice.mockResolvedValueOnce({
      id: 'dev-32',
      unit_id: 'unit-b',
      metadata: {
        pending_critical_age_ms: 60000,
      },
    });
    repository.listEvents.mockResolvedValueOnce([]);

    const result = await getDecisionExecutionStatus({ tenantId: 'tenant-1', decisionId: 'dec-32' });

    expect(result.pending_critical).toBe(true);
    expect(result.pending_critical_threshold_ms).toBe(60000);
    expect(result.pending_critical_threshold_source).toBe('device_metadata');
  });

  it('gera snapshot de saúde com pendências críticas', async () => {
    repository.listDecisions.mockResolvedValueOnce([
      {
        id: 'dec-40',
        issued_at: new Date(Date.now() - (5 * 60 * 1000)).toISOString(),
        expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
      },
      {
        id: 'dec-41',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
      },
      {
        id: 'dec-42',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
      },
    ]);
    repository.findDecision
      .mockResolvedValueOnce({
        id: 'dec-40',
        issued_at: new Date(Date.now() - (5 * 60 * 1000)).toISOString(),
        expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
      })
      .mockResolvedValueOnce({
        id: 'dec-41',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
      })
      .mockResolvedValueOnce({
        id: 'dec-42',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (5 * 60 * 1000)).toISOString(),
      });
    repository.listEvents
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'evt-42', event_type: 'deny' }]);

    const snapshot = await getDecisionHealthSnapshot({ tenantId: 'tenant-1', limit: 10 });

    expect(snapshot.has_incidents).toBe(true);
    expect(snapshot.threshold_scope).toBe('policy_device_aware');
    expect(snapshot.pending_critical_items).toHaveLength(1);
    expect(snapshot.failed_items).toHaveLength(1);
    expect(snapshot.summary.pending).toBe(2);
    expect(snapshot.summary.pending_critical).toBe(1);
    expect(snapshot.summary.failed).toBe(1);
  });
});
