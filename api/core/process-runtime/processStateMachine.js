'use strict';

const { v4: uuidv4 } = require('uuid');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeClone(value, fallbackValue = null) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallbackValue;
  }
}

function safeGet(value, key, fallbackValue = undefined) {
  try {
    const result = value?.[key];
    return result === undefined ? fallbackValue : result;
  } catch (_) {
    return fallbackValue;
  }
}

function safeToString(value, fallbackValue = '') {
  try {
    return String(value);
  } catch (_) {
    return fallbackValue;
  }
}

function safeIsArray(value) {
  try {
    return Array.isArray(value);
  } catch (_) {
    return false;
  }
}

function safeHasOwn(value, key) {
  try {
    return Object.prototype.hasOwnProperty.call(value, key);
  } catch (_) {
    return false;
  }
}

function safeHasKeys(value) {
  if (!value || typeof value !== 'object') return false;
  try {
    return Object.keys(value).length > 0;
  } catch (_) {
    return false;
  }
}

function safeKeyCount(value) {
  if (!value || typeof value !== 'object') return -1;
  try {
    return Object.keys(value).length;
  } catch (_) {
    return -1;
  }
}

function getEdgesForNode(compiledProcess, nodeId) {
  const graph = safeGet(compiledProcess, 'executionGraph', null);
  const edgesBySource = safeGet(graph, 'edgesBySource', null);
  const edges = safeGet(edgesBySource, safeToString(nodeId, ''), []);
  return safeIsArray(edges) ? edges : [];
}

function renderTemplate(template, variables = {}) {
  return safeToString(template || '', '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = safeToString(path || '', '')
      .split('.')
      .filter(Boolean)
      .reduce((acc, key) => safeGet(acc, key), variables);
    return value == null ? '' : safeToString(value, '');
  });
}

function toStateSnapshot(context) {
  return {
    sessionId: context.executionId,
    flowId: context.processId,
    currentNodeId: context.currentNodeId,
    variables: safeClone(context.variables || {}) ?? {},
    history: safeClone(context.history || []) ?? [],
    metadata: safeClone(context.metadata || {}) ?? {},
  };
}

