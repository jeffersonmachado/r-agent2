'use strict';

function inferCanonicalType(nodeType) {
  switch (String(nodeType || '')) {
    case 'start':
      return 'start';
    case 'end':
      return 'end';
    case 'message':
      return 'task.message.send';
    case 'user_input':
      return 'task.message.receive';
    case 'router':
    case 'schedule_router':
    case 'semantic_router':
    case 'options':
      return 'gateway.exclusive';
    case 'subflow':
      return 'call.subprocess';
    case 'fallback':
      return 'fallback';
    case 'handoff':
      return 'task.user';
    case 'api':
    case 'get_flow_info':
    case 'get_queue_status':
    case 'get_config_value':
    case 'list_flows':
    case 'get_user_info':
      return 'task.service';
    case 'ai':
    case 'ai_task':
    case 'rag_answer':
    case 'business_entry':
      return 'task.ai';
    case 'delay':
      return 'wait.timer';
    case 'set_variable':
      return 'variable.set';
    case 'get_current_time':
      return 'utility.time';
    case 'generate_uuid':
      return 'utility.uuid';
    case 'random_number':
      return 'utility.random';
    case 'format_date':
    case 'merge':
    default:
      return 'utility.transform';
  }
}

function buildEdgesFromNext(nodeId, nextValue, port = 'out') {
  if (nextValue == null) return [];
  const targets = Array.isArray(nextValue) ? nextValue : [nextValue];
  return targets
    .filter((target) => target != null && String(target).trim() !== '')
    .map((target, index) => ({
      id: `${String(nodeId)}:${String(port)}:${String(target)}:${index}`,
      source: String(nodeId),
      target: String(target),
      condition: null,
      priority: index,
      eventTrigger: null,
      metadata: { sourcePort: String(port) },
    }));
}

function engineFlowToCanonicalProcess(flow) {
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const canonicalNodes = nodes.map((node) => ({
    id: String(node.id),
    type: inferCanonicalType(node.type),
    subtype: String(node.type || ''),
    label: String(node.type || node.id),
    config: node?.config && typeof node.config === 'object' ? { ...node.config } : {},
    inputSchema: {},
    outputSchema: {},
    retryPolicy: {},
    timeoutPolicy: {},
    fallbackPolicy: {},
    humanHandoffPolicy: {},
    aiPolicy: {},
    observability: {},
    metadata: {
      adapter: {
        sourceFormat: 'engine',
        engineType: String(node.type || ''),
      },
    },
  }));

  const canonicalEdges = [];
  nodes.forEach((node) => {
    const next = node?.next;
    if (!next) return;
    if (typeof next === 'string' || Array.isArray(next)) {
      canonicalEdges.push(...buildEdgesFromNext(node.id, next, 'out'));
      return;
    }
    if (typeof next === 'object') {
      Object.entries(next).forEach(([port, target]) => {
        canonicalEdges.push(...buildEdgesFromNext(node.id, target, port));
      });
    }
  });

  return {
    id: String(flow?.id || 'process'),
    name: String(flow?.name || 'Process'),
    version: Number.isFinite(Number(flow?.version)) ? Number(flow.version) : 1,
    metadata: {
      tenantId: flow?.tenantId || null,
      kind: flow?.kind || 'chat',
      sourceFormat: 'engine',
    },
    nodes: canonicalNodes,
    edges: canonicalEdges,
    entrypoints: canonicalNodes.filter((node) => node.type === 'start').map((node) => node.id),
    policies: {},
    aiConfig: {},
    operationalConfig: {},
  };
}

function compileCanonicalProcessDefinition(definition) {
  const process = definition && typeof definition === 'object' ? definition : {};
  const nodes = Array.isArray(process.nodes) ? process.nodes.slice() : [];
  const edges = Array.isArray(process.edges) ? process.edges.slice() : [];
  const nodesById = Object.fromEntries(nodes.map((node) => [String(node.id), node]));
  const edgesBySource = {};

  edges
    .slice()
    .sort((a, b) => {
      if (String(a.source) !== String(b.source)) return String(a.source).localeCompare(String(b.source));
      return Number(a.priority || 0) - Number(b.priority || 0);
    })
    .forEach((edge) => {
      const source = String(edge.source);
      if (!edgesBySource[source]) edgesBySource[source] = [];
      edgesBySource[source].push(edge);
    });

  return {
    id: String(process.id || 'process'),
    name: String(process.name || 'Process'),
    version: Number.isFinite(Number(process.version)) ? Number(process.version) : 1,
    metadata: process.metadata && typeof process.metadata === 'object' ? { ...process.metadata } : {},
    canonical: process,
    nodes,
    edges,
    entrypoints: Array.isArray(process.entrypoints) ? process.entrypoints.slice() : [],
    policies: process.policies && typeof process.policies === 'object' ? { ...process.policies } : {},
    aiConfig: process.aiConfig && typeof process.aiConfig === 'object' ? { ...process.aiConfig } : {},
    operationalConfig: process.operationalConfig && typeof process.operationalConfig === 'object' ? { ...process.operationalConfig } : {},
    executionGraph: {
      nodesById,
      edgesBySource,
      startNode: (Array.isArray(process.entrypoints) && process.entrypoints[0]) || (nodes.find((node) => node.type === 'start') || {}).id || null,
    },
  };
}

module.exports = {
  engineFlowToCanonicalProcess,
  compileCanonicalProcessDefinition,
};
