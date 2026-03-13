'use strict';

const { Flow } = require('../db/models');
const { ProcessRuntimeService } = require('../core/process-runtime/processRuntimeService');
const { compileCanonicalProcessDefinition, engineFlowToCanonicalProcess } = require('../core/process-runtime/processCanonicalAdapter');
const { ProcessAnalyticsService } = require('../core/process-analytics/processAnalyticsService');
const { ProcessBottleneckService } = require('../core/process-analytics/processBottleneckService');
const { ProcessVersionComparisonService } = require('../core/process-analytics/processVersionComparisonService');
const { ProcessSimulationService } = require('../core/process-simulation/processSimulationService');
const { ProcessOptimizationService } = require('../core/process-intelligence/processOptimizationService');

let runtimeSingleton = null;
let recoveryPromise = null;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function resolveFlowProcessDefinition({ tenantId = null, processId, processVersion = null } = {}) {
  if (!processId) return null;
  const flowModel = Flow();
  const row = await flowModel.findOne({
    where: tenantId != null
      ? { tenant_key: String(tenantId), id: String(processId) }
      : { id: String(processId) },
  });
  if (!row) return null;
  const flow = row.toJSON ? row.toJSON() : row;
  const data = flow.data && typeof flow.data === 'object' ? flow.data : {};
  if (data?.durableRuntime?.compiledProcess) {
    return clone(data.durableRuntime.compiledProcess);
  }
  if (data?.compiledProcess) {
    return clone(data.compiledProcess);
  }
  if (Array.isArray(data?.nodes)) {
    const sourceDefinition = Array.isArray(data?.edges)
      ? {
          ...data,
          id: processId,
          version: processVersion || data.version || 1,
          metadata: {
            ...(data.metadata || {}),
            tenantId: tenantId || flow.tenant_key || null,
          },
        }
      : engineFlowToCanonicalProcess({
          ...data,
          id: processId,
          version: processVersion || data.version || 1,
          tenantId: tenantId || flow.tenant_key || null,
        });
    const compiled = compileCanonicalProcessDefinition(sourceDefinition);
    return compiled;
  }
  return null;
}

function getRuntime() {
  if (!runtimeSingleton) {
    runtimeSingleton = new ProcessRuntimeService({
      compiledProcessResolver: async ({ processId, processVersion, instance }) => resolveFlowProcessDefinition({
        tenantId: instance?.metadata?.tenantId || null,
        processId,
        processVersion,
      }),
    });
  }
  return runtimeSingleton;
}

async function ensureRecovered() {
  const runtime = getRuntime();
  if (!recoveryPromise) {
    recoveryPromise = runtime.recoverRuntimeState().catch((error) => ({
      recoveredTimers: [],
      resumedTimers: [],
      error: error?.message || String(error),
    }));
  }
  return recoveryPromise;
}

async function startDurableProcess({ tenantId = null, processId = null, processDefinition = null, input = {}, options = {} } = {}) {
  const runtime = getRuntime();
  await ensureRecovered();
  let definition = processDefinition;
  if (!definition && processId) {
    definition = await resolveFlowProcessDefinition({
      tenantId,
      processId,
      processVersion: input?.processVersion || null,
    });
  }
  if (!definition) {
    return { ok: false, error: 'process_definition_not_found' };
  }
  const result = await runtime.startProcess(definition, {
    ...input,
    tenantId: tenantId || input?.tenantId || null,
  }, options);
  return { ok: true, ...result };
}

async function listProcessInstances(filters = {}) {
  const runtime = getRuntime();
  await ensureRecovered();
  const items = await runtime.inspector.listInstances(filters);
  return { ok: true, items };
}

