jest.mock('../../api/modules/access-control/accessControlService', () => ({
  listDevices: jest.fn(async () => [{ id: 'dev-1', name: 'Catraca' }]),
  getDevice: jest.fn(async ({ id }) => ({ id, vendor: 'Control iD', model: 'IDBlock' })),
  createDevice: jest.fn(async ({ payload }) => ({ id: 'dev-1', ...payload })),
  listCredentials: jest.fn(async () => [{ id: 'cred-1' }]),
  createCredential: jest.fn(async ({ payload }) => ({ id: 'cred-1', ...payload })),
  listPolicies: jest.fn(async () => [{ id: 'policy-1' }]),
  createPolicy: jest.fn(async ({ payload }) => ({ id: 'policy-1', ...payload })),
  listDecisions: jest.fn(async () => [{ id: 'dec-1', decision: 'allow', reason_code: 'allowed_active' }]),
  listEvents: jest.fn(async () => [{ id: 'evt-1', event_type: 'entry' }]),
  createEvent: jest.fn(async ({ payload }) => ({ id: 'evt-1', ...payload })),
  patchDevice: jest.fn(async ({ id, payload }) => ({ id, ...payload })),
  patchCredential: jest.fn(async ({ id, payload }) => ({ id, ...payload })),
  patchPolicy: jest.fn(async ({ id, payload }) => ({ id, ...payload })),
}));

jest.mock('../../api/modules/access-control/accessDecisionService', () => ({
  resolveDecision: jest.fn(async () => ({ decision: { id: 'dec-1', decision: 'allow' }, token: 'signed-token', event: { id: 'evt-1' } })),
  issueVisitorQr: jest.fn(async () => ({ ok: true, qr_payload: 'qr-token', qr_svg: '<svg />' })),
  resolveQrToken: jest.fn(async () => ({ decision: { id: 'dec-qr', decision: 'allow' }, token: 'signed-token', event: { id: 'evt-qr' } })),
}));

jest.mock('../../api/modules/access-control/decisions/decisionStatusService', () => ({
  getDecisionExecutionStatus: jest.fn(async ({ decisionId }) => ({
    decision: { id: decisionId, decision: 'allow' },
    execution_status: 'executed',
    pending_critical: false,
    callback_event: { id: 'evt-cb' },
    access_event: null,
    deny_event: null,
    events: [],
  })),
  listDecisionExecutionStatuses: jest.fn(async ({ decisions }) => decisions.map((item) => ({
    ...item,
    execution_status: 'executed',
    pending_critical: false,
    pending_critical_threshold_ms: 180000,
    pending_critical_threshold_source: 'environment_default',
  }))),
  summarizeDecisionExecutionStatuses: jest.fn(() => ({
    total: 1,
    pending: 0,
    pending_critical: 0,
    executed: 1,
    failed: 0,
    expired: 0,
    unknown: 0,
  })),
  getDecisionHealthSnapshot: jest.fn(async () => ({
    threshold_ms: 180000,
    threshold_scope: 'policy_device_aware',
    summary: {
      total: 1,
      pending: 0,
      pending_critical: 0,
      executed: 1,
      failed: 0,
      expired: 0,
      unknown: 0,
    },
    has_incidents: false,
    pending_critical_items: [],
    failed_items: [],
  })),
}));

const { handleAccessControlRoutes } = require('../../api/serverHandlers/accessControlRoutes');
const accessControlService = require('../../api/modules/access-control/accessControlService');
const accessDecisionService = require('../../api/modules/access-control/accessDecisionService');
const {
  getDecisionExecutionStatus,
  listDecisionExecutionStatuses,
  summarizeDecisionExecutionStatuses,
  getDecisionHealthSnapshot,
} = require('../../api/modules/access-control/decisions/decisionStatusService');

function buildReq({ method = 'GET', url = '/', headers = {}, tenantId = 'tenant-a', agent = { id: 'ag-1', username: 'agent', tenantId: 'tenant-a' } } = {}) {
  return {
    method,
    url,
    headers,
    tenantId,
    agent,
  };
}

