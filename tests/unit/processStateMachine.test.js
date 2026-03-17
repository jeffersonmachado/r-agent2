'use strict';

const { withTimeout, cleanupAfterTest } = require('../utils/testHelpers');
const { ProcessStateMachine } = require('../../api/core/process-runtime/processStateMachine');
const { ProcessExecutionContext } = require('../../api/core/process-runtime/processExecutionContext');
const { compileCanonicalProcessDefinition } = require('../../api/core/process-runtime/processCanonicalAdapter');

function buildCompiledProcess(definition) {
  return compileCanonicalProcessDefinition({
    id: 'proc-state-machine',
    name: 'Process State Machine',
    version: 1,
    metadata: { tenantId: 'tenant-1' },
    entrypoints: ['start-1'],
    policies: {},
    aiConfig: {},
    operationalConfig: {},
    ...definition,
  });
}

describe('ProcessStateMachine', () => {
  afterEach(() => {
    cleanupAfterTest();
  });

  test('resolve gateway.exclusive generico por condicao', withTimeout(async () => {
    const compiledProcess = buildCompiledProcess({
      nodes: [
        { id: 'gateway-1', type: 'gateway.exclusive', subtype: null, label: 'Gateway', config: {}, metadata: {} },
      ],
      edges: [
        {
          id: 'edge-vip',
          source: 'gateway-1',
          target: 'vip-task',
          condition: { variable: 'tier', operator: 'equals', value: 'vip' },
          priority: 0,
          metadata: { sourcePort: 'vip' },
        },
        {
          id: 'edge-default',
          source: 'gateway-1',
          target: 'default-task',
          condition: null,
          priority: 1,
          metadata: { sourcePort: 'default' },
        },
      ],
    });

    const context = new ProcessExecutionContext({
      processId: compiledProcess.id,
      executionId: 'exec-gateway',
      currentNodeId: 'gateway-1',
      variables: { tier: 'vip' },
    });

    const machine = new ProcessStateMachine();
    const node = compiledProcess.executionGraph.nodesById['gateway-1'];
    const result = await machine.executeNode(node, context, compiledProcess, {});

    expect(result.output).toMatchObject({
      type: 'router',
      chosenNext: 'vip-task',
    });
    expect(result.nextNodeId).toBe('vip-task');
    expect(context.currentNodeId).toBe('vip-task');
  }, 5000));

  test('executa task.service e call.subprocess por executores injetados', withTimeout(async () => {
    const compiledProcess = buildCompiledProcess({
      nodes: [
        { id: 'service-1', type: 'task.service', subtype: null, label: 'Service', config: { outputVariable: 'ticket' }, metadata: {} },
        { id: 'subprocess-1', type: 'call.subprocess', subtype: null, label: 'Subprocess', config: { calledElement: 'child-proc' }, metadata: {} },
      ],
      edges: [
        { id: 'edge-1', source: 'service-1', target: 'subprocess-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
        { id: 'edge-2', source: 'subprocess-1', target: 'end-1', condition: null, priority: 0, metadata: { sourcePort: 'out' } },
      ],
    });

    const outputs = [];
    const machine = new ProcessStateMachine({
      serviceExecutor: async (node, context) => {
        context.setVariable(node.config.outputVariable, { ok: true, ticketId: 'T-1' });
        return {
          nextState: {
            sessionId: context.executionId,
            flowId: context.processId,
            currentNodeId: context.currentNodeId,
            variables: { ...context.variables },
            history: context.history.slice(),
            metadata: { ...context.metadata },
          },
          events: [],
          output: { type: 'service', variable: node.config.outputVariable },
        };
      },
      subprocessExecutor: async (node) => {
        outputs.push(node.config.calledElement);
        return {
          nextState: {
            sessionId: 'exec-sub',
            flowId: 'proc-state-machine',
            currentNodeId: 'subprocess-1',
            variables: {},
            history: [],
            metadata: {},
          },
          events: [],
          output: { type: 'subprocess', calledElement: node.config.calledElement },
        };
      },
    });

    const serviceContext = new ProcessExecutionContext({
      processId: compiledProcess.id,
      executionId: 'exec-service',
      currentNodeId: 'service-1',
      variables: {},
    });
    const serviceNode = compiledProcess.executionGraph.nodesById['service-1'];
    const serviceResult = await machine.executeNode(serviceNode, serviceContext, compiledProcess, {});

    expect(serviceContext.variables.ticket).toEqual({ ok: true, ticketId: 'T-1' });
    expect(serviceResult.nextNodeId).toBe('subprocess-1');

    const subprocessContext = new ProcessExecutionContext({
      processId: compiledProcess.id,
      executionId: 'exec-subprocess',
      currentNodeId: 'subprocess-1',
      variables: {},
    });
    const subprocessNode = compiledProcess.executionGraph.nodesById['subprocess-1'];
    const subprocessResult = await machine.executeNode(subprocessNode, subprocessContext, compiledProcess, {});

    expect(outputs).toEqual(['child-proc']);
    expect(subprocessResult.output).toMatchObject({
      type: 'subprocess',
      calledElement: 'child-proc',
    });
  }, 5000));

  test('message receive com payload revogado entra em waiting sem quebrar', withTimeout(async () => {
    const compiledProcess = buildCompiledProcess({
      nodes: [
        { id: 'receive-1', type: 'task.message.receive', subtype: null, label: 'Receive', config: { variable: 'answer' }, metadata: {} },
      ],
      edges: [],
    });

    const context = new ProcessExecutionContext({
      processId: compiledProcess.id,
      executionId: 'exec-hostile-receive',
      currentNodeId: 'receive-1',
      variables: {},
    });
    const machine = new ProcessStateMachine();
    const node = compiledProcess.executionGraph.nodesById['receive-1'];
    const { proxy: hostileInput, revoke } = Proxy.revocable({ text: 'hello' }, {});
    revoke();

    const result = await machine.executeNode(node, context, compiledProcess, hostileInput);

    expect(result.waiting).toBe(true);
    expect(result.output).toMatchObject({ type: 'message_receive', waitForInput: true });
    expect(context.status).toBe('waiting_input');
  }, 5000));

  test('gateway com condition hostil cai no caminho default sem quebrar', withTimeout(async () => {
    const hostileCondition = new Proxy({}, {
      ownKeys() {
        throw new Error('condition_own_keys_boom');
      },
      get() {
        throw new Error('condition_get_boom');
      },
    });

    const compiledProcess = buildCompiledProcess({
      nodes: [
        { id: 'gateway-1', type: 'gateway.exclusive', subtype: null, label: 'Gateway', config: {}, metadata: {} },
      ],
      edges: [
        {
          id: 'edge-hostile',
          source: 'gateway-1',
          target: 'vip-task',
          condition: hostileCondition,
          priority: 0,
          metadata: { sourcePort: 'vip' },
        },
        {
          id: 'edge-default',
          source: 'gateway-1',
          target: 'default-task',
          condition: null,
          priority: 1,
          metadata: { sourcePort: 'default' },
        },
      ],
    });

    const context = new ProcessExecutionContext({
      processId: compiledProcess.id,
      executionId: 'exec-hostile-gateway',
      currentNodeId: 'gateway-1',
      variables: {},
    });

    const machine = new ProcessStateMachine();
    const node = compiledProcess.executionGraph.nodesById['gateway-1'];
    const result = await machine.executeNode(node, context, compiledProcess, {});

    expect(result.output).toMatchObject({ type: 'router', chosenNext: 'default-task' });
    expect(result.nextNodeId).toBe('default-task');
  }, 5000));

  test('fallback com input hostil preserva execução e limpa reason', withTimeout(async () => {
    const compiledProcess = buildCompiledProcess({
      nodes: [
        { id: 'fallback-1', type: 'fallback', subtype: null, label: 'Fallback', config: { mode: 'fallback', target: 'human-1' }, metadata: {} },
      ],
      edges: [],
    });

    const context = new ProcessExecutionContext({
      processId: compiledProcess.id,
      executionId: 'exec-hostile-fallback',
      currentNodeId: 'fallback-1',
      variables: {},
    });

    const machine = new ProcessStateMachine();
    const node = compiledProcess.executionGraph.nodesById['fallback-1'];
    const { proxy: hostileInput, revoke } = Proxy.revocable({ reason: 'boom' }, {});
    revoke();

    const result = await machine.executeNode(node, context, compiledProcess, hostileInput);

    expect(result.output).toMatchObject({ type: 'fallback', mode: 'fallback', target: 'human-1' });
    expect(context.metadata.fallbackTriggered).toBe(true);
    expect(context.metadata.fallbackReason).toBeNull();
  }, 5000));
});
