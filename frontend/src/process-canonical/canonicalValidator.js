import {
  CANONICAL_NODE_TYPES,
  TERMINAL_NODE_TYPES,
  ISSUE_SEVERITY,
  createCanonicalIssue,
  createCanonicalValidationReport,
} from './canonicalTypes';

function buildAdjacency(edges = []) {
  const outgoing = new Map();
  const incoming = new Map();

  edges.forEach((edge) => {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  });

  return { outgoing, incoming };
}

function dfsReachable(startIds, outgoing) {
  const visited = new Set();
  const stack = [...startIds];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const nextEdges = outgoing.get(current) || [];
    nextEdges.forEach((edge) => {
      if (edge?.target && !visited.has(edge.target)) {
        stack.push(edge.target);
      }
    });
  }

  return visited;
}

function detectCycles(nodeIds, outgoing) {
  const visited = new Set();
  const inStack = new Set();
  const cycles = [];

  function walk(nodeId, trail = []) {
    if (inStack.has(nodeId)) {
      cycles.push([...trail, nodeId]);
      return;
    }
    if (visited.has(nodeId)) return;

    visited.add(nodeId);
    inStack.add(nodeId);

    const edges = outgoing.get(nodeId) || [];
    edges.forEach((edge) => walk(edge.target, [...trail, nodeId]));

    inStack.delete(nodeId);
  }

  nodeIds.forEach((nodeId) => walk(nodeId, []));
  return cycles;
}

function hasTerminalPath(nodeId, outgoing, nodeById, memo = new Map(), stack = new Set()) {
  if (memo.has(nodeId)) return memo.get(nodeId);
  if (stack.has(nodeId)) return false;

  const node = nodeById.get(nodeId);
  if (!node) return false;
  if (TERMINAL_NODE_TYPES.has(node.type)) {
    memo.set(nodeId, true);
    return true;
  }

  const edges = outgoing.get(nodeId) || [];
  if (edges.length === 0) {
    memo.set(nodeId, false);
    return false;
  }

  stack.add(nodeId);
  const result = edges.some((edge) => hasTerminalPath(edge.target, outgoing, nodeById, memo, stack));
  stack.delete(nodeId);

  memo.set(nodeId, result);
  return result;
}

