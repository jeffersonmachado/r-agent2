'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const {
  engineFlowToCanonicalProcess,
  compileCanonicalProcessDefinition,
} = require('../../api/core/process-runtime/processCanonicalAdapter');

describe('process canonical adapter', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('engineFlowToCanonicalProcess tolera flow hostil com nodes revogados', withTimeout(async () => {
    const { proxy: hostileNodes, revoke } = Proxy.revocable([
      { id: 'start-1', type: 'start', config: {}, next: 'end-1' },
      { id: 'end-1', type: 'end', config: {}, next: null },
    ], {});
    revoke();

    const canonical = engineFlowToCanonicalProcess({
      id: 'flow-hostile-1',
      name: 'Hostile Flow',
      version: 1,
      tenantId: 'tenant-1',
      kind: 'chat',
      nodes: hostileNodes,
    });

    expect(canonical.id).toBe('flow-hostile-1');
    expect(canonical.nodes).toEqual([]);
    expect(canonical.edges).toEqual([]);
    expect(canonical.entrypoints).toEqual([]);
  }, 5000));

  test('engineFlowToCanonicalProcess ignora next hostil e preserva nós válidos', withTimeout(async () => {
    const { proxy: hostileNext, revoke } = Proxy.revocable({ out: 'end-1' }, {});
    revoke();

    const canonical = engineFlowToCanonicalProcess({
      id: 'flow-hostile-2',
      name: 'Hostile Next',
      version: 1,
      tenantId: 'tenant-1',
      kind: 'chat',
      nodes: [
        { id: 'start-1', type: 'start', config: {}, next: hostileNext },
        { id: 'end-1', type: 'end', config: {}, next: null },
      ],
    });

    expect(canonical.nodes).toHaveLength(2);
    expect(canonical.edges).toEqual([]);
    expect(canonical.entrypoints).toEqual(['start-1']);
  }, 5000));

  test('compileCanonicalProcessDefinition tolera nodes/edges hostis e aplica fallback', withTimeout(async () => {
    const { proxy: hostileNodes, revoke: revokeNodes } = Proxy.revocable([{ id: 'start-1', type: 'start' }], {});
    revokeNodes();
    const { proxy: hostileEdges, revoke: revokeEdges } = Proxy.revocable([{ source: 'start-1', target: 'end-1' }], {});
    revokeEdges();

    const compiled = compileCanonicalProcessDefinition({
      id: 'proc-hostile',
      name: 'Proc Hostile',
      version: 2,
      nodes: hostileNodes,
      edges: hostileEdges,
      entrypoints: hostileNodes,
    });

    expect(compiled.id).toBe('proc-hostile');
    expect(compiled.version).toBe(2);
    expect(compiled.nodes).toEqual([]);
    expect(compiled.edges).toEqual([]);
    expect(compiled.entrypoints).toEqual([]);
    expect(compiled.executionGraph.startNode).toBeNull();
  }, 5000));

  test('compileCanonicalProcessDefinition mantém caminho nominal', withTimeout(async () => {
    const compiled = compileCanonicalProcessDefinition({
      id: 'proc-ok',
      name: 'Proc Ok',
      version: 1,
      entrypoints: ['start-1'],
      nodes: [
        { id: 'start-1', type: 'start' },
        { id: 'end-1', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
      policies: { timeout: { enabled: true } },
      aiConfig: { provider: 'mock' },
      operationalConfig: { retries: 1 },
    });

    expect(compiled.id).toBe('proc-ok');
    expect(compiled.name).toBe('Proc Ok');
    expect(compiled.executionGraph.startNode).toBe('start-1');
    expect(Object.keys(compiled.executionGraph.nodesById)).toEqual(['start-1', 'end-1']);
    expect(compiled.executionGraph.edgesBySource['start-1']).toHaveLength(1);
    expect(compiled.policies).toEqual({ timeout: { enabled: true } });
  }, 5000));
});
