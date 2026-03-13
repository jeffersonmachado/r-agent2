'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessRuntimeService } = require('../../api/core/process-runtime/processRuntimeService');
const { compileCanonicalProcessDefinition } = require('../../api/core/process-runtime/processCanonicalAdapter');
const { ProcessExecutionContext } = require('../../api/core/process-runtime/processExecutionContext');

function buildCompiledProcess(definition) {
  return compileCanonicalProcessDefinition({
    id: 'proc-durable',
    name: 'Process Durable',
    version: 1,
    metadata: { tenantId: 'tenant-1' },
    entrypoints: ['start-1'],
    policies: {},
    aiConfig: {},
    operationalConfig: {},
    ...definition,
  });
}

describe('Process durable runtime', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('persist start -> end', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService();
    const result = await runtime.startProcess(compiled, { executionId: 'exec-durable-1' });
    const instance = await runtime.instanceStore.loadInstance('exec-durable-1');

    expect(result.status).toBe('completed');
    expect(instance.status).toBe('completed');
    expect(instance.lastEventSequence).toBeGreaterThan(0);
  }, 5000));

  test('persist failure', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'service-1', type: 'task.service', label: 'Service', config: {}, metadata: {} },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'service-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService({
      serviceExecutor: async () => {
        throw new Error('boom');
      },
    });

    const result = await runtime.startProcess(compiled, { executionId: 'exec-durable-fail' });
    const instance = await runtime.instanceStore.loadInstance('exec-durable-fail');

    expect(result.ok).toBe(false);
    expect(instance.status).toBe('failed');
    expect(instance.metadata.error.message).toBe('boom');
  }, 5000));

  test('message receive entra em waiting e retoma por correlação', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'receive-1', type: 'task.message.receive', label: 'Receive', config: { variable: 'answer' }, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'receive-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'receive-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });
    const runtime = new ProcessRuntimeService();
    const started = await runtime.startProcess(compiled, { executionId: 'exec-durable-msg', metadata: { correlationKey: 'corr-msg' } });
    const waiting = await runtime.instanceStore.loadInstance('exec-durable-msg');
    const resumed = await runtime.resumeService.resumeByCorrelationKey('corr-msg', { text: 'hello' });

    expect(started.status).toBe('waiting');
    expect(waiting.waitingState.type).toBe('message');
    expect(resumed.status).toBe('completed');
    expect(resumed.context.variables.answer).toBe('hello');
  }, 5000));

  test('human task entra em waiting e retoma', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'human-1', type: 'task.user', label: 'Human', config: { queue: 'support' }, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'human-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'human-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });
    const runtime = new ProcessRuntimeService();
    const started = await runtime.startProcess(compiled, { executionId: 'exec-durable-human' });
    const resumed = await runtime.resumeService.resumeHumanTask('exec-durable-human', { approved: true });

    expect(started.status).toBe('waiting');
    expect(started.instance.waitingState.type).toBe('human');
    expect(resumed.status).toBe('completed');
  }, 5000));

  test('replay e restart simulado reconstroem contexto', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'receive-1', type: 'task.message.receive', label: 'Receive', config: { variable: 'name' }, metadata: {} },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'receive-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService();
    await runtime.startProcess(compiled, { executionId: 'exec-durable-rebuild' });
    const instance = await runtime.instanceStore.loadInstance('exec-durable-rebuild');
    const events = await runtime.executionRepository.listEventsByExecution('exec-durable-rebuild');
    const replayed = runtime.replayService.rebuildContextFromEvents(compiled, events);
    const fromInstance = ProcessExecutionContext.fromSnapshot(runtime.replayService.rebuildContextFromInstance(instance).toSnapshot());

    expect(replayed.status).toBe('waiting');
    expect(fromInstance.status).toBe('waiting');
    expect(replayed.currentNodeId).toBe('receive-1');
  }, 5000));

  test('restart simulado com novo runtime reidrata processo compilado e retoma por correlationKey', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'receive-1', type: 'task.message.receive', label: 'Receive', config: { variable: 'answer' }, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'receive-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'receive-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });
    const runtimeA = new ProcessRuntimeService();
    await runtimeA.startProcess(compiled, {
      executionId: 'exec-durable-restart',
      metadata: { correlationKey: 'corr-restart' },
    });

    const runtimeB = new ProcessRuntimeService({
      instanceStore: runtimeA.instanceStore,
      executionRepository: runtimeA.executionRepository,
      compiledProcessResolver: async ({ processId, processVersion }) => {
        if (processId === compiled.id && Number(processVersion) === Number(compiled.version)) {
          return compiled;
        }
        return null;
      },
    });
    const resumed = await runtimeB.resumeService.resumeByCorrelationKey('corr-restart', { text: 'resume ok' });

    expect(resumed.status).toBe('completed');
    expect(resumed.context.variables.answer).toBe('resume ok');
    expect(resumed.context.recovery).toMatchObject({ from: 'event-log', executionId: 'exec-durable-restart' });
  }, 5000));

  test('restart simulado recupera timer pendente e conclui execução', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'timer-1', type: 'wait.timer', label: 'Timer', config: { durationMs: 20 }, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'timer-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'timer-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });

    const runtimeA = new ProcessRuntimeService({ useDatabasePersistence: false });
    const started = await runtimeA.startProcess(compiled, { executionId: 'exec-durable-timer-restart' });
    expect(started.status).toBe('waiting');

    const runtimeB = new ProcessRuntimeService({
      useDatabasePersistence: false,
      instanceStore: runtimeA.instanceStore,
      executionRepository: runtimeA.executionRepository,
      compiledProcessResolver: async () => compiled,
    });
    await runtimeB.recoverRuntimeState();
    await new Promise((resolve) => setTimeout(resolve, 40));

    const result = await runtimeB.loadContextForExecution('exec-durable-timer-restart');
    expect(result.context.status).toBe('completed');
  }, 5000));

  test('proteção básica contra reexecução duplicada de side effect', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'service-1', type: 'task.service', label: 'Service', config: { outputVariable: 'service' }, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'service-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'service-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });
    const serviceExecutor = jest.fn(async (node, context) => {
      context.setVariable('service', 'ok');
      return {
        nextState: context.toSnapshot(),
        events: [],
        output: { type: 'service', variable: node.config.outputVariable, data: 'ok' },
      };
    });
    const runtime = new ProcessRuntimeService({ serviceExecutor });
    const started = await runtime.startProcess(compiled, { executionId: 'exec-idempotent' });
    const loaded = await runtime.loadContextForExecution('exec-idempotent');
    const events = await runtime.executionRepository.listEventsByExecution('exec-idempotent');
    const serviceEnter = events.find((event) => event.eventType === 'NODE_ENTER' && event.nodeId === 'service-1');
    const node = compiled.executionGraph.nodesById['service-1'];
    loaded.context.lastProcessedSequence = serviceEnter.sequence;
    const result = await runtime.executeNodeWithIdempotency(node, loaded.context, compiled, null);

    expect(started.status).toBe('completed');
    expect(serviceExecutor).toHaveBeenCalledTimes(1);
    expect(result.output.data).toBe('ok');
    expect(result.nextNodeId).toBe('end-1');
    expect(result.completed).toBe(false);
  }, 5000));

  test('idempotência persiste após restart lógico usando executionId + nodeId + sequence', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'service-1', type: 'task.service', label: 'Service', config: { outputVariable: 'service' }, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'service-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'service-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });
    const serviceExecutor = jest.fn(async (node, context) => {
      context.setVariable('service', 'ok');
      return {
        nextState: context.toSnapshot(),
        events: [],
        output: { type: 'service', variable: node.config.outputVariable, data: 'ok' },
      };
    });

    const runtimeA = new ProcessRuntimeService({ serviceExecutor });
    await runtimeA.startProcess(compiled, { executionId: 'exec-idempotent-restart' });

    const events = await runtimeA.executionRepository.listEventsByExecution('exec-idempotent-restart');
    const serviceEnter = events.find((event) => event.eventType === 'NODE_ENTER' && event.nodeId === 'service-1');

    const runtimeB = new ProcessRuntimeService({
      serviceExecutor,
      instanceStore: runtimeA.instanceStore,
      executionRepository: runtimeA.executionRepository,
      compiledProcessResolver: async () => compiled,
    });
    const loaded = await runtimeB.loadContextForExecution('exec-idempotent-restart');
    loaded.context.lastProcessedSequence = serviceEnter.sequence;

    const node = compiled.executionGraph.nodesById['service-1'];
    const result = await runtimeB.executeNodeWithIdempotency(node, loaded.context, compiled, null);
    const continued = await runtimeB.executeNextNode('exec-idempotent-restart');

    expect(serviceExecutor).toHaveBeenCalledTimes(1);
    expect(result.output.data).toBe('ok');
    expect(result.completed).toBe(false);
    expect(result.nextNodeId).toBe('end-1');
    expect(continued.status).toBe('completed');
  }, 5000));

  test('cancelamento explícito persiste estado cancelled', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'receive-1', type: 'task.message.receive', label: 'Receive', config: { variable: 'answer' }, metadata: {} },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'receive-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService({ useDatabasePersistence: false });
    await runtime.startProcess(compiled, { executionId: 'exec-cancel-1' });

    const cancelled = await runtime.cancelProcess('exec-cancel-1', 'manual_cancel');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.instance.status).toBe('cancelled');
    expect(cancelled.events.map((event) => event.eventType)).toContain('PROCESS_CANCELLED');
  }, 5000));

  test('timeout policy por nó registra NODE_TIMEOUT e falha execução', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        {
          id: 'service-1',
          type: 'task.service',
          label: 'Service',
          config: {},
          timeoutPolicy: { enabled: true, timeoutMs: 10 },
          metadata: {},
        },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'service-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService({
      useDatabasePersistence: false,
      serviceExecutor: async () => new Promise((resolve) => setTimeout(() => resolve({
        nextState: {},
        events: [],
        output: { type: 'service' },
      }), 30)),
    });

    const result = await runtime.startProcess(compiled, { executionId: 'exec-timeout-1' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.events.map((event) => event.eventType)).toContain('NODE_TIMEOUT');
  }, 5000));

  test('resume valida payload contra inputSchema do nó em waiting', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        {
          id: 'receive-1',
          type: 'task.message.receive',
          label: 'Receive',
          config: { variable: 'answer' },
          inputSchema: {
            type: 'object',
            required: ['text'],
            properties: {
              text: { type: 'string', minLength: 1 },
            },
          },
          metadata: {},
        },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'receive-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService({ useDatabasePersistence: false });
    await runtime.startProcess(compiled, { executionId: 'exec-schema-1', metadata: { correlationKey: 'corr-schema-1' } });

    await expect(runtime.resumeService.resumeByCorrelationKey('corr-schema-1', { nope: true }))
      .rejects
      .toThrow('resume_payload_invalid');
  }, 5000));

  test('subprocess assíncrono real cria filho e retoma pai ao concluir', withTimeout(async () => {
    const parent = buildCompiledProcess({
      id: 'parent-proc',
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'sub-1', type: 'call.subprocess', label: 'Sub', config: { calledElement: 'child-proc', async: true }, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [
        { id: 'e1', source: 'start-1', target: 'sub-1', priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'e2', source: 'sub-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });
    const child = buildCompiledProcess({
      id: 'child-proc',
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService({
      useDatabasePersistence: false,
      compiledProcessResolver: async ({ processId }) => {
        if (processId === 'child-proc') return child;
        return null;
      },
    });

    const started = await runtime.startProcess(parent, { executionId: 'exec-parent-1' });
    expect(started.status).toBe('waiting');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const final = await runtime.buildResult(
      'exec-parent-1',
      parent,
      await runtime.loadContextForExecution('exec-parent-1').then((loaded) => loaded.context),
      null,
    );
    expect(final.status).toBe('completed');
  }, 5000));

  test('nao duplica eventos persistidos com emissao transiente do state machine', withTimeout(async () => {
    const compiled = buildCompiledProcess({
      nodes: [
        { id: 'start-1', type: 'start', label: 'Start', config: {}, metadata: {} },
        { id: 'end-1', type: 'end', label: 'End', config: {}, metadata: {} },
      ],
      edges: [{ id: 'e1', source: 'start-1', target: 'end-1', priority: 0, metadata: { sourcePort: 'out' } }],
    });
    const runtime = new ProcessRuntimeService();
    const result = await runtime.startProcess(compiled, { executionId: 'exec-no-dup-events' });
    const persistedNodeEnter = result.events.filter((event) => event.eventType === 'NODE_ENTER');
    const persistedNodeExit = result.events.filter((event) => event.eventType === 'NODE_EXIT');

    expect(result.status).toBe('completed');
    expect(persistedNodeEnter).toHaveLength(2);
    expect(persistedNodeExit).toHaveLength(2);
  }, 5000));

  test('EngineFlow continua funcionando via adapter híbrido', withTimeout(async () => {
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
    const result = await runtime.startProcess(engineFlow, { executionId: 'exec-engine-hybrid' });
    expect(result.status).toBe('completed');
  }, 5000));
});
