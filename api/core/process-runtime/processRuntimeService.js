'use strict';

const { executeStep: executeStepEngine } = require('../../../engine/executeStep');
const { compileFlow } = require('../../../engine/compileFlow');
const { getOrCompileFlow } = require('../../../engine/compiledFlowCache');
const { ProcessEventBus } = require('./processEventBus');
const { ProcessObservabilityService } = require('./processObservabilityService');

const CANONICAL_TO_ENGINE_TYPE = Object.freeze({
  start: 'start',
  end: 'end',
  'task.service': 'api',
  'task.ai': 'ai_task',
  'task.script': 'set_variable',
  'task.user': 'handoff',
  'task.message.send': 'message',
  'task.message.receive': 'user_input',
  'gateway.exclusive': 'router',
  'wait.timer': 'delay',
  'call.subprocess': 'subflow',
  fallback: 'fallback',
  'variable.set': 'set_variable',
  'utility.transform': 'set_variable',
  'utility.time': 'get_current_time',
  'utility.uuid': 'generate_uuid',
  'utility.random': 'random_number',
});

function mapCanonicalType(type) {
  return CANONICAL_TO_ENGINE_TYPE[String(type || '').trim()] || 'api';
}

function groupEdgesBySource(edges = []) {
  const map = new Map();
  edges.forEach((edge) => {
    if (!edge || !edge.source || !edge.target) return;
    if (!map.has(edge.source)) map.set(edge.source, []);
    map.get(edge.source).push(edge);
  });

  map.forEach((value, key) => {
    map.set(key, value.slice().sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0)));
  });

  return map;
}

function resolveNextForNode(canonicalNode, outgoingEdges = []) {
  if (!Array.isArray(outgoingEdges) || outgoingEdges.length === 0) return null;
  if (outgoingEdges.length === 1 && !outgoingEdges[0]?.condition) return outgoingEdges[0].target;

  if (canonicalNode?.type === 'gateway.exclusive') {
    const nextMap = {};
    outgoingEdges.forEach((edge, index) => {
      const key = edge?.condition?.port || edge?.condition?.expression || (index === outgoingEdges.length - 1 ? 'default' : `rule_${index}`);
      nextMap[String(key)] = edge.target;
    });
    return nextMap;
  }

  return outgoingEdges.map((edge) => edge.target);
}

function canonicalToEngineFlow(processDefinition = {}) {
  const nodes = Array.isArray(processDefinition.nodes) ? processDefinition.nodes : [];
  const edges = Array.isArray(processDefinition.edges) ? processDefinition.edges : [];
  const edgesBySource = groupEdgesBySource(edges);

  return {
    tenantId: processDefinition?.metadata?.tenantId || processDefinition?.tenantId || 'demo-tenant',
    id: processDefinition.id || 'canonical_process',
    name: processDefinition.name || 'Canonical Process',
    version: Number.isFinite(Number(processDefinition.version)) ? Number(processDefinition.version) : 1,
    metadata: {
      ...(processDefinition.metadata && typeof processDefinition.metadata === 'object' ? processDefinition.metadata : {}),
      canonicalSource: true,
    },
    nodes: nodes.map((node) => ({
      id: String(node.id),
      type: mapCanonicalType(node.type),
      config: node?.config && typeof node.config === 'object' ? node.config : {},
      next: resolveNextForNode(node, edgesBySource.get(node.id) || []),
    })),
  };
}

function isCanonicalProcessDefinition(value) {
  return !!(
    value
    && typeof value === 'object'
    && Array.isArray(value.nodes)
    && Array.isArray(value.edges)
    && Array.isArray(value.entrypoints)
  );
}

class ProcessRuntimeService {
  constructor({
    executeStepImpl,
    compileFlowImpl,
    getOrCompileFlowImpl,
    eventBus,
    observabilityService,
  } = {}) {
    this.executeStepImpl = executeStepImpl || executeStepEngine;
    this.compileFlowImpl = compileFlowImpl || compileFlow;
    this.getOrCompileFlowImpl = getOrCompileFlowImpl || getOrCompileFlow;
    this.eventBus = eventBus || new ProcessEventBus();
    this.observabilityService = observabilityService || new ProcessObservabilityService({ eventBus: this.eventBus });
  }

  prepareCompiledFlow(processDefinition) {
    if (!processDefinition || typeof processDefinition !== 'object') {
      throw new Error('ProcessRuntimeService.prepareCompiledFlow: processDefinition is required');
    }

    if (isCanonicalProcessDefinition(processDefinition)) {
      const engineFlow = canonicalToEngineFlow(processDefinition);
      return {
        compiledFlow: this.compileFlowImpl(engineFlow),
        format: 'canonical',
        sourceFlow: engineFlow,
      };
    }

    const compiledFlow = this.getOrCompileFlowImpl(processDefinition);
    return {
      compiledFlow,
      format: 'legacy',
      sourceFlow: processDefinition,
    };
  }

  async executeStep(state, processDefinition, options = {}) {
    const prepared = this.prepareCompiledFlow(processDefinition);
    const startTime = new Date().toISOString();

    let result;
    let status = 'ok';
    let error = null;

    try {
      result = await this.executeStepImpl(state, prepared.compiledFlow, options);
      return {
        ...result,
        runtime: {
          format: prepared.format,
          processId: prepared.sourceFlow.id,
          processVersion: prepared.sourceFlow.version,
        },
      };
    } catch (err) {
      status = 'error';
      error = err;
      throw err;
    } finally {
      this.observabilityService.recordStep({
        processId: prepared?.sourceFlow?.id,
        processVersion: prepared?.sourceFlow?.version,
        sessionId: state?.sessionId,
        nodeId: state?.currentNodeId,
        startedAt: startTime,
        endedAt: new Date().toISOString(),
        status,
        error: error ? String(error.message || error) : null,
      });
    }
  }
}

module.exports = {
  ProcessRuntimeService,
  canonicalToEngineFlow,
  isCanonicalProcessDefinition,
};
