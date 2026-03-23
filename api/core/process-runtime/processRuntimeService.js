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
const {
  looksLikeCompiledProcessDefinition,
  looksLikeCanonicalProcessDefinition,
  looksLikeEngineFlow,
  clone,
  safeGet,
  safeShallowCloneRecord,
  safeCloneArray,
  safeToString,
  safeFiniteNumber,
  sanitizeRuntimeInput,
  buildProcessRegistryKey,
} = require('./processRuntimeHelpers');
const { buildExecutionResult, recoverRuntimeTimers } = require('./processRuntimeResult');
const { loadRuntimeExecutionContext } = require('./processRuntimeContextLoader');
const { getNodeTimeoutMs, executeWithTimeout } = require('./processRuntimeTimeoutPolicy');
const { executeNodeWithIdempotency } = require('./processRuntimeIdempotency');
const { handleMissingNodeFailure } = require('./processRuntimeMissingNodeFailure');
const { setupNextNodeExecution } = require('./processRuntimeNextNodeSetup');
const { executeRuntimeNodeStep } = require('./processRuntimeNodeStep');
const {
  resolveCalledElement,
  isSubprocessResumeInput,
  isAsyncSubprocessNode,
  buildChildExecutionId,
  buildResolvedSubprocessResult,
  buildSubprocessMissingChildResult,
  buildSubprocessChildInput,
  applyAsyncSubprocessMetadata,
  buildAsyncSubprocessResult,
  buildSyncSubprocessResult,
  buildParentResumePayload,
} = require('./processRuntimeSubprocess');

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
    const safeCompiled = safeShallowCloneRecord(compiledProcess);
    const processId = safeToString(safeGet(safeCompiled, 'id', ''), '');
    if (!processId) return null;
    const processVersion = safeFiniteNumber(safeGet(safeCompiled, 'version', 1), 1);
    const key = buildProcessRegistryKey(processId, processVersion);
    this._processRegistry.set(key, compiledProcess);
    return compiledProcess;
  }

  async resolveCompiledProcessForInstance(instance) {
    const safeInstance = safeShallowCloneRecord(instance);
    const processId = safeToString(safeGet(safeInstance, 'processId', ''), '');
    if (!processId) return null;
    const processVersion = safeFiniteNumber(safeGet(safeInstance, 'processVersion', 1), 1);
    const key = buildProcessRegistryKey(processId, processVersion);
    if (this._processRegistry.has(key)) {
      return this._processRegistry.get(key);
    }

    if (this.compiledProcessRepository && typeof this.compiledProcessRepository.loadCompiledProcess === 'function') {
      const metadata = safeShallowCloneRecord(safeGet(safeInstance, 'metadata', null));
      const tenantId = safeGet(metadata, 'tenantId', null) || null;
      try {
        const persisted = await this.compiledProcessRepository.loadCompiledProcess({
          tenantId,
          processId,
          processVersion,
        });
        if (persisted) {
          this.registerCompiledProcess(persisted);
          return persisted;
        }
      } catch (_) {
        // Best-effort fallback to custom resolver below.
      }
    }

    if (this.compiledProcessResolver) {
      try {
        const resolved = await this.compiledProcessResolver({
          executionId: safeToString(safeGet(safeInstance, 'executionId', ''), ''),
          processId,
          processVersion,
          instance: safeInstance,
        });
        if (resolved) {
          this.registerCompiledProcess(resolved);
          return resolved;
        }
      } catch (_) {
        return null;
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
    return loadRuntimeExecutionContext({
      executionId,
      contexts: this._contexts,
      processes: this._processes,
      instanceStore: this.instanceStore,
      executionRepository: this.executionRepository,
      replayService: this.replayService,
      resolveCompiledProcessForInstance: (instance) => this.resolveCompiledProcessForInstance(instance),
    });
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

  async executeNodeWithPolicies(node, context, compiledProcess, input) {
    const timeoutMs = getNodeTimeoutMs(node, compiledProcess);
    return executeWithTimeout({
      timeoutMs,
      nodeId: node.id,
      execute: () => this.executeNodeWithIdempotency(node, context, compiledProcess, input),
    });
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
    const calledElement = resolveCalledElement(node);
    if (isSubprocessResumeInput(input)) {
      return buildResolvedSubprocessResult({ node, context, input, calledElement, clone });
    }

    const compiledChild = await this.resolveSubprocessDefinition(calledElement, context);
    const childExecutionId = buildChildExecutionId({ context, node, input });

    if (!compiledChild) {
      return buildSubprocessMissingChildResult({ node, context, calledElement, childExecutionId });
    }

    const childInput = buildSubprocessChildInput({
      context,
      node,
      input,
      childExecutionId,
      calledElement,
      clone,
    });

    const childResult = await this.startProcess(compiledChild, childInput, { allowEngineFlow: false });

    if (isAsyncSubprocessNode(node)) {
      applyAsyncSubprocessMetadata({ context, node, compiledChild, childExecutionId });
      return buildAsyncSubprocessResult({
        context,
        calledElement,
        childExecutionId,
        compiledChild,
        childInput,
      });
    }

    return buildSyncSubprocessResult({ node, context, calledElement, childExecutionId, childResult });
  }

  async notifyParentIfNeeded(context, compiledProcess, output) {
    const parentExecutionId = context.metadata?.parentExecutionId || null;
    const parentCorrelationKey = context.metadata?.parentCorrelationKey || null;
    if (!parentExecutionId || !parentCorrelationKey) return null;
    try {
      return await this.resumeService.resumeExternalEvent(
        parentCorrelationKey,
        buildParentResumePayload({ context, compiledProcess, output: output || null }),
      );
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
    return executeNodeWithIdempotency({
      node,
      context,
      compiledProcess,
      input,
      stateMachine: this.stateMachine,
      idempotencyService: this.idempotencyService,
      contexts: this._contexts,
      ProcessExecutionContext,
      clone,
    });
  }

  async executeNextNode(contextOrExecutionId, input = {}) {
    const prepared = await setupNextNodeExecution({
      contextOrExecutionId,
      input,
      sanitizeRuntimeInput,
      loadContextForExecution: (executionId) => this.loadContextForExecution(executionId),
      processes: this._processes,
      buildResult: (executionId, compiledProcess, context, output) => this.buildResult(executionId, compiledProcess, context, output),
      PROCESS_INSTANCE_STATUSES,
    });

    input = prepared.input;
    const { executionId, context, compiledProcess, earlyResult } = prepared;
    if (earlyResult) {
      return earlyResult;
    }

    let lastOutput = null;
    let safety = 0;
    while (context.currentNodeId && context.status === PROCESS_INSTANCE_STATUSES.RUNNING && safety < 100) {
      safety += 1;
      const node = context.getCurrentNode(compiledProcess);
      if (!node) {
        await handleMissingNodeFailure({
          context,
          compiledProcess,
          instanceStore: this.instanceStore,
          emitProcessEvent: (eventType, payload) => this.emitProcessEvent(eventType, payload),
        });
        break;
      }

      const step = await executeRuntimeNodeStep({
        node,
        context,
        compiledProcess,
        input,
        lastOutput,
        runtime: {
          executeNodeWithPolicies: (currentNode, currentContext, currentProcess, stepInput) => this.executeNodeWithPolicies(currentNode, currentContext, currentProcess, stepInput),
          instanceStore: this.instanceStore,
          emitProcessEvent: (eventType, payload) => this.emitProcessEvent(eventType, payload),
          notifyParentIfNeeded: (ctx, proc, output) => this.notifyParentIfNeeded(ctx, proc, output),
          persistContextSnapshot: (ctx) => this.persistContextSnapshot(ctx),
          startDeferredSubprocess: (output) => this.startDeferredSubprocess(output),
          timerService: this.timerService,
        },
      });

      lastOutput = step.lastOutput;
      input = step.nextInput;
      if (step.shouldBreak) {
        break;
      }
    }

    return this.buildResult(executionId, compiledProcess, context, lastOutput);
  }

  async buildResult(executionId, compiledProcess, context, output) {
    return buildExecutionResult({
      executionId,
      context,
      output,
      instanceStore: this.instanceStore,
      executionRepository: this.executionRepository,
      observability: this.observability,
    });
  }

  async recoverRuntimeState() {
    return recoverRuntimeTimers(this.timerService);
  }
}

module.exports = {
  ProcessRuntimeService,
  looksLikeCompiledProcessDefinition,
  looksLikeCanonicalProcessDefinition,
  looksLikeEngineFlow,
};
