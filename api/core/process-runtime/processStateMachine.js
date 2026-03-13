'use strict';

const { v4: uuidv4 } = require('uuid');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function renderTemplate(template, variables = {}) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = String(path || '')
      .split('.')
      .filter(Boolean)
      .reduce((acc, key) => (acc != null && typeof acc === 'object' ? acc[key] : undefined), variables);
    return value == null ? '' : String(value);
  });
}

function toStateSnapshot(context) {
  return {
    sessionId: context.executionId,
    flowId: context.processId,
    currentNodeId: context.currentNodeId,
    variables: clone(context.variables || {}),
    history: clone(context.history || []),
    metadata: clone(context.metadata || {}),
  };
}

function pickEdgeTarget(compiledProcess, nodeId, preferredPort = null) {
  const edges = compiledProcess?.executionGraph?.edgesBySource?.[String(nodeId)] || [];
  if (!Array.isArray(edges) || edges.length === 0) return null;
  if (preferredPort) {
    const matched = edges.find((edge) => String(edge?.metadata?.sourcePort || 'out') === String(preferredPort));
    if (matched) return String(matched.target);
  }
  const fallback = edges.find((edge) => ['out', 'default', 'fallback', 'main', 'success'].includes(String(edge?.metadata?.sourcePort || 'out')));
  return fallback ? String(fallback.target) : String(edges[0].target);
}

function decideNextNode({ node, compiledProcess, handlerOutput, currentNodeId }) {
  const nextStateNodeId = handlerOutput?.nextState?.currentNodeId;
  if (nextStateNodeId && String(nextStateNodeId) !== String(currentNodeId)) {
    return String(nextStateNodeId);
  }

  const output = handlerOutput?.output || {};
  if (output.waitForInput === true) {
    return String(currentNodeId);
  }
  if (output.type === 'router') {
    return output.chosenNext ? String(output.chosenNext) : pickEdgeTarget(compiledProcess, currentNodeId);
  }
  if (output.type === 'fallback_retry') return pickEdgeTarget(compiledProcess, currentNodeId, 'retry');
  if (output.type === 'handoff' || output.type === 'fallback_human') {
    return pickEdgeTarget(compiledProcess, currentNodeId, 'human') || pickEdgeTarget(compiledProcess, currentNodeId, 'out');
  }
  if (output.type === 'error' || output.type === 'node_error_fallback') {
    return pickEdgeTarget(compiledProcess, currentNodeId, 'error') || pickEdgeTarget(compiledProcess, currentNodeId, 'fallback');
  }

  return pickEdgeTarget(compiledProcess, currentNodeId);
}

class ProcessStateMachine {
  constructor({ eventBus, timerService, serviceExecutor, aiExecutor, scriptExecutor, subprocessExecutor, onTimerElapsed } = {}) {
    this.eventBus = eventBus || null;
    this.timerService = timerService || null;
    this.serviceExecutor = serviceExecutor || null;
    this.aiExecutor = aiExecutor || null;
    this.scriptExecutor = scriptExecutor || null;
    this.subprocessExecutor = subprocessExecutor || null;
    this.onTimerElapsed = typeof onTimerElapsed === 'function' ? onTimerElapsed : null;
  }

