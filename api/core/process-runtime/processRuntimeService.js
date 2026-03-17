'use strict';

const { ProcessExecutionContext } = require('./processExecutionContext');
const { ProcessEventBus } = require('./processEventBus');
const { ProcessObservabilityService } = require('./processObservabilityService');
const { ProcessTimerService } = require('./processTimerService');
const { ProcessStateMachine } = require('./processStateMachine');
const { compileCanonicalProcessDefinition, engineFlowToCanonicalProcess } = require('./processCanonicalAdapter');
const { InMemoryProcessInstanceStore, SequelizeProcessInstanceStore } = require('./processInstanceStore');
const { InMemoryProcessExecutionRepository, SequelizeProcessExecutionRepository } = require('./processExecutionRepository');
const { ProcessReplayService } = require('./processReplayService');
const { ProcessResumeService } = require('./processResumeService');
const { ProcessInstanceInspector } = require('./processInstanceInspector');
const { InMemoryProcessIdempotencyService } = require('./processIdempotencyService');
const { InMemoryProcessCompiledDefinitionRepository, SequelizeProcessCompiledDefinitionRepository } = require('./processCompiledDefinitionRepository');
const { ProcessPayloadValidator } = require('./processPayloadValidator');
const { PROCESS_INSTANCE_STATUSES } = require('./processInstanceTypes');

function looksLikeCompiledProcessDefinition(definition) {
  return !!(definition && typeof definition === 'object' && definition.executionGraph && definition.nodes);
}

function looksLikeCanonicalProcessDefinition(definition) {
  return !!(definition && typeof definition === 'object' && Array.isArray(definition.nodes) && Array.isArray(definition.edges));
}