async function getProcessInstance(executionId, tenantId = null) {
  const runtime = getRuntime();
  await ensureRecovered();
  const instance = await runtime.inspector.getInstanceState(executionId);
  if (!instance) return { ok: false, error: 'execution_not_found' };
  if (tenantId != null && String(instance.metadata?.tenantId || '') !== String(tenantId)) {
    return { ok: false, error: 'execution_not_found' };
  }
  const history = await runtime.inspector.getExecutionHistory(executionId);
  const waitingState = await runtime.inspector.getCurrentWaitingState(executionId);
  const stopped = await runtime.inspector.explainWhyStopped(executionId);
  const path = await runtime.inspector.getExecutionPath(executionId);
  return {
    ok: true,
    instance,
    history,
    waitingState,
    stopped,
    path,
  };
}

function filterExecutionHistory(events = [], filters = {}) {
  const eventType = filters?.eventType ? String(filters.eventType).trim() : '';
  const nodeId = filters?.nodeId ? String(filters.nodeId).trim() : '';
  const limit = Number.isFinite(Number(filters?.limit)) ? Number(filters.limit) : null;
  let filtered = Array.isArray(events) ? [...events] : [];
  if (eventType) {
    filtered = filtered.filter((item) => String(item?.eventType || '') === eventType);
  }
  if (nodeId) {
    filtered = filtered.filter((item) => String(item?.nodeId || '') === nodeId);
  }
  if (limit != null && limit > 0) {
    filtered = filtered.slice(-limit);
  }
  return filtered;
}

async function getProcessInstanceHistory(executionId, tenantId = null, filters = {}) {
  const runtime = getRuntime();
  await ensureRecovered();
  const instance = await runtime.inspector.getInstanceState(executionId);
  if (!instance) return { ok: false, error: 'execution_not_found' };
  if (tenantId != null && String(instance.metadata?.tenantId || '') !== String(tenantId)) {
    return { ok: false, error: 'execution_not_found' };
  }
  const history = await runtime.inspector.getExecutionHistory(executionId);
  return {
    ok: true,
    history: filterExecutionHistory(history, filters),
  };
}

async function cancelProcessInstance(executionId, reason = 'cancelled', metadata = {}, tenantId = null) {
  const runtime = getRuntime();
  await ensureRecovered();
  if (tenantId != null) {
    const instance = await runtime.inspector.getInstanceState(executionId);
    if (!instance || String(instance.metadata?.tenantId || '') !== String(tenantId)) {
      return { ok: false, error: 'execution_not_found' };
    }
  }
  return runtime.cancelProcess(executionId, reason, metadata);
}

async function resumeProcessInstance(executionId, payload = {}, tenantId = null) {
  const runtime = getRuntime();
  await ensureRecovered();
  if (tenantId != null) {
    const instance = await runtime.inspector.getInstanceState(executionId);
    if (!instance || String(instance.metadata?.tenantId || '') !== String(tenantId)) {
      return { ok: false, error: 'execution_not_found' };
    }
  }
  return runtime.resumeProcess(executionId, payload);
}

async function resumeExternalProcessEvent(correlationKey, payload = {}, tenantId = null) {
  const runtime = getRuntime();
  await ensureRecovered();
  if (tenantId != null) {
    const waiting = await runtime.instanceStore.listWaitingInstances({ correlationKey });
    const match = waiting.find((item) => String(item.metadata?.tenantId || '') === String(tenantId));
    if (!match) {
      return { ok: false, error: 'execution_not_found' };
    }
  }
  return runtime.resumeService.resumeExternalEvent(correlationKey, payload);
}

async function resolveDefinitionForAnalysis({ tenantId = null, processId = null, processDefinition = null, processVersion = null } = {}) {
  if (processDefinition) return processDefinition;
  if (!processId) return null;
  return resolveFlowProcessDefinition({ tenantId, processId, processVersion });
}

async function listEventsForProcess(runtime, { tenantId = null, processId, limit = 500 } = {}) {
  const instances = await runtime.inspector.listInstances({
    tenantId,
    processId,
    limit,
  });
  const events = [];
  for (const item of instances) {
    // eslint-disable-next-line no-await-in-loop
    const executionEvents = await runtime.executionRepository.listEventsByExecution(item.executionId);
    events.push(...executionEvents);
  }
  return events;
}