  emit(eventType, context, node, metadata = {}) {
    if (!this.eventBus) return null;
    return this.eventBus.publishRuntimeEvent({
      eventType,
      processId: context.processId,
      executionId: context.executionId,
      nodeId: node?.id || null,
      nodeType: node?.type || null,
      timestamp: new Date().toISOString(),
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        transient: true,
        persisted: false,
        source: 'process-state-machine',
      },
    });
  }

  async executeStart(_node, context, _input) {
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'start' },
    };
  }

  async executeEnd(_node, context) {
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'end' },
    };
  }

  async executeMessageSend(node, context) {
    const text = renderTemplate(node.config?.text || node.config?.message || node.label || '', context.variables || {});
    context.pushHistory({ role: 'bot', type: 'message', text, nodeId: node.id });
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'message', text },
    };
  }

  async executeMessageReceive(node, context, input) {
    const variableName = node.config?.variable || 'user_input';
    const text = input?.text != null ? String(input.text) : null;
    if (!text || !text.trim()) {
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: { type: 'message_receive', waitForInput: true, variable: variableName },
      };
    }
    context.setVariable(variableName, text);
    context.pushHistory({ role: 'user', type: 'message', text, nodeId: node.id });
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'message_receive', waitForInput: false, variable: variableName, text },
    };
  }

  async executeGateway(node, context, compiledProcess, input) {
    const edges = (compiledProcess?.executionGraph?.edgesBySource?.[String(node.id)] || []).slice();
    const chosen = edges.find((edge) => this.edgeMatchesCondition(edge, context, input))
      || edges.find((edge) => !edge.condition || Object.keys(edge.condition || {}).length === 0)
      || edges[0]
      || null;

    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: {
        type: 'router',
        chosenNext: chosen ? String(chosen.target) : null,
      },
    };
  }

  edgeMatchesCondition(edge, context, input) {
    const condition = edge?.condition;
    if (!condition || typeof condition !== 'object' || Object.keys(condition).length === 0) {
      return false;
    }
    const variableName = condition.variable || condition.left || condition.path || null;
    const leftValue = variableName
      ? context.getVariable(variableName, input?.[variableName])
      : undefined;
    const rightValue = Object.prototype.hasOwnProperty.call(condition, 'value')
      ? condition.value
      : condition.right;

    switch (String(condition.operator || condition.op || 'equals')) {
      case 'exists':
        return leftValue !== undefined && leftValue !== null && leftValue !== '';
      case 'not_exists':
        return leftValue === undefined || leftValue === null || leftValue === '';
      case 'not_equals':
      case '!=':
        return leftValue !== rightValue;
      case 'gt':
      case '>':
        return Number(leftValue) > Number(rightValue);
      case 'gte':
      case '>=':
        return Number(leftValue) >= Number(rightValue);
      case 'lt':
      case '<':
        return Number(leftValue) < Number(rightValue);
      case 'lte':
      case '<=':
        return Number(leftValue) <= Number(rightValue);
      case 'includes':
        return Array.isArray(leftValue)
          ? leftValue.includes(rightValue)
          : String(leftValue || '').includes(String(rightValue || ''));
      case 'equals':
      case '==':
      default:
        return leftValue === rightValue;
    }
  }

  async executeService(node, context, input) {
    if (typeof this.serviceExecutor === 'function') {
      return this.serviceExecutor(node, context, input);
    }
    const outputVariable = node.config?.outputVariable || `${node.id}_result`;
    const payload = node.config?.mockResult != null ? clone(node.config.mockResult) : { ok: true };
    context.setVariable(outputVariable, payload);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'service', variable: outputVariable, data: payload },
    };
  }

  async executeAi(node, context, input) {
    if (typeof this.aiExecutor === 'function') {
      return this.aiExecutor(node, context, input);
    }
    const outputVariable = node.config?.outputVariable || `${node.id}_ai`;
    const prompt = typeof node.config?.promptTemplate === 'string'
      ? renderTemplate(node.config.promptTemplate, context.variables || {})
      : String(input?.text || context.getVariable('user_input', ''));
    const response = { text: node.config?.mockResponse || prompt || 'ai_response', confidence: 1 };
    context.setVariable(outputVariable, response);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'ai', result: response, variable: outputVariable },
    };
  }

  async executeScript(node, context, input) {
    if (typeof this.scriptExecutor === 'function') {
      return this.scriptExecutor(node, context, input);
    }
    const outputVariable = node.config?.outputVariable || `${node.id}_script`;
    const value = Object.prototype.hasOwnProperty.call(node.config || {}, 'value')
      ? node.config.value
      : input?.value ?? true;
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'script', variable: outputVariable, value },
    };
  }

  async executeUserTask(node, context, input) {
    const queue = node.config?.queue || node.config?.target || node.config?.assignee || 'human';
    if (input && (input.resumeType === 'human' || input.approved === true || input.completed === true)) {
      context.metadata = {
        ...(context.metadata || {}),
        status: 'human_resolved',
        handoffQueue: queue,
        humanResolution: clone(input),
      };
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: { type: 'handoff_resolved', queue, resolution: clone(input) },
      };
    }
    context.metadata = { ...(context.metadata || {}), status: 'waiting_human', handoffQueue: queue };
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'handoff', queue, waitForInput: true },
    };
  }

  async executeTimer(node, context, input) {
    const durationMs = Number(node.config?.durationMs ?? node.config?.delayMs ?? node.config?.duration ?? node.config?.timeoutMs ?? 0);
    const readyTimer = this.timerService && this.timerService.consumeReadyTimer(context.executionId, node.id);
    if (input?.timerFired === true || readyTimer) {
      context.metadata = {
        ...(context.metadata || {}),
        lastTimerElapsed: readyTimer || {
          timerId: input?.timerId || null,
          durationMs,
          nodeId: node.id,
          executionId: context.executionId,
          processId: context.processId,
        },
      };
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: { type: 'timer_elapsed', timerId: context.metadata.lastTimerElapsed?.timerId || null, durationMs },
      };
    }
    if (!this.timerService) {
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: { type: 'timer_elapsed', timerId: null, durationMs },
      };
    }

    const timer = this.timerService.scheduleTimer({
      context,
      node,
      durationMs,
      onElapsed: async (timerPayload) => {
        if (this.onTimerElapsed) {
          await this.onTimerElapsed(timerPayload);
        }
      },
    });
    context.metadata = { ...(context.metadata || {}), waitingTimer: timer };
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'timer_wait', waitForInput: true, timerId: timer.timerId, durationMs: timer.durationMs },
    };
  }

  async executeSubprocess(node, context, input) {
    if (typeof this.subprocessExecutor === 'function') {
      return this.subprocessExecutor(node, context, input);
    }
    if (node.config?.async === true || node.config?.waitForCompletion === false) {
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: {
          type: 'subprocess_wait',
          calledElement: node.config?.flowId || node.config?.calledElement || null,
          waitForInput: true,
        },
      };
    }
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'subprocess', calledElement: node.config?.flowId || node.config?.calledElement || null },
      };
  }

  async executeFallback(node, context, input) {
    const fallbackTarget = node.config?.target || null;
    const mode = node.config?.mode || 'fallback';
    context.metadata = {
      ...(context.metadata || {}),
      fallbackTriggered: true,
      fallbackReason: input?.error?.message || input?.reason || null,
    };
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'fallback', mode, target: fallbackTarget },
    };
  }

  async executeUtilityTime(node, context) {
    const outputVariable = node.config?.outputVariable || 'current_time';
    const value = new Date().toISOString();
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'current_time', value, variable: outputVariable },
    };
  }

  async executeUtilityUuid(node, context) {
    const outputVariable = node.config?.outputVariable || 'uuid';
    const value = uuidv4();
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'uuid', value, variable: outputVariable },
    };
  }

  async executeUtilityRandom(node, context) {
    const outputVariable = node.config?.outputVariable || 'random';
    const min = Number(node.config?.min ?? 0);
    const max = Number(node.config?.max ?? 100);
    const value = Math.floor(Math.random() * ((max - min) + 1)) + min;
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'random', value, variable: outputVariable },
    };
  }

  async executeUtilityTransform(node, context, input) {
    const outputVariable = node.config?.outputVariable || `${node.id}_transform`;
    let value;
    if (Object.prototype.hasOwnProperty.call(node.config || {}, 'template')) {
      value = renderTemplate(node.config.template, { ...(context.variables || {}), input: input || {} });
    } else if (Object.prototype.hasOwnProperty.call(node.config || {}, 'value')) {
      value = clone(node.config.value);
    } else {
      value = input?.value ?? context.getVariable(node.config?.sourceVariable || '', null);
    }
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'transform', value, variable: outputVariable },
    };
  }

  async executeNode(node, context, compiledProcess, input = null) {
    this.emit('NODE_ENTER', context, node, { nodeType: node.type, subtype: node.subtype || null });

    let handlerOutput;
    try {
      switch (String(node.type)) {
        case 'start':
          handlerOutput = await this.executeStart(node, context, input);
          break;
        case 'end':
          handlerOutput = await this.executeEnd(node, context, input);
          break;
        case 'task.message.send':
          handlerOutput = await this.executeMessageSend(node, context, input);
          break;
        case 'task.message.receive':
          handlerOutput = await this.executeMessageReceive(node, context, input);
          break;
        case 'gateway.exclusive':
          handlerOutput = await this.executeGateway(node, context, compiledProcess, input);
          break;
        case 'task.service':
          handlerOutput = await this.executeService(node, context, input);
          break;
        case 'task.ai':
          handlerOutput = await this.executeAi(node, context, input);
          break;
        case 'task.script':
        case 'variable.set':
          handlerOutput = await this.executeScript(node, context, input);
          break;
        case 'task.user':
          handlerOutput = await this.executeUserTask(node, context, input);
          break;
        case 'wait.timer':
          handlerOutput = await this.executeTimer(node, context, input);
          break;
        case 'call.subprocess':
          handlerOutput = await this.executeSubprocess(node, context, input);
          break;
        case 'fallback':
          handlerOutput = await this.executeFallback(node, context, input);
          break;
        case 'utility.time':
          handlerOutput = await this.executeUtilityTime(node, context, input);
          break;
        case 'utility.uuid':
          handlerOutput = await this.executeUtilityUuid(node, context, input);
          break;
        case 'utility.random':
          handlerOutput = await this.executeUtilityRandom(node, context, input);
          break;
        case 'utility.transform':
          handlerOutput = await this.executeUtilityTransform(node, context, input);
          break;
        default:
          throw new Error(`Unsupported canonical node type: ${node.type}`);
      }
    } catch (error) {
      this.emit('NODE_ERROR', context, node, { error: error.message || String(error) });
      throw error;
    }

    const nextNodeId = decideNextNode({
      node,
      compiledProcess,
      handlerOutput,
      currentNodeId: context.currentNodeId,
    });

    if (handlerOutput?.output?.type === 'timer_wait' && handlerOutput.output.waitForInput === true) {
      context.status = 'waiting_timer';
    } else if (handlerOutput?.output?.waitForInput === true) {
      context.status = 'waiting_input';
      context.moveToNode(context.currentNodeId);
    } else if (node.type === 'end' || nextNodeId == null) {
      context.status = 'completed';
      context.moveToNode(null);
    } else {
      context.status = 'running';
      context.moveToNode(nextNodeId);
    }

    this.emit('NODE_EXIT', context, node, {
      nextNodeId: context.currentNodeId,
      outputType: handlerOutput?.output?.type || null,
    });

    return {
      ...handlerOutput,
      nextNodeId: context.currentNodeId,
      completed: context.status === 'completed',
      waiting: context.status === 'waiting_input' || context.status === 'waiting_timer',
    };
  }
}

module.exports = {
  ProcessStateMachine,
};
