'use strict';

function buildOutgoingIndex(processDefinition = {}) {
  const edges = Array.isArray(processDefinition.edges) ? processDefinition.edges : [];
  const map = new Map();

  edges.forEach((edge) => {
    if (!edge || !edge.source || !edge.target) return;
    if (!map.has(edge.source)) map.set(edge.source, []);
    map.get(edge.source).push(edge);
  });

  map.forEach((value, key) => {
    map.set(
      key,
      value.slice().sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0)),
    );
  });

  return map;
}

function resolveNextEdges(processDefinition = {}, nodeId) {
  if (!nodeId) return [];
  const outgoing = buildOutgoingIndex(processDefinition);
  return outgoing.get(String(nodeId)) || [];
}

function pickNextEdgeByPort(processDefinition = {}, nodeId, port) {
  const edges = resolveNextEdges(processDefinition, nodeId);
  if (edges.length === 0) return null;
  if (!port) return edges[0];

  const normalizedPort = String(port).trim();
  return edges.find((edge) => edge?.condition?.port === normalizedPort) || edges[0];
}

module.exports = {
  buildOutgoingIndex,
  resolveNextEdges,
  pickNextEdgeByPort,
};
