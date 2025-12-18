const {
  getCompiledFlowFromCache,
  putCompiledFlowInCache,
  getOrCompileFlow,
  clearCompiledFlowCache,
} = require('../compiledFlowCache');

describe('compiledFlowCache', () => {
  beforeEach(() => {
    clearCompiledFlowCache();
  });

  const baseFlow = {
    tenantId: 'tenant-1',
    id: 'flow-A',
    name: 'Fluxo A',
    version: 1,
    nodes: [{ id: 'start', type: 'start', next: null }],
    metadata: {},
  };

  test('getOrCompileFlow compila e coloca no cache na primeira chamada', () => {
    const compiled = getOrCompileFlow(baseFlow);
    expect(compiled).toBeDefined();

    const fromCache = getCompiledFlowFromCache('tenant-1', 'flow-A', 1);
    expect(fromCache).toBe(compiled); // mesma referência
  });

  test('getOrCompileFlow reutiliza o mesmo CompiledFlow para chamadas subsequentes', () => {
    const compiled1 = getOrCompileFlow(baseFlow);
    const compiled2 = getOrCompileFlow(baseFlow);

    expect(compiled2).toBe(compiled1);
  });

  test('putCompiledFlowInCache não sobrescreve uma versão já existente', () => {
    const compiled1 = getOrCompileFlow(baseFlow);

    // Simulamos outro objeto com mesmos campos para garantir que
    // o cache não será sobrescrito.
    const compiled2 = { ...compiled1 };
    putCompiledFlowInCache(compiled2);

    const fromCache = getCompiledFlowFromCache('tenant-1', 'flow-A', 1);
    expect(fromCache).toBe(compiled1);
  });

  test('versão diferente gera entrada separada (suporte a rollback)', () => {
    const v1Flow = { ...baseFlow, version: 1 };
    const v2Flow = { ...baseFlow, version: 2 };

    const compiledV1 = getOrCompileFlow(v1Flow);
    const compiledV2 = getOrCompileFlow(v2Flow);

    expect(compiledV1).not.toBe(compiledV2);

    const fromCacheV1 = getCompiledFlowFromCache('tenant-1', 'flow-A', 1);
    const fromCacheV2 = getCompiledFlowFromCache('tenant-1', 'flow-A', 2);

    expect(fromCacheV1).toBe(compiledV1);
    expect(fromCacheV2).toBe(compiledV2);
  });
});


