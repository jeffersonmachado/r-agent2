'use strict';

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

function safeFiniteNumber(value, fallbackValue = 0) {
  const coerced = Number(value);
  return Number.isFinite(coerced) ? coerced : fallbackValue;
}

function safeIsArray(value) {
  try {
    return Array.isArray(value);
  } catch (_) {
    return false;
  }
}

function safeArrayCopy(value) {
  if (!safeIsArray(value)) return [];
  try {
    return value.slice();
  } catch (_) {
    return [];
  }
}

function safeEntries(value) {
  if (!value || typeof value !== 'object') return [];
  try {
    return Object.entries(value);
  } catch (_) {
    return [];
  }
}

function safeShallowCloneRecord(value) {
  if (!value || typeof value !== 'object') return {};
  try {
    return { ...value };
  } catch (_) {
    return {};
  }
}

function safeNodeId(value, fallbackValue = '') {
  const nodeId = safeToString(value, fallbackValue);
  return nodeId || fallbackValue;
}

function safeOptionalNodeId(value) {
  if (value == null) return null;
  const nodeId = safeToString(value, '');
  return nodeId || null;
}

function safeEdgePriority(value, fallbackValue = 0) {
  return safeFiniteNumber(value, fallbackValue);
}

function inferCanonicalType(nodeType) {
  switch (safeToString(nodeType || '', '')) {
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
  const targets = safeIsArray(nextValue) ? safeArrayCopy(nextValue) : [nextValue];
  const sourceId = safeNodeId(nodeId, '');
  const sourcePort = safeToString(port, 'out') || 'out';
  return targets
    .filter((target) => target != null && safeToString(target, '').trim() !== '')
    .map((target, index) => ({
      id: `${sourceId}:${sourcePort}:${safeToString(target, '')}:${index}`,
      source: sourceId,
      target: safeToString(target, ''),
      condition: null,
      priority: index,
      eventTrigger: null,
      metadata: { sourcePort },
    }));
}

function engineFlowToCanonicalProcess(flow) {
  const nodes = safeArrayCopy(safeGet(flow, 'nodes', []));
  const canonicalNodes = nodes.map((node, index) => {
    const id = safeNodeId(safeGet(node, 'id', null), `node-${index}`);
    const type = safeGet(node, 'type', '');
    return {
      id,
      type: inferCanonicalType(type),
      subtype: safeToString(type || '', ''),
      label: safeToString(type || id, id),
      config: safeShallowCloneRecord(safeGet(node, 'config', null)),
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
          engineType: safeToString(type || '', ''),
        },
      },
    };
  });

  const canonicalEdges = [];
  nodes.forEach((node) => {
    const nodeId = safeNodeId(safeGet(node, 'id', null), '');
    const next = safeGet(node, 'next', null);
    if (!next) return;
    if (typeof next === 'string' || safeIsArray(next)) {
      canonicalEdges.push(...buildEdgesFromNext(nodeId, next, 'out'));
      return;
    }
    if (typeof next === 'object') {
      safeEntries(next).forEach(([port, target]) => {
        canonicalEdges.push(...buildEdgesFromNext(nodeId, target, port));
      });
    }
  });

  return {
    id: safeToString(safeGet(flow, 'id', 'process'), 'process') || 'process',
    name: safeToString(safeGet(flow, 'name', 'Process'), 'Process') || 'Process',
    version: safeFiniteNumber(safeGet(flow, 'version', 1), 1),
    metadata: {
      tenantId: safeGet(flow, 'tenantId', null),
      kind: safeGet(flow, 'kind', 'chat') || 'chat',
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
  const nodes = safeArrayCopy(safeGet(process, 'nodes', []));
  const edges = safeArrayCopy(safeGet(process, 'edges', []));
  const nodesById = {};
  nodes.forEach((node, index) => {
    const id = safeNodeId(safeGet(node, 'id', null), `node-${index}`);
    nodesById[id] = node;
  });
  const edgesBySource = {};

  edges
    .slice()
    .sort((a, b) => {
      const aSource = safeToString(safeGet(a, 'source', ''), '');
      const bSource = safeToString(safeGet(b, 'source', ''), '');
      if (aSource !== bSource) return aSource.localeCompare(bSource);
      return safeEdgePriority(safeGet(a, 'priority', 0), 0) - safeEdgePriority(safeGet(b, 'priority', 0), 0);
    })
    .forEach((edge) => {
      const source = safeToString(safeGet(edge, 'source', ''), '');
      if (!source) return;
      if (!edgesBySource[source]) edgesBySource[source] = [];
      edgesBySource[source].push(edge);
    });

  const entrypoints = safeArrayCopy(safeGet(process, 'entrypoints', [])).map((entry) => safeToString(entry, '')).filter(Boolean);
  const fallbackStartNode = safeGet((nodes.find((node) => safeToString(safeGet(node, 'type', ''), '') === 'start') || {}), 'id', null);

  return {
    id: safeToString(safeGet(process, 'id', 'process'), 'process') || 'process',
    name: safeToString(safeGet(process, 'name', 'Process'), 'Process') || 'Process',
    version: safeFiniteNumber(safeGet(process, 'version', 1), 1),
    metadata: safeShallowCloneRecord(safeGet(process, 'metadata', null)),
    canonical: process,
    nodes,
    edges,
    entrypoints,
    policies: safeShallowCloneRecord(safeGet(process, 'policies', null)),
    aiConfig: safeShallowCloneRecord(safeGet(process, 'aiConfig', null)),
    operationalConfig: safeShallowCloneRecord(safeGet(process, 'operationalConfig', null)),
    executionGraph: {
      nodesById,
      edgesBySource,
      startNode: (entrypoints[0] || safeOptionalNodeId(fallbackStartNode)),
    },
  };
}

module.exports = {
  engineFlowToCanonicalProcess,
  compileCanonicalProcessDefinition,
};
