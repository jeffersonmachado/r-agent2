'use strict';

describe('qaWavesOperationalService runtime integrations', () => {
  let accessSubjectCount;
  let pbxTenantCount;
  let accessDeviceFindOne;
  let normalizeProvider;
  let runAutonomousGapClosureLoop;
  let service;

  beforeEach(() => {
    jest.resetModules();

    accessSubjectCount = jest.fn();
    pbxTenantCount = jest.fn();
    accessDeviceFindOne = jest.fn();
    normalizeProvider = jest.fn();
    runAutonomousGapClosureLoop = jest.fn(async (payload) => ({
      ok: true,
      payload,
    }));

    jest.doMock('../../integrations/paymentProvider', () => ({
      normalizeProvider,
    }));

    jest.doMock('../../db/models', () => ({
      AccessSubject: () => ({ count: accessSubjectCount }),
      PbxTenant: () => ({ count: pbxTenantCount }),
      AccessDevice: () => ({ findOne: accessDeviceFindOne }),
    }));

    jest.doMock('../qa/autonomousGapClosureEngine', () => ({
      runAutonomousGapClosureLoop,
      detectGapsWithAutoRemediations: jest.fn(),
      generateClosureReport: jest.fn(),
      checkPreflightBlockers: jest.fn(),
      validateReplayOperationality: jest.fn(),
      classifyOperationality: jest.fn(),
    }));

    service = require('../qaWavesOperationalService');
  });

  test('fallback de payment_gateway retorna no-go explicito quando provider nao esta pronto', async () => {
    normalizeProvider.mockImplementation(() => {
      throw new Error('required_config_missing:billing.provider');
    });

    const payload = service.buildStagingAutonomousLoopPayload({
      snapshot: { journeyContracts: { support_ticket_flow: { requiredCapabilities: ['support_ticket_flow'] } } },
      tenantId: 'tenant-1',
      deviceId: 'device-1',
    });

    const result = await payload.context.integrations.payment_gateway.health();

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('payment_provider_not_ready');
  });

  test('fallback de release_mechanism informa device_id_missing quando contexto nao tem deviceId', async () => {
    normalizeProvider.mockReturnValue('sandbox');

    const payload = service.buildStagingAutonomousLoopPayload({
      snapshot: { journeyContracts: { support_ticket_flow: { requiredCapabilities: [] } } },
      tenantId: 'tenant-1',
    });

    const result = await payload.context.integrations.release_mechanism.health();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('device_id_missing');
  });

  test('fallback de pbx retorna pbx_tenant_not_configured quando tenant nao esta materializado', async () => {
    normalizeProvider.mockReturnValue('sandbox');
    pbxTenantCount.mockResolvedValue(0);

    const payload = service.buildStagingAutonomousLoopPayload({
      snapshot: { journeyContracts: { support_ticket_flow: { requiredCapabilities: [] } } },
      tenantId: 'tenant-pbx',
    });

    const result = await payload.context.integrations.pbx.health();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('pbx_tenant_not_configured');
  });

  test('fallback de crm nao quebra fluxo e devolve evidencia mesmo sem contatos', async () => {
    normalizeProvider.mockReturnValue('sandbox');
    accessSubjectCount.mockResolvedValue(0);

    const payload = service.buildStagingAutonomousLoopPayload({
      snapshot: { journeyContracts: { support_ticket_flow: { requiredCapabilities: [] } } },
      tenantId: 'tenant-crm',
    });

    const result = await payload.context.integrations.crm.health();

    expect(result.ok).toBe(true);
    expect(result.evidence.contactsDetected).toBe(0);
  });

  test('runIntegrationReadinessProbe executa todos os probes e devolve goNoGo GO quando todos ok', async () => {
    normalizeProvider.mockReturnValue('sandbox');
    accessSubjectCount.mockResolvedValue(3);
    pbxTenantCount.mockResolvedValue(1);

    const payload = service.buildStagingAutonomousLoopPayload({
      snapshot: { journeyContracts: { support_ticket_flow: { requiredCapabilities: [] } } },
      tenantId: 'tenant-1',
    });

    const result = await service.runIntegrationReadinessProbe(payload);

    expect(result.readinessAt).toBeDefined();
    expect(result.integrations).toHaveProperty('crm');
    expect(result.integrations).toHaveProperty('payment_gateway');
    expect(result.integrations).toHaveProperty('pbx');
    expect(result.integrations).toHaveProperty('release_mechanism');
    expect(result.integrations.crm.ok).toBe(true);
    expect(result.integrations.payment_gateway.ok).toBe(true);
    expect(result.integrations.pbx.ok).toBe(true);
    // release_mechanism sem deviceId → NO
    expect(result.integrations.release_mechanism.ok).toBe(false);
    expect(result.integrations.release_mechanism.reason).toBe('device_id_missing');
    expect(result.goNoGo).toBe('NO_GO');
    expect(result.allReady).toBe(false);
    expect(result.notReady).toHaveLength(1);
    expect(result.notReady[0].integration).toBe('release_mechanism');
  });

  test('runIntegrationReadinessProbe devolve GO quando device tambem esta ok', async () => {
    normalizeProvider.mockReturnValue('sandbox');
    accessSubjectCount.mockResolvedValue(1);
    pbxTenantCount.mockResolvedValue(1);
    accessDeviceFindOne.mockResolvedValue({
      metadata: { heartbeatAt: '2026-05-07T10:00:00.000Z', integrationOk: true },
    });

    const payload = service.buildStagingAutonomousLoopPayload({
      snapshot: { journeyContracts: { support_ticket_flow: { requiredCapabilities: [] } } },
      tenantId: 'tenant-1',
      deviceId: 'device-ok',
    });

    const result = await service.runIntegrationReadinessProbe(payload);

    expect(result.goNoGo).toBe('GO');
    expect(result.allReady).toBe(true);
    expect(result.notReady).toHaveLength(0);
    expect(result.integrations.release_mechanism.ok).toBe(true);
    expect(result.integrations.release_mechanism.evidence.deviceId).toBe('device-ok');
  });

  test('runIntegrationReadinessProbe captura excecao de probe e inclui no notReady', async () => {
    accessSubjectCount.mockRejectedValue(new Error('db_timeout'));
    normalizeProvider.mockReturnValue('sandbox');
    pbxTenantCount.mockResolvedValue(0);

    const payload = service.buildStagingAutonomousLoopPayload({
      snapshot: { journeyContracts: { support_ticket_flow: { requiredCapabilities: [] } } },
      tenantId: 'tenant-err',
    });

    const result = await service.runIntegrationReadinessProbe(payload);

    expect(result.goNoGo).toBe('NO_GO');
    expect(result.integrations.crm.ok).toBe(false);
    expect(result.integrations.crm.reason).toContain('probe_threw');
  });

  test('executeAutonomousGapClosureLoop injeta integrations runtime antes de delegar ao engine', async () => {
    normalizeProvider.mockReturnValue('sandbox');
    pbxTenantCount.mockResolvedValue(1);

    await service.executeAutonomousGapClosureLoop({
      waveId: 'wave-1',
      tenantId: 'tenant-1',
      context: { deviceId: 'device-1' },
    });

    expect(runAutonomousGapClosureLoop).toHaveBeenCalledTimes(1);
    const delegatedPayload = runAutonomousGapClosureLoop.mock.calls[0][0];
    expect(delegatedPayload.context.integrations).toEqual(
      expect.objectContaining({
        crm: expect.any(Object),
        payment_gateway: expect.any(Object),
        pbx: expect.any(Object),
        release_mechanism: expect.any(Object),
      })
    );
  });
});
