'use strict';

const { compileCanonicalProcessDefinition, engineFlowToCanonicalProcess } = require('../process-runtime/processCanonicalAdapter');
const { ProcessComplexityService } = require('./processComplexityService');

function looksLikeCompiled(definition) {
  return !!(definition && typeof definition === 'object' && definition.executionGraph && Array.isArray(definition.nodes));
}

function looksLikeCanonical(definition) {
  return !!(definition && typeof definition === 'object' && Array.isArray(definition.nodes) && Array.isArray(definition.edges));
}

function compile(definition) {
  if (looksLikeCompiled(definition)) return definition;
  if (looksLikeCanonical(definition)) return compileCanonicalProcessDefinition(definition);
  return compileCanonicalProcessDefinition(engineFlowToCanonicalProcess(definition));
}

class ProcessSimulationService {
  constructor({ complexityService } = {}) {
    this.complexityService = complexityService || new ProcessComplexityService();
  }

  collectReachable(compiled) {
    const visited = new Set();
    const stack = [compiled.executionGraph.startNode].filter(Boolean);
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      const edges = compiled.executionGraph.edgesBySource[String(nodeId)] || [];
      edges.forEach((edge) => {
        if (edge?.target && !visited.has(String(edge.target))) {
          stack.push(String(edge.target));
        }
      });
    }
    return visited;
  }

  collectLoops(compiled) {
    const loops = [];
    const visiting = new Set();
    const visited = new Set();
    const path = [];

    const walk = (nodeId) => {
      const key = String(nodeId || '');
      if (!key) return;
      if (visiting.has(key)) {
        const startIndex = path.indexOf(key);
        loops.push(path.slice(startIndex).concat(key));
        return;
      }
      if (visited.has(key)) return;
      visited.add(key);
      visiting.add(key);
      path.push(key);
      const edges = compiled.executionGraph.edgesBySource[key] || [];
      edges.forEach((edge) => walk(edge?.target));
      path.pop();
      visiting.delete(key);
    };

    walk(compiled.executionGraph.startNode);
    return loops;
  }

  collectTerminalPaths(compiled, maxPaths = 50) {
    const paths = [];
    const walk = (nodeId, currentPath = [], seen = new Set()) => {
      if (paths.length >= maxPaths) return;
      const key = String(nodeId || '');
      if (!key) {
        paths.push(currentPath.slice());
        return;
      }
      if (seen.has(key)) {
        paths.push(currentPath.concat(`${key} (loop)`));
        return;
      }
      const nextPath = currentPath.concat(key);
      const edges = compiled.executionGraph.edgesBySource[key] || [];
      if (edges.length === 0 || compiled.executionGraph.nodesById[key]?.type === 'end') {
        paths.push(nextPath);
        return;
      }
      const nextSeen = new Set(seen);
      nextSeen.add(key);
      edges.forEach((edge) => walk(edge?.target, nextPath, nextSeen));
    };

    walk(compiled.executionGraph.startNode);
    return paths;
  }

  simulateProcess(definition) {
    const compiled = compile(definition);
    const reachable = this.collectReachable(compiled);
    const loops = this.collectLoops(compiled);
    const terminalPaths = this.collectTerminalPaths(compiled);
    const nodes = Array.isArray(compiled.nodes) ? compiled.nodes : [];
    const edges = Array.isArray(compiled.edges) ? compiled.edges : [];
    const unreachableNodes = nodes.filter((node) => !reachable.has(String(node.id))).map((node) => String(node.id));
    const branchingNodes = nodes.filter((node) => (compiled.executionGraph.edgesBySource[String(node.id)] || []).length > 1).map((node) => String(node.id));
    const deadPaths = nodes
      .filter((node) => {
        const outgoing = compiled.executionGraph.edgesBySource[String(node.id)] || [];
        return node.type !== 'end' && outgoing.length === 0;
      })
      .map((node) => String(node.id));
    const complexity = this.complexityService.calculateComplexity({
      nodeCount: nodes.length,
      edgeCount: edges.length,
      loopCount: loops.length,
      branchingNodes: branchingNodes.length,
      unreachableNodeCount: unreachableNodes.length,
    });

    return {
      processId: compiled.id,
      processVersion: compiled.version || 1,
      reachableNodes: Array.from(reachable),
      unreachableNodes,
      terminalPaths,
      deadPaths,
      loops,
      complexityScore: complexity.score,
      complexity,
      branchingNodes,
    };
  }
}

module.exports = {
  ProcessSimulationService,
};