function pickEdgeTarget(compiledProcess, nodeId, preferredPort = null) {
  const edges = getEdgesForNode(compiledProcess, nodeId);
  if (edges.length === 0) return null;
  if (preferredPort) {
    const matched = edges.find((edge) => safeToString(safeGet(safeGet(edge, 'metadata', null), 'sourcePort', 'out'), 'out') === safeToString(preferredPort, ''));
    if (matched) return safeToString(safeGet(matched, 'target', null), null);
  }
  const fallback = edges.find((edge) => ['out', 'default', 'fallback', 'main', 'success'].includes(safeToString(safeGet(safeGet(edge, 'metadata', null), 'sourcePort', 'out'), 'out')));
  return fallback
    ? safeToString(safeGet(fallback, 'target', null), null)
    : safeToString(safeGet(edges[0], 'target', null), null);
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
    const config = safeGet(node, 'config', null);
    const text = renderTemplate(
      safeGet(config, 'text') || safeGet(config, 'message') || safeGet(node, 'label') || '',
      context.variables || {},
    );
    context.pushHistory({ role: 'bot', type: 'message', text, nodeId: safeGet(node, 'id', null) });
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'message', text },
    };
  }

  async executeMessageReceive(node, context, input) {
    const config = safeGet(node, 'config', null);
    const variableName = safeGet(config, 'variable', 'user_input') || 'user_input';
    const rawText = safeGet(input, 'text', null);
    const text = rawText != null ? safeToString(rawText, null) : null;
    if (!text || !text.trim()) {
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: { type: 'message_receive', waitForInput: true, variable: variableName },
      };
    }
    context.setVariable(variableName, text);
    context.pushHistory({ role: 'user', type: 'message', text, nodeId: safeGet(node, 'id', null) });
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'message_receive', waitForInput: false, variable: variableName, text },
    };
  }

  async executeGateway(node, context, compiledProcess, input) {
    const edges = getEdgesForNode(compiledProcess, safeGet(node, 'id', '')).slice();
    const chosen = edges.find((edge) => this.edgeMatchesCondition(edge, context, input))
      || edges.find((edge) => {
        const condition = safeGet(edge, 'condition');
        const keyCount = safeKeyCount(condition);
        return !condition || keyCount === 0;
      })
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
    const condition = safeGet(edge, 'condition', null);
    if (!condition || typeof condition !== 'object' || safeKeyCount(condition) <= 0) {
      return false;
    }
    const variableName = safeGet(condition, 'variable') || safeGet(condition, 'left') || safeGet(condition, 'path') || null;
    const inputValue = variableName ? safeGet(input, variableName) : undefined;
    const leftValue = variableName
      ? context.getVariable(variableName, inputValue)
      : undefined;
    const rightValue = safeHasOwn(condition, 'value')
      ? safeGet(condition, 'value')
      : safeGet(condition, 'right');

    switch (safeToString(safeGet(condition, 'operator') || safeGet(condition, 'op') || 'equals', 'equals')) {
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
        return safeIsArray(leftValue)
          ? leftValue.includes(rightValue)
          : safeToString(leftValue || '', '').includes(safeToString(rightValue || '', ''));
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
    const config = safeGet(node, 'config', null);
    const outputVariable = safeGet(config, 'outputVariable') || `${safeToString(safeGet(node, 'id', ''), '')}_result`;
    const mockResult = safeGet(config, 'mockResult');
    const payload = mockResult != null ? (safeClone(mockResult) ?? { ok: true }) : { ok: true };
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
    const config = safeGet(node, 'config', null);
    const outputVariable = safeGet(config, 'outputVariable') || `${safeToString(safeGet(node, 'id', ''), '')}_ai`;
    const promptTemplate = safeGet(config, 'promptTemplate');
    const prompt = typeof promptTemplate === 'string'
      ? renderTemplate(promptTemplate, context.variables || {})
      : safeToString(safeGet(input, 'text') || context.getVariable('user_input', ''), '');
    const response = { text: safeGet(config, 'mockResponse') || prompt || 'ai_response', confidence: 1 };
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
    const config = safeGet(node, 'config', null);
    const outputVariable = safeGet(config, 'outputVariable') || `${safeToString(safeGet(node, 'id', ''), '')}_script`;
    const value = safeHasOwn(config || {}, 'value')
      ? safeGet(config, 'value')
      : safeGet(input, 'value', true);
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'script', variable: outputVariable, value },
    };
  }

  async executeUserTask(node, context, input) {
    const config = safeGet(node, 'config', null);
    const queue = safeGet(config, 'queue') || safeGet(config, 'target') || safeGet(config, 'assignee') || 'human';
    const resumeType = safeGet(input, 'resumeType');
    const approved = safeGet(input, 'approved');
    const completed = safeGet(input, 'completed');
    if (input && (resumeType === 'human' || approved === true || completed === true)) {
      context.metadata = {
        ...(context.metadata || {}),
        status: 'human_resolved',
        handoffQueue: queue,
        humanResolution: safeClone(input) ?? {},
      };
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: { type: 'handoff_resolved', queue, resolution: safeClone(input) ?? {} },
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
    const config = safeGet(node, 'config', null);
    const durationMs = Number(safeGet(config, 'durationMs') ?? safeGet(config, 'delayMs') ?? safeGet(config, 'duration') ?? safeGet(config, 'timeoutMs') ?? 0);
    const readyTimer = this.timerService && this.timerService.consumeReadyTimer(context.executionId, safeGet(node, 'id', null));
    if (safeGet(input, 'timerFired') === true || readyTimer) {
      context.metadata = {
        ...(context.metadata || {}),
        lastTimerElapsed: readyTimer || {
          timerId: safeGet(input, 'timerId', null),
          durationMs,
          nodeId: safeGet(node, 'id', null),
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
    const config = safeGet(node, 'config', null);
    if (safeGet(config, 'async') === true || safeGet(config, 'waitForCompletion') === false) {
      return {
        nextState: toStateSnapshot(context),
        events: [],
        output: {
          type: 'subprocess_wait',
          calledElement: safeGet(config, 'flowId') || safeGet(config, 'calledElement') || null,
          waitForInput: true,
        },
      };
    }
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'subprocess', calledElement: safeGet(config, 'flowId') || safeGet(config, 'calledElement') || null },
      };
  }

  async executeFallback(node, context, input) {
    const config = safeGet(node, 'config', null);
    const fallbackTarget = safeGet(config, 'target', null);
    const mode = safeGet(config, 'mode', 'fallback') || 'fallback';
    context.metadata = {
      ...(context.metadata || {}),
      fallbackTriggered: true,
      fallbackReason: safeGet(safeGet(input, 'error', null), 'message') || safeGet(input, 'reason') || null,
    };
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'fallback', mode, target: fallbackTarget },
    };
  }

  async executeUtilityTime(node, context) {
    const outputVariable = safeGet(safeGet(node, 'config', null), 'outputVariable', 'current_time') || 'current_time';
    const value = new Date().toISOString();
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'current_time', value, variable: outputVariable },
    };
  }

  async executeUtilityUuid(node, context) {
    const outputVariable = safeGet(safeGet(node, 'config', null), 'outputVariable', 'uuid') || 'uuid';
    const value = uuidv4();
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'uuid', value, variable: outputVariable },
    };
  }

  async executeUtilityRandom(node, context) {
    const config = safeGet(node, 'config', null);
    const outputVariable = safeGet(config, 'outputVariable', 'random') || 'random';
    const min = Number(safeGet(config, 'min') ?? 0);
    const max = Number(safeGet(config, 'max') ?? 100);
    const value = Math.floor(Math.random() * ((max - min) + 1)) + min;
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'random', value, variable: outputVariable },
    };
  }

  async executeUtilityTransform(node, context, input) {
    const config = safeGet(node, 'config', null);
    const outputVariable = safeGet(config, 'outputVariable') || `${safeToString(safeGet(node, 'id', ''), '')}_transform`;
    let value;
    if (safeHasOwn(config || {}, 'template')) {
      value = renderTemplate(safeGet(config, 'template'), { ...(context.variables || {}), input: input || {} });
    } else if (safeHasOwn(config || {}, 'value')) {
      value = safeClone(safeGet(config, 'value'));
    } else {
      value = safeGet(input, 'value') ?? context.getVariable(safeGet(config, 'sourceVariable', '') || '', null);
    }
    context.setVariable(outputVariable, value);
    return {
      nextState: toStateSnapshot(context),
      events: [],
      output: { type: 'transform', value, variable: outputVariable },
    };
  }

  async executeNode(node, context, compiledProcess, input = null) {
    const nodeType = safeToString(safeGet(node, 'type'), '');
    this.emit('NODE_ENTER', context, node, { nodeType, subtype: safeGet(node, 'subtype', null) });

    let handlerOutput;
    try {
      switch (nodeType) {
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
          throw new Error(`Unsupported canonical node type: ${nodeType}`);
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
    } else if (nodeType === 'end' || nextNodeId == null) {
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