export function validateCanonicalProcess(canonicalProcess = {}) {
  const report = createCanonicalValidationReport();
  const nodes = Array.isArray(canonicalProcess.nodes) ? canonicalProcess.nodes : [];
  const edges = Array.isArray(canonicalProcess.edges) ? canonicalProcess.edges : [];
  const entrypoints = Array.isArray(canonicalProcess.entrypoints) ? canonicalProcess.entrypoints : [];

  if (nodes.length === 0) {
    report.errors.push(createCanonicalIssue({
      code: 'canonical_no_nodes',
      message: 'Canonical process must contain at least one node.',
      severity: ISSUE_SEVERITY.ERROR,
    }));
  }

  const nodeById = new Map();
  const duplicateNodeIds = new Set();

  nodes.forEach((node) => {
    if (!node?.id) return;
    if (nodeById.has(node.id)) {
      duplicateNodeIds.add(node.id);
      return;
    }
    nodeById.set(node.id, node);
  });

  if (duplicateNodeIds.size > 0) {
    report.errors.push(createCanonicalIssue({
      code: 'canonical_duplicate_nodes',
      message: 'Canonical process contains duplicated node IDs.',
      severity: ISSUE_SEVERITY.ERROR,
      nodeIds: Array.from(duplicateNodeIds),
    }));
  }

  if (entrypoints.length === 0) {
    report.errors.push(createCanonicalIssue({
      code: 'canonical_missing_entrypoint',
      message: 'Canonical process must declare at least one entrypoint.',
      severity: ISSUE_SEVERITY.ERROR,
    }));
  }

  entrypoints.forEach((entrypoint) => {
    if (!nodeById.has(entrypoint)) {
      report.errors.push(createCanonicalIssue({
        code: 'canonical_entrypoint_unknown_node',
        message: `Entrypoint ${entrypoint} does not reference an existing node.`,
        severity: ISSUE_SEVERITY.ERROR,
        nodeIds: [entrypoint],
      }));
    }
  });

  const { outgoing, incoming } = buildAdjacency(edges);

  edges.forEach((edge) => {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      report.errors.push(createCanonicalIssue({
        code: 'canonical_edge_unknown_node',
        message: `Edge ${edge.id || 'unknown'} references unknown nodes.`,
        severity: ISSUE_SEVERITY.ERROR,
        details: {
          edgeId: edge.id || null,
          source: edge.source,
          target: edge.target,
        },
      }));
    }
  });

  const reachable = dfsReachable(entrypoints, outgoing);
  const orphanNodes = nodes
    .map((node) => node.id)
    .filter((nodeId) => !reachable.has(nodeId));

  if (orphanNodes.length > 0) {
    report.warnings.push(createCanonicalIssue({
      code: 'canonical_orphan_nodes',
      message: 'There are nodes unreachable from process entrypoints.',
      severity: ISSUE_SEVERITY.WARNING,
      nodeIds: orphanNodes,
    }));
  }

  const loops = detectCycles(nodes.map((node) => node.id), outgoing);
  if (loops.length > 0) {
    report.warnings.push(createCanonicalIssue({
      code: 'canonical_potentially_dangerous_loops',
      message: 'Potential cyclic paths were detected. Ensure loops have explicit break conditions.',
      severity: ISSUE_SEVERITY.WARNING,
      details: {
        loops,
      },
    }));
  }

  nodes.forEach((node) => {
    const nodeId = node.id;
    const nodeType = node.type;
    const nodeOutgoing = outgoing.get(nodeId) || [];

    if (nodeType !== CANONICAL_NODE_TYPES.END && nodeOutgoing.length === 0 && !TERMINAL_NODE_TYPES.has(nodeType)) {
      report.warnings.push(createCanonicalIssue({
        code: 'canonical_route_without_termination',
        message: `Node ${nodeId} has no outgoing path and is not terminal.`,
        severity: ISSUE_SEVERITY.WARNING,
        nodeIds: [nodeId],
      }));
    }

    if (node.fallbackPolicy?.enabled === true && !node.fallbackPolicy?.targetNodeId) {
      report.warnings.push(createCanonicalIssue({
        code: 'canonical_fallback_incomplete',
        message: `Node ${nodeId} enables fallback but does not define targetNodeId.`,
        severity: ISSUE_SEVERITY.WARNING,
        nodeIds: [nodeId],
      }));
    }

    if (nodeType === CANONICAL_NODE_TYPES.WAIT_TIMER) {
      const cfg = node.config && typeof node.config === 'object' ? node.config : {};
      if (!cfg.timeDuration && !cfg.timeCycle && !cfg.timeDate && !cfg.ms) {
        report.errors.push(createCanonicalIssue({
          code: 'canonical_timer_missing_configuration',
          message: `Timer node ${nodeId} must define timeDuration, timeCycle, timeDate, or ms.`,
          severity: ISSUE_SEVERITY.ERROR,
          nodeIds: [nodeId],
        }));
      }
    }

    if (nodeType === CANONICAL_NODE_TYPES.TASK_USER) {
      const handoff = node.humanHandoffPolicy || {};
      if (handoff.enabled && !handoff.queue && !handoff.team) {
        report.warnings.push(createCanonicalIssue({
          code: 'canonical_handoff_incomplete',
          message: `User task ${nodeId} enables handoff without queue/team.`,
          severity: ISSUE_SEVERITY.WARNING,
          nodeIds: [nodeId],
        }));
      }
    }

    if (nodeType === CANONICAL_NODE_TYPES.TASK_AI) {
      const cfg = node.config && typeof node.config === 'object' ? node.config : {};
      const hasPrompt = typeof cfg.prompt === 'string' && cfg.prompt.trim().length > 0;
      const hasTask = typeof cfg.task === 'string' && cfg.task.trim().length > 0;
      if (!hasPrompt && !hasTask) {
        report.errors.push(createCanonicalIssue({
          code: 'canonical_ai_task_missing_config',
          message: `AI task ${nodeId} must define prompt or task configuration.`,
          severity: ISSUE_SEVERITY.ERROR,
          nodeIds: [nodeId],
        }));
      }
    }

    const inCount = (incoming.get(nodeId) || []).length;
    const outCount = nodeOutgoing.length;
    if (inCount > 0 && outCount > 3 && nodeType !== CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE) {
      report.suggestions.push(createCanonicalIssue({
        code: 'canonical_high_fanout_non_gateway',
        message: `Node ${nodeId} has high fan-out and should likely be modeled as a gateway.`,
        severity: ISSUE_SEVERITY.SUGGESTION,
        nodeIds: [nodeId],
        details: {
          inCount,
          outCount,
        },
      }));
    }
  });

  const terminalMemo = new Map();
  entrypoints.forEach((entrypoint) => {
    if (!nodeById.has(entrypoint)) return;
    const hasPath = hasTerminalPath(entrypoint, outgoing, nodeById, terminalMemo, new Set());
    if (!hasPath) {
      report.warnings.push(createCanonicalIssue({
        code: 'canonical_entrypoint_without_terminal_path',
        message: `Entrypoint ${entrypoint} has no guaranteed path to terminal node.`,
        severity: ISSUE_SEVERITY.WARNING,
        nodeIds: [entrypoint],
      }));
    }
  });

  report.summary = {
    errorCount: report.errors.length,
    warningCount: report.warnings.length,
    suggestionCount: report.suggestions.length,
  };
  report.valid = report.errors.length === 0;

  return report;
}

export default validateCanonicalProcess;