async function getProcessAnalytics({ tenantId = null, processId, limit = 500 } = {}) {
  const runtime = getRuntime();
  await ensureRecovered();
  const analyticsService = new ProcessAnalyticsService();
  const bottleneckService = new ProcessBottleneckService();
  const versionComparisonService = new ProcessVersionComparisonService();
  const events = await listEventsForProcess(runtime, { tenantId, processId, limit });
  const analytics = analyticsService.buildAnalytics(events);
  const bottlenecks = bottleneckService.identifyBottlenecks(analytics.nodes);
  const byVersion = new Map();

  analytics.process.executions.forEach((item) => {
    const key = Number(item.processVersion || 1);
    if (!byVersion.has(key)) byVersion.set(key, []);
    byVersion.get(key).push(item);
  });

  const versions = Array.from(byVersion.keys()).sort((a, b) => a - b);
  let comparison = null;
  if (versions.length >= 2) {
    const currentVersion = versions[versions.length - 1];
    const previousVersion = versions[versions.length - 2];
    const toMetrics = (executionItems, version) => {
      const durations = executionItems.map((item) => Number(item.durationMs || 0));
      const completed = executionItems.filter((item) => item.status === 'completed').length;
      const failed = executionItems.filter((item) => item.status === 'failed').length;
      return {
        version,
        totalExecutions: executionItems.length,
        successRate: executionItems.length > 0 ? completed / executionItems.length : 0,
        failureRate: executionItems.length > 0 ? failed / executionItems.length : 0,
        averageDurationMs: durations.length > 0 ? durations.reduce((acc, value) => acc + value, 0) / durations.length : 0,
        p95DurationMs: durations.length > 0 ? durations.sort((a, b) => a - b)[Math.max(0, durations.length - 1)] : 0,
      };
    };
    comparison = versionComparisonService.compareVersions(
      { process: toMetrics(byVersion.get(currentVersion), currentVersion) },
      { process: toMetrics(byVersion.get(previousVersion), previousVersion) },
    );
  }

  return {
    ok: true,
    processId,
    analytics,
    bottlenecks,
    comparison,
  };
}

async function simulateProcessDefinition({ tenantId = null, processId = null, processDefinition = null, processVersion = null } = {}) {
  await ensureRecovered();
  const definition = await resolveDefinitionForAnalysis({ tenantId, processId, processDefinition, processVersion });
  if (!definition) return { ok: false, error: 'process_definition_not_found' };
  const simulationService = new ProcessSimulationService();
  return {
    ok: true,
    simulation: simulationService.simulateProcess(definition),
  };
}

async function getProcessIntelligence({ tenantId = null, processId = null, processDefinition = null, processVersion = null, limit = 500 } = {}) {
  const runtime = getRuntime();
  await ensureRecovered();
  const definition = await resolveDefinitionForAnalysis({ tenantId, processId, processDefinition, processVersion });
  if (!definition) return { ok: false, error: 'process_definition_not_found' };
  const compiledProcess = runtime.ensureCompiledProcess(definition);
  const analyticsResult = processId
    ? await getProcessAnalytics({ tenantId, processId, limit })
    : { analytics: { process: {}, nodes: [], gateways: [] }, bottlenecks: [] };
  const analytics = analyticsResult.analytics;
  const bottlenecks = analyticsResult.bottlenecks;
  const simulation = new ProcessSimulationService().simulateProcess(compiledProcess);
  const optimization = new ProcessOptimizationService().optimize({
    compiledProcess,
    analytics: { ...analytics, bottlenecks },
    simulation,
  });
  return {
    ok: true,
    simulation,
    analytics,
    bottlenecks,
    intelligence: optimization,
  };
}

module.exports = {
  getRuntime,
  ensureRecovered,
  startDurableProcess,
  listProcessInstances,
  getProcessInstance,
  getProcessInstanceHistory,
  cancelProcessInstance,
  resumeProcessInstance,
  resumeExternalProcessEvent,
  getProcessAnalytics,
  simulateProcessDefinition,
  getProcessIntelligence,
};
