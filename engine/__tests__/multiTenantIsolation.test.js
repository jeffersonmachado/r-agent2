const { executeStep } = require('../executeStep');
const { NodeRegistry } = require('../nodeRegistry');
const { messageNodeHandler, endNodeHandler } = require('../nodes/basicNodes');
const {
  getCompiledFlowFromCache,
  getOrCompileFlow,
  clearCompiledFlowCache,
} = require('../compiledFlowCache');

describe('Multi-tenant isolation and versioning', () => {
  const baseFlow = {
    tenantId: 'tenant-A',
    id: 'flow-1',
    name: 'Fluxo multi-tenant',
    version: 1,
    nodes: [
      { id: 'start', type: 'message', config: { text: 'Olá' }, next: 'end' },
      { id: 'end', type: 'end' },
    ],
    metadata: {},
  };

  function createRegistry() {
    const registry = new NodeRegistry();
    registry.register('message', messageNodeHandler);
    registry.register('end', endNodeHandler);
    return registry;
  }

  beforeEach(() => {
    clearCompiledFlowCache();
  });

  test('acessos cruzados entre tenants são bloqueados em executeStep', async () => {
    const compiled = getOrCompileFlow(baseFlow);
    const registry = createRegistry();

    const stateOfOtherTenant = {
      tenantId: 'tenant-B', // diferente do compiled.tenantId
      sessionId: 's-cross',
      flowId: baseFlow.id,
      flowVersion: compiled.version,
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    await expect(
      executeStep(stateOfOtherTenant, compiled, { registry }),
    ).rejects.toThrow(/tentativa de executar fluxo de tenant/);
  });

  test('cache de CompiledFlow é separado por tenant + versão', () => {
    const flowTenantA_v1 = { ...baseFlow };
    const flowTenantB_v1 = { ...baseFlow, tenantId: 'tenant-B' };
    const flowTenantA_v2 = { ...baseFlow, version: 2 };

    const compiledA1 = getOrCompileFlow(flowTenantA_v1);
    const compiledB1 = getOrCompileFlow(flowTenantB_v1);
    const compiledA2 = getOrCompileFlow(flowTenantA_v2);

    // Mesmo id/versão, mas tenants diferentes -> CompiledFlow distintos
    expect(compiledA1).not.toBe(compiledB1);
    // Mesma tenant/id mas versão diferente -> CompiledFlow distinto
    expect(compiledA1).not.toBe(compiledA2);

    const fromCacheA1 = getCompiledFlowFromCache('tenant-A', 'flow-1', 1);
    const fromCacheB1 = getCompiledFlowFromCache('tenant-B', 'flow-1', 1);
    const fromCacheA2 = getCompiledFlowFromCache('tenant-A', 'flow-1', 2);

    expect(fromCacheA1).toBe(compiledA1);
    expect(fromCacheB1).toBe(compiledB1);
    expect(fromCacheA2).toBe(compiledA2);
  });

  test('sessões ficam presas à versão correta do fluxo', async () => {
    const flow_v1 = { ...baseFlow, version: 1 };
    const flow_v2 = { ...baseFlow, version: 2 };

    const compiled_v1 = getOrCompileFlow(flow_v1);
    const compiled_v2 = getOrCompileFlow(flow_v2);

    const registry = createRegistry();

    const stateForV1 = {
      tenantId: baseFlow.tenantId,
      sessionId: 's-version-1',
      flowId: baseFlow.id,
      flowVersion: 1, // sessão criada para v1
      currentNodeId: 'start',
      variables: {},
      history: [],
      metadata: {},
    };

    // Execução com a versão correta (v1) deve funcionar
    const resOk = await executeStep(stateForV1, compiled_v1, { registry });
    expect(resOk.state.currentNodeId).toBe('end');

    // Tentativa de executar com versão diferente (v2) deve falhar
    await expect(
      executeStep(stateForV1, compiled_v2, { registry }),
    ).rejects.toThrow(/tentativa de executar versão .* em sessão criada para a versão/);
  });
});