function looksLikeEngineFlow(definition) {
  return !!(
    definition
    && typeof definition === 'object'
    && Array.isArray(definition.nodes)
    && definition.nodes.every((node) => node && typeof node.type === 'string' && Object.prototype.hasOwnProperty.call(node, 'next'))
  );
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function safeGet(value, key, fallbackValue = undefined) {
  try {
    const result = value?.[key];
    return result === undefined ? fallbackValue : result;
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

function isSafeObjectRecord(value) {
  if (!value || typeof value !== 'object') return false;
  return !safeIsArray(value);
}

function safeShallowCloneRecord(value) {
  if (!isSafeObjectRecord(value)) return {};
  try {
    return { ...value };
  } catch (_) {
    return {};
  }
}

function safeCloneArray(value) {
  if (!safeIsArray(value)) return [];
  try {
    return value.slice();
  } catch (_) {
    return [];
  }
}

function safeToString(value, fallbackValue = '') {
  try {
    return String(value);
  } catch (_) {
    return fallbackValue;
  }
}

function sanitizeRuntimeInput(input) {
  const source = safeShallowCloneRecord(input);
  const sanitized = { ...source };
  sanitized.metadata = safeShallowCloneRecord(safeGet(source, 'metadata'));
  sanitized.variables = safeShallowCloneRecord(safeGet(source, 'variables'));
  sanitized.history = safeCloneArray(safeGet(source, 'history'));

  const executionId = safeGet(source, 'executionId');
  if (executionId != null && executionId !== '') {
    sanitized.executionId = safeToString(executionId, '');
  }

  const tenantId = safeGet(source, 'tenantId');
  if (tenantId != null && tenantId !== '') {
    sanitized.tenantId = safeToString(tenantId, null);
  }

  return sanitized;
}

function buildProcessRegistryKey(processId, processVersion) {
  return `${String(processId || '')}:${Number.isFinite(Number(processVersion)) ? Number(processVersion) : 1}`;
}

class ProcessRuntimeService {
  constructor(options = {}) {
    this.instanceStore = options.instanceStore || (options.useDatabasePersistence === false
      ? new InMemoryProcessInstanceStore()
      : new SequelizeProcessInstanceStore());
    this.executionRepository = options.executionRepository || (options.useDatabasePersistence === false
      ? new InMemoryProcessExecutionRepository()
      : new SequelizeProcessExecutionRepository());
    this.compiledProcessRepository = options.compiledProcessRepository || (options.useDatabasePersistence === false
      ? new InMemoryProcessCompiledDefinitionRepository()
      : new SequelizeProcessCompiledDefinitionRepository());
    this.eventBus = options.eventBus || new ProcessEventBus({ executionRepository: this.executionRepository });
    this.observability = options.observability || new ProcessObservabilityService({ eventBus: this.eventBus });
    this.replayService = options.replayService || new ProcessReplayService();
    this.idempotencyService = options.idempotencyService || new InMemoryProcessIdempotencyService({
      instanceStore: this.instanceStore,
    });
    this.payloadValidator = options.payloadValidator || new ProcessPayloadValidator();
    this._contexts = new Map();
    this._processes = new Map();
    this._processRegistry = new Map();
    this.compiledProcessResolver = typeof options.compiledProcessResolver === 'function'
      ? options.compiledProcessResolver
      : null;
    this.timerService = options.timerService || new ProcessTimerService({
      eventBus: this.eventBus,
      instanceStore: this.instanceStore,
    });
    this.resumeService = options.resumeService || new ProcessResumeService({
      runtimeService: this,
      instanceStore: this.instanceStore,
    });
    this.timerService.attachResumeService(this.resumeService);
    this.inspector = options.inspector || new ProcessInstanceInspector({
      instanceStore: this.instanceStore,
      executionRepository: this.executionRepository,
      replayService: this.replayService,
      compiledProcessResolver: async (executionId) => this._processes.get(String(executionId || '')) || null,
    });
    this.stateMachine = options.stateMachine || new ProcessStateMachine({
      eventBus: this.eventBus,
      timerService: this.timerService,
      serviceExecutor: options.serviceExecutor,
      aiExecutor: options.aiExecutor,
      scriptExecutor: options.scriptExecutor,
      subprocessExecutor: options.subprocessExecutor || ((node, context, input) => this.executeSubprocessNode(node, context, input)),
      onTimerElapsed: (timerPayload) => this.handleTimerElapsed(timerPayload),
    });
  }

  registerCompiledProcess(compiledProcess) {
    if (!compiledProcess || !compiledProcess.id) return null;
    const key = buildProcessRegistryKey(compiledProcess.id, compiledProcess.version || 1);
    this._processRegistry.set(key, compiledProcess);
    return compiledProcess;
  }

  async resolveCompiledProcessForInstance(instance) {
    if (!instance) return null;
    const key = buildProcessRegistryKey(instance.processId, instance.processVersion || 1);
    if (this._processRegistry.has(key)) {
      return this._processRegistry.get(key);
    }
    if (this.compiledProcessRepository && typeof this.compiledProcessRepository.loadCompiledProcess === 'function') {
      const persisted = await this.compiledProcessRepository.loadCompiledProcess({
        tenantId: instance.metadata?.tenantId || null,
        processId: instance.processId,
        processVersion: instance.processVersion || 1,
      });
      if (persisted) {
        this.registerCompiledProcess(persisted);
        return persisted;
      }
    }
    if (this.compiledProcessResolver) {
      const resolved = await this.compiledProcessResolver({
        executionId: instance.executionId,
        processId: instance.processId,
        processVersion: instance.processVersion || 1,
        instance,
      });
      if (resolved) {
        this.registerCompiledProcess(resolved);
        return resolved;
      }
    }
    return null;
  }

  async persistCompiledProcess(compiledProcess, input = {}) {
    if (!this.compiledProcessRepository || typeof this.compiledProcessRepository.saveCompiledProcess !== 'function') {
      return null;
    }
    const safeInput = sanitizeRuntimeInput(input);
    const safeMetadata = safeShallowCloneRecord(safeGet(safeInput, 'metadata'));
    const compiledMetadata = safeShallowCloneRecord(safeGet(compiledProcess, 'metadata'));
    const sourceDefinition = safeGet(safeInput, 'processDefinition', null);
    const tenantId = safeGet(safeInput, 'tenantId') || safeGet(safeMetadata, 'tenantId') || safeGet(compiledMetadata, 'tenantId') || null;
    return this.compiledProcessRepository.saveCompiledProcess({
      tenantId,
      compiledProcess,
      sourceDefinition: looksLikeCompiledProcessDefinition(sourceDefinition)
        ? sourceDefinition.canonical || sourceDefinition
        : sourceDefinition || null,
      sourceType: looksLikeEngineFlow(sourceDefinition)
        ? 'engine'
        : looksLikeCanonicalProcessDefinition(sourceDefinition)
          ? 'canonical'
          : 'compiled',
    });
  }

  ensureCompiledProcess(processOrFlow, options = {}) {
    let compiled = null;
    if (looksLikeCompiledProcessDefinition(processOrFlow)) {
      compiled = processOrFlow;
    } else if (looksLikeCanonicalProcessDefinition(processOrFlow)) {
      compiled = compileCanonicalProcessDefinition(processOrFlow);
    } else if (looksLikeEngineFlow(processOrFlow) && options.allowEngineFlow !== false) {
      compiled = compileCanonicalProcessDefinition(engineFlowToCanonicalProcess(processOrFlow));
    } else {
      throw new Error('Unsupported process definition. ProcessRuntimeService accepts CanonicalProcessDefinition, CompiledProcessDefinition or EngineFlow via adapter.');
    }
    this.registerCompiledProcess(compiled);
    return compiled;
  }

  createExecutionId(compiledProcess, input = {}) {
    const providedExecutionId = safeGet(input, 'executionId');
    const fallbackExecutionId = `${safeToString(safeGet(compiledProcess, 'id'), '')}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    return safeToString(providedExecutionId || fallbackExecutionId, fallbackExecutionId);
  }

  createContext(compiledProcess, input = {}) {
    const safeInput = sanitizeRuntimeInput(input);
    const safeMetadata = safeShallowCloneRecord(safeGet(safeInput, 'metadata'));
    const compiledMetadata = safeShallowCloneRecord(safeGet(compiledProcess, 'metadata'));
    return new ProcessExecutionContext({
      processId: compiledProcess.id,
      processVersion: compiledProcess.version || 1,
      executionId: this.createExecutionId(compiledProcess, safeInput),
      currentNodeId: compiledProcess.executionGraph.startNode ? String(compiledProcess.executionGraph.startNode) : null,
      variables: safeShallowCloneRecord(safeGet(safeInput, 'variables')),
      history: safeCloneArray(safeGet(safeInput, 'history')),
      metadata: {
        ...safeMetadata,
        tenantId: safeGet(safeInput, 'tenantId') || safeGet(compiledMetadata, 'tenantId') || null,
        runtime: 'durable-canonical',
        processDefinitionKey: buildProcessRegistryKey(compiledProcess.id, compiledProcess.version || 1),
      },
      status: PROCESS_INSTANCE_STATUSES.PENDING,
    });
  }

  async createProcessInstance(compiledProcess, context) {
    return this.instanceStore.createInstance({
      executionId: context.executionId,
      processId: compiledProcess.id,
      processVersion: compiledProcess.version || 1,
      status: PROCESS_INSTANCE_STATUSES.PENDING,
      currentNodeId: context.currentNodeId,
      variablesSnapshot: clone(context.variables),
      waitingState: context.waitingState,
      startedAt: context.startTime,
      updatedAt: new Date().toISOString(),
      lastEventSequence: 0,
      metadata: clone({
        ...(context.metadata || {}),
        processDefinitionKey: buildProcessRegistryKey(compiledProcess.id, compiledProcess.version || 1),
      }),
    });
  }

  async emitProcessEvent(eventType, { context, compiledProcess, node = null, payload = {}, metadata = {} } = {}) {
    const event = await this.eventBus.emit(eventType, {
      executionId: context.executionId,
      processId: context.processId,
      processVersion: compiledProcess.version || context.processVersion || 1,
      nodeId: node?.id || null,
      nodeType: node?.type || null,
      payload,
      metadata,
    });
    context.lastProcessedSequence = Number(event.sequence || context.lastProcessedSequence || 0);
    await this.instanceStore.updateInstance(context.executionId, {
      lastEventSequence: context.lastProcessedSequence,
      updatedAt: event.timestamp,
    });
    return event;
  }

  async persistContextSnapshot(context) {
    return this.instanceStore.updateInstance(context.executionId, {
      processVersion: context.processVersion,
      status: context.status,
      currentNodeId: context.currentNodeId,
      variablesSnapshot: clone(context.variables),
      waitingState: context.waitingState ? clone(context.waitingState) : null,
      metadata: clone(context.metadata),
      lastEventSequence: context.lastProcessedSequence,
    });
  }

  async prepareExecution(processOrFlow, input = {}, options = {}) {
    const safeInput = sanitizeRuntimeInput(input);
    const compiledProcess = this.ensureCompiledProcess(processOrFlow, options);
    await this.persistCompiledProcess(compiledProcess, {
      ...safeInput,
      processDefinition: processOrFlow,
    });
    const context = this.createContext(compiledProcess, safeInput);
    this._contexts.set(context.executionId, context);
    this._processes.set(context.executionId, compiledProcess);
    await this.createProcessInstance(compiledProcess, context);
    return { compiledProcess, context };
  }

  async startProcess(processOrFlow, input = {}, options = {}) {
    const safeInput = sanitizeRuntimeInput(input);
    const { compiledProcess, context } = await this.prepareExecution(processOrFlow, safeInput, options);
    context.status = PROCESS_INSTANCE_STATUSES.RUNNING;
    await this.persistContextSnapshot(context);
    await this.emitProcessEvent('PROCESS_STARTED', {
      context,
      compiledProcess,
      payload: {
        currentNodeId: context.currentNodeId,
        variablesSnapshot: clone(context.variables),
      },
      metadata: { runtime: 'durable' },
    });
    return this.executeNextNode(context.executionId, safeInput);
  }

  async loadContextForExecution(executionId) {
    const key = String(executionId || '');
    let context = this._contexts.get(key) || null;
    const compiledProcess = this._processes.get(key) || null;
    if (context && compiledProcess) {
      return { context, compiledProcess };
    }
    const instance = await this.instanceStore.loadInstance(key);
    if (!instance) {
      throw new Error(`Execution not found: ${executionId}`);
    }
    const resolvedProcess = compiledProcess || await this.resolveCompiledProcessForInstance(instance);
    const events = await this.executionRepository.listEventsByExecution(key);
    context = resolvedProcess && events.length > 0
      ? this.replayService.rebuildContextFromEvents(resolvedProcess, events)
      : this.replayService.rebuildContextFromInstance(instance);
    context.processId = instance.processId;
    context.processVersion = instance.processVersion || context.processVersion || 1;
    context.executionId = instance.executionId;
    context.startTime = instance.startedAt || context.startTime;
    context.metadata = {
      ...(context.metadata || {}),
      ...(instance.metadata || {}),
    };
    context.recovery = {
      ...(context.recovery || {}),
      from: resolvedProcess && events.length > 0 ? 'event-log' : 'instance',
      executionId: instance.executionId,
      updatedAt: instance.updatedAt || null,
    };
    this._contexts.set(key, context);
    if (resolvedProcess) {
      this._processes.set(key, resolvedProcess);
    }
    return { context, compiledProcess: resolvedProcess || this._processes.get(key) || null, instance };
  }

  async resumeProcess(executionId, input = {}) {
    let safeInput = sanitizeRuntimeInput(input);
    const { context, compiledProcess, instance } = await this.loadContextForExecution(executionId);
    const process = compiledProcess || this._processes.get(String(executionId)) || null;
    if (!process) {
      throw new Error(`Compiled process not available for execution: ${executionId}`);
    }
    if ([PROCESS_INSTANCE_STATUSES.COMPLETED, PROCESS_INSTANCE_STATUSES.FAILED, PROCESS_INSTANCE_STATUSES.CANCELLED].includes(context.status)) {
      throw new Error(`Execution ${executionId} cannot be resumed from status ${context.status}`);
    }
    if (!context.canResume() && !(instance && instance.status === PROCESS_INSTANCE_STATUSES.WAITING)) {
      throw new Error(`Execution ${executionId} is not waiting`);
    }

    const waitingState = context.waitingState || instance?.waitingState || null;
    const currentNode = context.getCurrentNode(process);
    const validation = this.payloadValidator.validatePayload({
      node: currentNode,
      waitingState,
      payload: safeInput || {},
    });
    if (!validation.ok) {
      const error = new Error('resume_payload_invalid');
      error.code = 'resume_payload_invalid';
      error.details = validation.details;
      throw error;
    }
    if (waitingState?.type === 'timer') {
      const readyTimer = this.timerService.consumeReadyTimer(context.executionId, waitingState.nodeId || context.currentNodeId);
      if (!readyTimer && safeInput?.timerFired !== true) {
        return this.buildResult(context.executionId, process, context, null);
      }
      safeInput = { ...(safeInput || {}), timerFired: true, ...(readyTimer || {}) };
    }

    context.clearWaitingState();
    context.status = PROCESS_INSTANCE_STATUSES.RUNNING;
    await this.persistContextSnapshot(context);
    await this.emitProcessEvent('PROCESS_RESUMED', {
      context,
      compiledProcess: process,
      payload: {
        resumeType: safeInput?.resumeType || waitingState?.type || 'manual',
        currentNodeId: context.currentNodeId,
        variablesSnapshot: clone(context.variables),
      },
    });
    await this.emitProcessEvent('NODE_RESUMED', {
      context,
      compiledProcess: process,
      node: currentNode,
      payload: {
        currentNodeId: context.currentNodeId,
        variablesSnapshot: clone(context.variables),
        input: clone(safeInput || {}),
      },
    });
    return this.executeNextNode(context.executionId, safeInput);
  }

  async handleTimerElapsed(timerPayload = {}) {
    return timerPayload;
  }

  getNodeTimeoutMs(node, compiledProcess) {
    const nodeTimeout = node?.timeoutPolicy;
    if (nodeTimeout?.enabled === true && Number(nodeTimeout.timeoutMs) > 0) {
      return Number(nodeTimeout.timeoutMs);
    }
    const processTimeout = compiledProcess?.policies?.timeout;
    if (processTimeout?.enabled === true && Number(processTimeout.timeoutMs) > 0) {
      return Number(processTimeout.timeoutMs);
    }
    return 0;
  }

  async executeNodeWithPolicies(node, context, compiledProcess, input) {
    const timeoutMs = this.getNodeTimeoutMs(node, compiledProcess);
    if (!timeoutMs) {
      return this.executeNodeWithIdempotency(node, context, compiledProcess, input);
    }
    let timeoutId = null;
    try {
      return await Promise.race([
        this.executeNodeWithIdempotency(node, context, compiledProcess, input),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            const error = new Error(`node_timeout:${node.id}`);
            error.code = 'NODE_TIMEOUT';
            error.timeoutMs = timeoutMs;
            reject(error);
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async resolveSubprocessDefinition(calledElement, context) {
    if (!calledElement) return null;
    const direct = await this.resolveCompiledProcessForInstance({
      processId: calledElement,
      processVersion: 1,
      metadata: { tenantId: context.metadata?.tenantId || null },
    });
    if (direct) return direct;
    if (this.compiledProcessRepository) {
      return this.compiledProcessRepository.loadCompiledProcess({
        tenantId: context.metadata?.tenantId || null,
        processId: calledElement,
        processVersion: 1,
      });
    }
    return null;
  }

  async executeSubprocessNode(node, context, input = {}) {
    const calledElement = node.config?.flowId || node.config?.calledElement || null;
    if (input?.resumeType === 'subprocess' || input?.childExecutionId || input?.childStatus) {
      context.setVariable(`${node.id}_subprocess`, {
        executionId: input?.childExecutionId || null,
        status: input?.childStatus || 'completed',
        output: clone(input?.output || null),
      });
      return {
        nextState: context.toSnapshot(),
        events: [],
        output: {
          type: 'subprocess_resolved',
          calledElement,
          childExecutionId: input?.childExecutionId || null,
          childStatus: input?.childStatus || 'completed',
        },
      };
    }
    const compiledChild = await this.resolveSubprocessDefinition(calledElement, context);
    const childExecutionId = input?.childExecutionId
      || `${context.executionId}:${String(node.id)}:child:${Date.now()}`;
    if (!compiledChild) {
      return {
        nextState: context.toSnapshot(),
        events: [],
        output: {
          type: node.config?.async === true || node.config?.waitForCompletion === false ? 'subprocess_wait' : 'subprocess',
          calledElement,
          waitForInput: node.config?.async === true || node.config?.waitForCompletion === false,
          childExecutionId,
        },
      };
    }

    const childInput = {
      executionId: childExecutionId,
      variables: clone(input?.variables || context.variables || {}),
      tenantId: context.metadata?.tenantId || null,
      metadata: {
        parentExecutionId: context.executionId,
        parentNodeId: node.id,
        parentCorrelationKey: `${context.executionId}:${node.id}:subprocess`,
        calledElement,
      },
    };
    const childResult = await this.startProcess(compiledChild, childInput, { allowEngineFlow: false });

    if (node.config?.async === true || node.config?.waitForCompletion === false) {
      context.metadata = {
        ...(context.metadata || {}),
        childProcesses: {
          ...((context.metadata && context.metadata.childProcesses) || {}),
          [String(node.id)]: {
            executionId: childExecutionId,
            processId: compiledChild.id,
            processVersion: compiledChild.version || 1,
          },
        },
      };
      return {
        nextState: context.toSnapshot(),
        events: [],
        output: {
          type: 'subprocess_wait',
          calledElement,
          childExecutionId,
          deferredSubprocessStart: {
            compiledChild,
            childInput,
          },
          waitForInput: true,
        },
      };
    }

    context.setVariable(`${node.id}_subprocess`, {
      executionId: childExecutionId,
      status: childResult.status,
      output: childResult.output || null,
    });
    return {
      nextState: context.toSnapshot(),
      events: [],
      output: {
        type: 'subprocess',
        calledElement,
        childExecutionId,
        childStatus: childResult.status,
      },
    };
  }

  async notifyParentIfNeeded(context, compiledProcess, output) {
    const parentExecutionId = context.metadata?.parentExecutionId || null;
    const parentCorrelationKey = context.metadata?.parentCorrelationKey || null;
    if (!parentExecutionId || !parentCorrelationKey) return null;
    try {
      return await this.resumeService.resumeExternalEvent(parentCorrelationKey, {
        resumeType: 'subprocess',
        parentExecutionId,
        childExecutionId: context.executionId,
        childProcessId: compiledProcess?.id || context.processId,
        childProcessVersion: compiledProcess?.version || context.processVersion || 1,
        childStatus: context.status,
        output: output || null,
      });
    } catch (_) {
      return null;
    }
  }

  async startDeferredSubprocess(output = {}) {
    const deferred = output?.deferredSubprocessStart || null;
    if (!deferred?.compiledChild || !deferred?.childInput) {
      return null;
    }
    return this.startProcess(deferred.compiledChild, deferred.childInput, { allowEngineFlow: false });
  }

  async cancelProcess(executionId, reason = 'cancelled', metadata = {}) {
    const { context, compiledProcess, instance } = await this.loadContextForExecution(executionId);
    const process = compiledProcess || await this.resolveCompiledProcessForInstance(instance);
    if ([PROCESS_INSTANCE_STATUSES.COMPLETED, PROCESS_INSTANCE_STATUSES.FAILED, PROCESS_INSTANCE_STATUSES.CANCELLED].includes(context.status)) {
      throw new Error(`Execution ${executionId} cannot be cancelled from status ${context.status}`);
    }
    context.status = PROCESS_INSTANCE_STATUSES.CANCELLED;
    context.clearWaitingState();
    context.metadata = {
      ...(context.metadata || {}),
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      cancellationReason: reason ? String(reason) : null,
    };
    this.timerService.cancelByExecutionId(executionId);
    await this.instanceStore.markCancelled(executionId, reason, context.metadata);
    if (process) {
      await this.emitProcessEvent('PROCESS_CANCELLED', {
        context,
        compiledProcess: process,
        payload: {
          reason: reason ? String(reason) : null,
          currentNodeId: context.currentNodeId,
        },
      });
      await this.notifyParentIfNeeded(context, process, {
        cancelled: true,
        reason: reason ? String(reason) : null,
      });
    }
    await this.persistContextSnapshot(context);
    return this.buildResult(executionId, process, context, null);
  }

  async executeNodeWithIdempotency(node, context, compiledProcess, input) {
    const sideEffectTypes = new Set(['task.service', 'task.ai', 'task.message.send', 'call.subprocess']);
    const sequence = Number(context.lastProcessedSequence || 0);
    if (!sideEffectTypes.has(String(node.type))) {
      return this.stateMachine.executeNode(node, context, compiledProcess, input);
    }
    const run = await this.idempotencyService.runOnce(
      {
        executionId: context.executionId,
        nodeId: node.id,
        sequence,
      },
      async () => {
        const result = await this.stateMachine.executeNode(node, context, compiledProcess, input);
        return {
          output: clone(result.output || null),
          nextNodeId: result.nextNodeId,
          completed: result.completed,
          waiting: result.waiting,
          contextSnapshot: context.toSnapshot(),
        };
      },
    );

    context.metadata = {
      ...(context.metadata || {}),
      idempotencyRecords: {
        ...((context.metadata && context.metadata.idempotencyRecords) || {}),
        [run.key]: clone(run.value),
      },
    };

    if (run.reused) {
      const restored = ProcessExecutionContext.fromSnapshot(run.value.contextSnapshot);
      restored.metadata = {
        ...(restored.metadata || {}),
        idempotencyRecords: {
          ...((restored.metadata && restored.metadata.idempotencyRecords) || {}),
          [run.key]: clone(run.value),
        },
      };
      this._contexts.set(context.executionId, restored);
      return {
        output: run.value.output,
        nextNodeId: run.value.nextNodeId,
        completed: run.value.completed,
        waiting: run.value.waiting,
      };
    }
    return run.value;
  }

  deriveWaitingState(node, context, result, input) {
    if (!result?.waiting) return null;
    const outputType = result?.output?.type || null;
    if (outputType === 'timer_wait') {
      return {
        type: 'timer',
        resumeAt: context.metadata?.waitingTimer?.resumeAt || null,
        correlationKey: input?.correlationKey || `${context.executionId}:${node.id}`,
        externalRef: context.metadata?.waitingTimer?.timerId || null,
        nodeId: node.id,
        metadata: {
          timerId: context.metadata?.waitingTimer?.timerId || null,
          durationMs: result.output?.durationMs || null,
        },
      };
    }
    if (node.type === 'task.message.receive') {
      return {
        type: 'message',
        resumeAt: null,
        correlationKey: input?.correlationKey || context.metadata?.correlationKey || `${context.executionId}:${node.id}:message`,
        externalRef: null,
        nodeId: node.id,
        metadata: {
          variable: result.output?.variable || node.config?.variable || 'user_input',
        },
      };
    }
    if (node.type === 'task.user') {
      return {
        type: 'human',
        resumeAt: null,
        correlationKey: input?.correlationKey || `${context.executionId}:${node.id}:human`,
        externalRef: context.metadata?.handoffQueue || null,
        nodeId: node.id,
        metadata: {
          queue: context.metadata?.handoffQueue || null,
        },
      };
    }
    if (node.type === 'call.subprocess') {
      return {
        type: 'subprocess',
        resumeAt: null,
        correlationKey: input?.correlationKey || `${context.executionId}:${node.id}:subprocess`,
        externalRef: result.output?.childExecutionId || result.output?.calledElement || null,
        nodeId: node.id,
        metadata: {
          calledElement: result.output?.calledElement || null,
          childExecutionId: result.output?.childExecutionId || null,
          resumeSchema: node.inputSchema || node.config?.resumeSchema || null,
        },
      };
    }
    return {
      type: 'external_event',
      resumeAt: null,
      correlationKey: input?.correlationKey || `${context.executionId}:${node.id}:external`,
      externalRef: null,
      nodeId: node.id,
      metadata: {
        resumeSchema: node.inputSchema || node.config?.resumeSchema || null,
      },
    };
  }

  async executeNextNode(contextOrExecutionId, input = {}) {
    input = sanitizeRuntimeInput(input);
    const executionId = typeof contextOrExecutionId === 'string'
      ? String(contextOrExecutionId)
      : String(contextOrExecutionId?.executionId || '');
    const loaded = typeof contextOrExecutionId === 'string'
      ? await this.loadContextForExecution(executionId)
      : {
        context: contextOrExecutionId,
        compiledProcess: this._processes.get(executionId) || null,
      };
    const context = loaded.context;
    const compiledProcess = loaded.compiledProcess || this._processes.get(executionId) || null;

    if (!context || !compiledProcess) {
      throw new Error(`Execution not found: ${executionId}`);
    }

    if (context.status === PROCESS_INSTANCE_STATUSES.WAITING && context.waitingState) {
      return this.buildResult(executionId, compiledProcess, context, null);
    }

    let lastOutput = null;
    let safety = 0;
    while (context.currentNodeId && context.status === PROCESS_INSTANCE_STATUSES.RUNNING && safety < 100) {
      safety += 1;
      const node = context.getCurrentNode(compiledProcess);
      if (!node) {
        context.status = PROCESS_INSTANCE_STATUSES.FAILED;
        await this.instanceStore.markFailed(context.executionId, new Error('node_not_found'));
        await this.emitProcessEvent('PROCESS_FAILED', {
          context,
          compiledProcess,
          payload: { reason: 'node_not_found', currentNodeId: context.currentNodeId },
        });
        break;
      }

      context.metadata = {
        ...(context.metadata || {}),
        nodeAttempts: {
          ...((context.metadata && context.metadata.nodeAttempts) || {}),
          [String(node.id)]: Number(context.metadata?.nodeAttempts?.[String(node.id)] || 0) + 1,
        },
      };

      await this.emitProcessEvent('NODE_ENTER', {
        context,
        compiledProcess,
        node,
        payload: {
          currentNodeId: context.currentNodeId,
          variablesSnapshot: clone(context.variables),
          historySnapshot: clone(context.history),
        },
      });

      let result;
      const stepInput = input;
      try {
        result = await this.executeNodeWithPolicies(node, context, compiledProcess, stepInput);
      } catch (error) {
        context.status = PROCESS_INSTANCE_STATUSES.FAILED;
        if (error?.code === 'NODE_TIMEOUT') {
          await this.emitProcessEvent('NODE_TIMEOUT', {
            context,
            compiledProcess,
            node,
            payload: {
              currentNodeId: context.currentNodeId,
              timeoutMs: error.timeoutMs || null,
              variablesSnapshot: clone(context.variables),
              historySnapshot: clone(context.history),
            },
          });
        }
        await this.emitProcessEvent('NODE_ERROR', {
          context,
          compiledProcess,
          node,
          payload: {
            error: { message: error.message || String(error), code: error.code || null },
            currentNodeId: context.currentNodeId,
            variablesSnapshot: clone(context.variables),
            historySnapshot: clone(context.history),
          },
        });
        await this.instanceStore.markFailed(context.executionId, error);
        await this.emitProcessEvent('PROCESS_FAILED', {
          context,
          compiledProcess,
          node,
          payload: { error: { message: error.message || String(error), code: error.code || null } },
        });
        await this.notifyParentIfNeeded(context, compiledProcess, {
          error: { message: error.message || String(error), code: error.code || null },
        });
        break;
      }

      lastOutput = result.output || null;
      input = null;

      if (node.type === 'gateway.exclusive') {
        await this.emitProcessEvent('GATEWAY_DECISION', {
          context,
          compiledProcess,
          node,
          payload: {
            chosenNext: result.output?.chosenNext || result.nextNodeId || null,
            currentNodeId: context.currentNodeId,
          },
        });
      }

      if (node.type === 'call.subprocess') {
        await this.emitProcessEvent('SUBPROCESS_ENTER', {
          context,
          compiledProcess,
          node,
          payload: { calledElement: result.output?.calledElement || null },
        });
      }

      if (node.type === 'task.user') {
        await this.emitProcessEvent('HUMAN_HANDOFF', {
          context,
          compiledProcess,
          node,
          payload: { queue: result.output?.queue || null },
        });
      }

      if (node.type === 'fallback') {
        await this.emitProcessEvent('NODE_FALLBACK', {
          context,
          compiledProcess,
          node,
          payload: { mode: result.output?.mode || null, target: result.output?.target || null },
        });
      }

      if (result.waiting) {
        const waitingState = this.deriveWaitingState(node, context, result, stepInput);
        context.setWaitingState(waitingState);
        await this.instanceStore.markWaiting(context.executionId, waitingState);
        await this.emitProcessEvent('NODE_WAITING', {
          context,
          compiledProcess,
          node,
          payload: {
            currentNodeId: context.currentNodeId,
            variablesSnapshot: clone(context.variables),
            historySnapshot: clone(context.history),
            waitingState,
          },
        });
        await this.persistContextSnapshot(context);
        if (node.type === 'call.subprocess' && result.output?.deferredSubprocessStart) {
          this.startDeferredSubprocess(result.output).catch(() => null);
        }
        break;
      }

      await this.emitProcessEvent('NODE_EXIT', {
        context,
        compiledProcess,
        node,
        payload: {
          currentNodeId: context.currentNodeId,
          nextNodeId: result.nextNodeId || context.currentNodeId,
          output: clone(result.output || null),
          variablesSnapshot: clone(context.variables),
          historySnapshot: clone(context.history),
        },
      });
      await this.persistContextSnapshot(context);

      if (node.type === 'call.subprocess') {
        await this.emitProcessEvent('SUBPROCESS_EXIT', {
          context,
          compiledProcess,
          node,
          payload: { currentNodeId: context.currentNodeId },
        });
      }

      if (result.completed) {
        context.status = PROCESS_INSTANCE_STATUSES.COMPLETED;
        await this.instanceStore.markCompleted(context.executionId, clone(context.metadata));
        await this.emitProcessEvent('PROCESS_COMPLETED', {
          context,
          compiledProcess,
          node,
          payload: {
            currentNodeId: null,
            output: clone(lastOutput || null),
            variablesSnapshot: clone(context.variables),
          },
        });
        this.timerService.cancelByExecutionId(context.executionId);
        await this.notifyParentIfNeeded(context, compiledProcess, lastOutput);
        break;
      }
    }

    return this.buildResult(executionId, compiledProcess, context, lastOutput);
  }

  async buildResult(executionId, compiledProcess, context, output) {
    const instance = await this.instanceStore.loadInstance(executionId);
    const events = await this.executionRepository.listEventsByExecution(executionId);
    return {
      ok: context.status !== PROCESS_INSTANCE_STATUSES.FAILED,
      runtime: 'durable-canonical',
      executionId: context.executionId,
      status: context.status,
      currentNodeId: context.currentNodeId,
      context: context.toSnapshot(),
      instance,
      output: output || null,
      events,
      observability: this.observability.getRecords({ executionId: context.executionId }),
    };
  }

  async recoverRuntimeState() {
    const recoveredTimers = await this.timerService.recoverPendingTimers();
    const resumedTimers = await this.timerService.resumeExpiredTimers();
    return {
      recoveredTimers,
      resumedTimers,
    };
  }
}

module.exports = {
  ProcessRuntimeService,
  looksLikeCompiledProcessDefinition,
  looksLikeCanonicalProcessDefinition,
  looksLikeEngineFlow,
};
