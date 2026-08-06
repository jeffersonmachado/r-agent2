/**
 * Testes de invalidação do cache de CompiledFlow nos caminhos de mutação
 * de flow (PUT, DELETE e PUT /environment).
 *
 * Bug corrigido: o PUT preserva `flow.version` e o cache chaveia por
 * tenant+id+version sem sobrescrever — sem invalidação explícita, a versão
 * antiga continuava executando até restart.
 */

jest.mock('../../engine/compiledFlowCache', () => ({
  invalidateCompiledFlow: jest.fn(),
}));

const { invalidateCompiledFlow } = require('../../engine/compiledFlowCache');
const { handleFlowCrudRoutes } = require('../../api/modules/domain-flow/handleFlowCrudRoutes');

function makeDeps(flows) {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requirePermission: jest.fn(),
    requireTenant: jest.fn(() => 'tenant-1'),
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    validateFlow: jest.fn(() => ({ valid: true, errors: [] })),
    validateVoiceFlow: jest.fn(() => ({ valid: true, errors: [] })),
    validateFlowStructure: jest.fn(() => ({ valid: true })),
    ensureFlowHasMeta: jest.fn((flow) => flow),
    flows,
    persistFlowBestEffort: jest.fn(),
    deleteFlowBestEffort: jest.fn(async () => {}),
    triggerWebhooks: jest.fn(() => Promise.resolve()),
    emitEvent: jest.fn(),
    isSuperAdmin: jest.fn(() => false),
    STRICT_TENANT_MODE: false,
  };
}

function makeExistingFlow() {
  return {
    id: 'flow-1',
    tenantId: 'tenant-1',
    name: 'Flow Um',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start', next: 'end-1' },
      { id: 'end-1', type: 'end', next: null },
    ],
  };
}

describe('handleFlowCrudRoutes - invalidação do cache compilado', () => {
  let flows;
  let deps;

  beforeEach(() => {
    // resetMocks:true — re-estabelecer implementações a cada teste
    flows = new Map([['flow-1', makeExistingFlow()]]);
    deps = makeDeps(flows);
  });

  test('PUT /flows/:id invalida o CompiledFlow cacheado do fluxo atualizado', async () => {
    deps.parseJsonBody.mockResolvedValue({
      name: 'Flow Um v2',
      nodes: [
        { id: 'start-1', type: 'start', next: 'end-1' },
        { id: 'end-1', type: 'end', next: null },
      ],
    });

    const handled = await handleFlowCrudRoutes({
      req: { agent: { role: 'admin' }, tenantId: 'tenant-1' },
      res: {},
      method: 'PUT',
      pathname: '/flows/flow-1',
      deps,
    });

    expect(handled).toBe(true);
    expect(invalidateCompiledFlow).toHaveBeenCalledTimes(1);
    expect(invalidateCompiledFlow).toHaveBeenCalledWith('tenant-1', 'flow-1');
    expect(deps.sendJson).toHaveBeenCalledWith(expect.anything(), 200, expect.anything());
  });

  test('DELETE /flows/:id invalida o CompiledFlow cacheado do fluxo removido', async () => {
    const handled = await handleFlowCrudRoutes({
      req: { agent: { role: 'admin' }, tenantId: 'tenant-1' },
      res: {},
      method: 'DELETE',
      pathname: '/flows/flow-1',
      deps,
    });

    expect(handled).toBe(true);
    expect(flows.has('flow-1')).toBe(false);
    expect(invalidateCompiledFlow).toHaveBeenCalledTimes(1);
    expect(invalidateCompiledFlow).toHaveBeenCalledWith('tenant-1', 'flow-1');
  });

  test('PUT /flows/:id/environment invalida o CompiledFlow cacheado', async () => {
    deps.parseJsonBody.mockResolvedValue({ environment: 'prod' });

    const handled = await handleFlowCrudRoutes({
      req: { agent: { role: 'admin' }, tenantId: 'tenant-1' },
      res: {},
      method: 'PUT',
      pathname: '/flows/flow-1/environment',
      deps,
    });

    expect(handled).toBe(true);
    expect(invalidateCompiledFlow).toHaveBeenCalledTimes(1);
    expect(invalidateCompiledFlow).toHaveBeenCalledWith('tenant-1', 'flow-1');
  });

  test('POST /flows (fluxo novo) não precisa invalidar cache', async () => {
    deps.parseJsonBody.mockResolvedValue({
      id: 'flow-novo',
      tenantId: 'tenant-1',
      name: 'Novo',
      version: 1,
      nodes: [
        { id: 'start-1', type: 'start', next: 'end-1' },
        { id: 'end-1', type: 'end', next: null },
      ],
    });

    const handled = await handleFlowCrudRoutes({
      req: { agent: { role: 'admin' }, tenantId: 'tenant-1' },
      res: {},
      method: 'POST',
      pathname: '/flows',
      deps,
    });

    expect(handled).toBe(true);
    expect(invalidateCompiledFlow).not.toHaveBeenCalled();
  });
});
