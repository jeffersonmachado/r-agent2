'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessRuntimeService } = require('../../api/core/process-runtime/processRuntimeService');
const { compileCanonicalProcessDefinition } = require('../../api/core/process-runtime/processCanonicalAdapter');

function buildCompiledProcess(definition) {
  return compileCanonicalProcessDefinition({
    id: 'proc-runtime',
    name: 'Process Runtime',
    version: 1,
    metadata: { tenantId: 'tenant-1' },
    entrypoints: ['start-1'],
    policies: {},
    aiConfig: {},
    operationalConfig: {},
    ...definition,
  });
}

describe('ProcessRuntimeService', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('executa start -> task.service -> end em fluxo compilado', withTimeout(async () => {
    const compiledProcess = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', subtype: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'service-1', type: 'task.service', subtype: null, label: 'Service', config: { outputVariable: 'ticket', mockResult: { ok: true } }, metadata: {} },
        { id: 'end-1', type: 'end', subtype: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'service-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'service-1', target: 'end-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });

    const runtime = new ProcessRuntimeService();
    const result = await runtime.startProcess(compiledProcess, {
      executionId: 'exec-runtime-1',
      tenantId: 'tenant-1',
      metadata: { channel: 'test' },
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.context.variables.ticket).toEqual({ ok: true });
    expect(result.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['PROCESS_STARTED', 'NODE_ENTER', 'NODE_EXIT', 'PROCESS_COMPLETED']),
    );
    expect(result.observability.some((record) => record.eventType === 'NODE_EXIT')).toBe(true);
  }, 5000));

  test('retoma automaticamente wait.timer quando o timer dispara', withTimeout(async () => {
    const compiledProcess = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', subtype: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'timer-1', type: 'wait.timer', subtype: null, label: 'Timer', config: { durationMs: 10 }, metadata: {} },
        { id: 'end-1', type: 'end', subtype: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'timer-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'timer-1', target: 'end-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });

    const runtime = new ProcessRuntimeService();
    const startResult = await runtime.startProcess(compiledProcess, {
      executionId: 'exec-runtime-timer',
      tenantId: 'tenant-1',
    });

    expect(startResult.status).toBe('waiting');

    await new Promise((resolve) => setTimeout(resolve, 30));
    const instance = await runtime.instanceStore.loadInstance('exec-runtime-timer');
    const resumed = instance.status === 'completed'
      ? await runtime.buildResult('exec-runtime-timer', compiledProcess, await runtime.loadContextForExecution('exec-runtime-timer').then((loaded) => loaded.context), { type: 'end' })
      : await runtime.resumeProcess('exec-runtime-timer');

    expect(resumed.status).toBe('completed');
    expect(resumed.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['PROCESS_TIMEOUT', 'PROCESS_COMPLETED']),
    );
  }, 5000));

  test('aceita EngineFlow via adapter híbrido', withTimeout(async () => {
    const runtime = new ProcessRuntimeService();
    const engineFlow = {
      tenantId: 'tenant-1',
      id: 'flow-engine-1',
      name: 'Engine Flow',
      version: 1,
      nodes: [
        { id: 'start-1', type: 'start', config: {}, next: 'message-1' },
        { id: 'message-1', type: 'message', config: { text: 'Ola runtime' }, next: 'end-1' },
        { id: 'end-1', type: 'end', config: {}, next: null },
      ],
      metadata: {},
    };

    const result = await runtime.startProcess(engineFlow, {
      executionId: 'exec-runtime-engine',
      tenantId: 'tenant-1',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('completed');
  }, 5000));

  test('resolveCompiledProcessForInstance tolera instancia revogada sem lançar', withTimeout(async () => {
    const runtime = new ProcessRuntimeService();
    const { proxy: hostileInstance, revoke } = Proxy.revocable({
      processId: 'proc-hostile',
      processVersion: 1,
      metadata: { tenantId: 'tenant-1' },
    }, {});
    revoke();

    const resolved = await runtime.resolveCompiledProcessForInstance(hostileInstance);
    expect(resolved).toBeNull();
  }, 5000));

  test('resolveCompiledProcessForInstance faz fallback para resolver quando repositorio falha', withTimeout(async () => {
    const compiledFromResolver = buildCompiledProcess({
      id: 'proc-resolver',
      version: 3,
      metadata: { tenantId: 'tenant-2' },
      entrypoints: ['start-1'],
      nodes: [
        { id: 'start-1', type: 'start', subtype: 'start', label: 'Start', config: {}, metadata: {} },
      ],
      edges: [],
    });

    const runtime = new ProcessRuntimeService({
      compiledProcessRepository: {
        loadCompiledProcess: jest.fn(async () => {
          throw new Error('repository unavailable');
        }),
      },
      compiledProcessResolver: jest.fn(async () => compiledFromResolver),
    });

    const instance = {
      executionId: 'exec-resolver-1',
      processId: 'proc-resolver',
      processVersion: 3,
      metadata: { tenantId: 'tenant-2' },
    };

    const first = await runtime.resolveCompiledProcessForInstance(instance);
    const second = await runtime.resolveCompiledProcessForInstance(instance);

    expect(first && first.id).toBe('proc-resolver');
    expect(second && second.id).toBe('proc-resolver');
    expect(runtime.compiledProcessResolver).toHaveBeenCalledTimes(1);
  }, 5000));
});
