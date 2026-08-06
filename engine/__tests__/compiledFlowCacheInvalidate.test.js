/**
 * Testes de invalidação e eviction do compiledFlowCache.
 *
 * Cobre:
 * - invalidateCompiledFlow: update de flow preserva `version`, então a chave
 *   tenant+id+version não muda — a invalidação explícita é o que garante que
 *   a versão antiga não continue executando.
 * - Eviction FIFO quando o cache excede MAX_CACHE_ENTRIES.
 */

const {
  getCompiledFlowFromCache,
  getOrCompileFlow,
  invalidateCompiledFlow,
  clearCompiledFlowCache,
  MAX_CACHE_ENTRIES,
} = require('../compiledFlowCache');

function makeFlow(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    id: 'flow-A',
    name: 'Flow A',
    version: 1,
    nodes: [
      { id: 'start-1', type: 'start', next: 'end-1' },
      { id: 'end-1', type: 'end', next: null },
    ],
    ...overrides,
  };
}

describe('compiledFlowCache - invalidateCompiledFlow', () => {
  beforeEach(() => {
    clearCompiledFlowCache();
  });

  test('remove todas as versões cacheadas do fluxo (mesmo tenant+id)', () => {
    getOrCompileFlow(makeFlow({ version: 1 }));
    getOrCompileFlow(makeFlow({ version: 2 }));
    getOrCompileFlow(makeFlow({ id: 'flow-B', version: 1 }));
    getOrCompileFlow(makeFlow({ tenantId: 'tenant-2', version: 1 }));

    invalidateCompiledFlow('tenant-1', 'flow-A');

    expect(getCompiledFlowFromCache('tenant-1', 'flow-A', 1)).toBeNull();
    expect(getCompiledFlowFromCache('tenant-1', 'flow-A', 2)).toBeNull();
    // Não afeta outros fluxos nem outros tenants
    expect(getCompiledFlowFromCache('tenant-1', 'flow-B', 1)).not.toBeNull();
    expect(getCompiledFlowFromCache('tenant-2', 'flow-A', 1)).not.toBeNull();
  });

  test('update preservando version: após invalidar, recompila com o novo conteúdo', () => {
    const flowV1 = makeFlow();
    const compiled1 = getOrCompileFlow(flowV1);

    // Simula PUT que preserva version mas muda o conteúdo
    const flowV1Updated = makeFlow({
      nodes: [
        { id: 'start-1', type: 'start', next: 'end-1' },
        { id: 'end-1', type: 'end', next: null },
        { id: 'msg-1', type: 'message', next: null },
      ],
    });

    // Sem invalidação, o cache devolveria o CompiledFlow antigo (o bug)
    const cachedBefore = getOrCompileFlow(flowV1Updated);
    expect(cachedBefore).toBe(compiled1);

    invalidateCompiledFlow(flowV1Updated.tenantId, flowV1Updated.id);

    const compiled2 = getOrCompileFlow(flowV1Updated);
    expect(compiled2).not.toBe(compiled1);
    expect(compiled2.versionHash).not.toBe(compiled1.versionHash);
    expect(compiled2.nodes).toHaveLength(3);
  });

  test('eviction FIFO: ao exceder MAX_CACHE_ENTRIES, remove a entrada mais antiga', () => {
    for (let i = 0; i < MAX_CACHE_ENTRIES; i += 1) {
      getOrCompileFlow(makeFlow({ id: `flow-${i}` }));
    }
    expect(getCompiledFlowFromCache('tenant-1', 'flow-0', 1)).not.toBeNull();

    // Uma entrada a mais deve expulsar a mais antiga (flow-0)
    getOrCompileFlow(makeFlow({ id: 'flow-overflow' }));

    expect(getCompiledFlowFromCache('tenant-1', 'flow-0', 1)).toBeNull();
    expect(getCompiledFlowFromCache('tenant-1', 'flow-1', 1)).not.toBeNull();
    expect(getCompiledFlowFromCache('tenant-1', 'flow-overflow', 1)).not.toBeNull();
  });
});