describe('accessControlRoutes', () => {
  const baseDeps = {
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(() => ({ allowed: true })),
    requireTenant: jest.fn((req) => req.tenantId),
    logger: { error: jest.fn() },
    logAction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    accessControlService.listDevices.mockResolvedValue([{ id: 'dev-1', name: 'Catraca' }]);
    accessControlService.getDevice.mockImplementation(async ({ id }) => ({ id, vendor: 'Control iD', model: 'IDBlock' }));
    accessControlService.createDevice.mockImplementation(async ({ payload }) => ({ id: 'dev-1', ...payload }));
    accessControlService.listCredentials.mockResolvedValue([{ id: 'cred-1' }]);
    accessControlService.createCredential.mockImplementation(async ({ payload }) => ({ id: 'cred-1', ...payload }));
    accessControlService.listPolicies.mockResolvedValue([{ id: 'policy-1' }]);
    accessControlService.createPolicy.mockImplementation(async ({ payload }) => ({ id: 'policy-1', ...payload }));
    accessControlService.listDecisions.mockResolvedValue([{ id: 'dec-1', decision: 'allow', reason_code: 'allowed_active' }]);
    accessControlService.listEvents.mockResolvedValue([{ id: 'evt-1', event_type: 'entry' }]);
    accessControlService.createEvent.mockImplementation(async ({ payload }) => ({ id: 'evt-1', ...payload }));
    accessControlService.patchDevice.mockImplementation(async ({ id, payload }) => ({ id, ...payload }));
    accessControlService.patchCredential.mockImplementation(async ({ id, payload }) => ({ id, ...payload }));
    accessControlService.patchPolicy.mockImplementation(async ({ id, payload }) => ({ id, ...payload }));
    accessDecisionService.resolveDecision.mockResolvedValue({ decision: { id: 'dec-1', decision: 'allow' }, token: 'signed-token', event: { id: 'evt-1' } });
    accessDecisionService.issueVisitorQr.mockResolvedValue({ ok: true, qr_payload: 'qr-token', qr_svg: '<svg />' });
    accessDecisionService.resolveQrToken.mockResolvedValue({ decision: { id: 'dec-qr', decision: 'allow' }, token: 'signed-token', event: { id: 'evt-qr' } });
    baseDeps.hasJsonContentType.mockReturnValue(true);
    baseDeps.parseJsonBody.mockResolvedValue({});
    baseDeps.requireAuth.mockReturnValue({ valid: true });
    baseDeps.requirePermission.mockReturnValue({ allowed: true });
    baseDeps.requireTenant.mockImplementation((req) => req.tenantId);
    getDecisionExecutionStatus.mockResolvedValue({
      decision: { id: 'dec-1', decision: 'allow' },
      execution_status: 'executed',
      pending_critical: false,
      pending_critical_threshold_ms: 180000,
      pending_critical_threshold_source: 'environment_default',
      callback_event: { id: 'evt-cb' },
      access_event: null,
      deny_event: null,
      events: [],
    });
    listDecisionExecutionStatuses.mockResolvedValue([
      {
        id: 'dec-1',
        decision: 'allow',
        reason_code: 'allowed_active',
        execution_status: 'executed',
        pending_critical: false,
        pending_critical_threshold_ms: 180000,
        pending_critical_threshold_source: 'environment_default',
      },
    ]);
    summarizeDecisionExecutionStatuses.mockReturnValue({
      total: 1,
      pending: 0,
      pending_critical: 0,
      executed: 1,
      failed: 0,
      expired: 0,
      unknown: 0,
    });
    getDecisionHealthSnapshot.mockResolvedValue({
      threshold_ms: 180000,
      threshold_scope: 'policy_device_aware',
      summary: {
        total: 1,
        pending: 0,
        pending_critical: 0,
        executed: 1,
        failed: 0,
        expired: 0,
        unknown: 0,
      },
      has_incidents: false,
      pending_critical_items: [],
      failed_items: [],
    });
  });

  it('lista devices pela rota protegida', async () => {
    const req = buildReq({ method: 'GET', url: '/api/access-control/devices' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'GET',
      pathname: '/api/access-control/devices',
      deps: baseDeps,
    });

    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 200, { items: [{ id: 'dev-1', name: 'Catraca' }] });
  });

  it('cria visitor QR pela rota dedicada', async () => {
    baseDeps.parseJsonBody.mockResolvedValueOnce({ vertical: 'fitness' });
    const req = buildReq({ method: 'POST', url: '/api/access-control/visitors/qrcode' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'POST',
      pathname: '/api/access-control/visitors/qrcode',
      deps: baseDeps,
    });

    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 201, expect.objectContaining({ ok: true, qr_payload: 'qr-token' }));
  });

  it('resolve QR pela rota dedicada', async () => {
    baseDeps.parseJsonBody.mockResolvedValueOnce({ token: 'qr-token', action: 'enter', device_id: 'dev-1' });
    const req = buildReq({ method: 'POST', url: '/api/access-control/qrcode/resolve' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'POST',
      pathname: '/api/access-control/qrcode/resolve',
      deps: baseDeps,
    });

    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      execution_command: expect.objectContaining({
        vendor: 'control_id',
        deviceId: 'dev-1',
        action: 'ALLOW',
      }),
    }));
  });

  it('resolve decisão protegida já retorna comando canônico para device', async () => {
    baseDeps.parseJsonBody.mockResolvedValueOnce({ credential_value: 'qr-1', action: 'enter', device_id: 'dev-1' });
    const req = buildReq({ method: 'POST', url: '/api/access-control/decisions/resolve' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'POST',
      pathname: '/api/access-control/decisions/resolve',
      deps: baseDeps,
    });

    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      execution_command: expect.objectContaining({
        vendor: 'control_id',
        deviceId: 'dev-1',
        action: 'ALLOW',
      }),
    }));
  });

  it('consulta status reconciliado de uma decisão', async () => {
    const req = buildReq({ method: 'GET', url: '/api/access-control/decisions/dec-1/status' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'GET',
      pathname: '/api/access-control/decisions/dec-1/status',
      deps: baseDeps,
    });

    expect(getDecisionExecutionStatus).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      decisionId: 'dec-1',
    });
    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      execution_status: 'executed',
    }));
  });

  it('lista decisões pela rota protegida', async () => {
    const req = buildReq({ method: 'GET', url: '/api/access-control/decisions?limit=10&execution_status=executed&pending_critical_only=true' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'GET',
      pathname: '/api/access-control/decisions',
      deps: baseDeps,
    });

    expect(accessControlService.listDecisions).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      filters: {
        subject_id: null,
        device_id: null,
        decision: null,
        reason_code: null,
        limit: '10',
      },
    });
    expect(listDecisionExecutionStatuses).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      decisions: [{ id: 'dec-1', decision: 'allow', reason_code: 'allowed_active' }],
      executionStatus: 'executed',
      pendingCriticalOnly: true,
    });
    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 200, {
      items: [{
        id: 'dec-1',
        decision: 'allow',
        reason_code: 'allowed_active',
        execution_status: 'executed',
        pending_critical: false,
        pending_critical_threshold_ms: 180000,
        pending_critical_threshold_source: 'environment_default',
      }],
      summary: {
        total: 1,
        pending: 0,
        pending_critical: 0,
        executed: 1,
        failed: 0,
        expired: 0,
        unknown: 0,
      },
    });
  });

  it('retorna threshold reconciliado na listagem de decisões', async () => {
    const req = buildReq({ method: 'GET', url: '/api/access-control/decisions?include_status=true' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'GET',
      pathname: '/api/access-control/decisions',
      deps: baseDeps,
    });

    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 200, {
      items: [{
        id: 'dec-1',
        decision: 'allow',
        reason_code: 'allowed_active',
        execution_status: 'executed',
        pending_critical: false,
        pending_critical_threshold_ms: 180000,
        pending_critical_threshold_source: 'environment_default',
      }],
      summary: {
        total: 1,
        pending: 0,
        pending_critical: 0,
        executed: 1,
        failed: 0,
        expired: 0,
        unknown: 0,
      },
    });
  });

  it('bloqueia request sem autenticação', async () => {
    baseDeps.requireAuth.mockReturnValueOnce({ valid: false, error: 'token inválido' });
    const req = buildReq({ method: 'GET', url: '/api/access-control/events' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'GET',
      pathname: '/api/access-control/events',
      deps: baseDeps,
    });

    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 401, { error: 'unauthorized', message: 'token inválido' });
  });

  it('retorna snapshot de saúde do access-control', async () => {
    const req = buildReq({ method: 'GET', url: '/api/access-control/health?limit=20' });
    await handleAccessControlRoutes({
      req,
      res: {},
      method: 'GET',
      pathname: '/api/access-control/health',
      deps: baseDeps,
    });

    expect(getDecisionHealthSnapshot).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      limit: '20',
    });
    expect(baseDeps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      ok: true,
      threshold_ms: 180000,
      threshold_scope: 'policy_device_aware',
      has_incidents: false,
    }));
  });
});
