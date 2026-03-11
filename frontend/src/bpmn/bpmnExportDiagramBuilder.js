import {
  openTag,
  closeTag,
  selfClosingTag,
} from './bpmnXmlBuilder';
import {
  normalizeNodeId,
} from './bpmnExportHelpers';
import {
  buildOriginalElementIdToExportedElementIdMap,
  resolveDiagramEdgeForSequenceFlow,
} from './bpmnDiagramEdgeMatching';

/**
 * Convert value to finite number or return fallback
 * @private
 */
function asFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Normalize bounds object with default values for missing fields
 * @private
 */
function normalizeBounds(bounds) {
  const source = bounds && typeof bounds === 'object' ? bounds : {};
  return {
    x: asFiniteNumber(source.x, 0),
    y: asFiniteNumber(source.y, 0),
    width: asFiniteNumber(source.width, 100),
    height: asFiniteNumber(source.height, 100),
  };
}

/**
 * Normalize waypoints array, filtering invalid entries
 * @private
 */
function normalizeWaypoints(waypoints) {
  if (!Array.isArray(waypoints)) return [];
  return waypoints
    .map((point) => {
      if (!point || typeof point !== 'object') return null;
      return {
        x: asFiniteNumber(point.x, 0),
        y: asFiniteNumber(point.y, 0),
      };
    })
    .filter(Boolean);
}

/**
 * Build BPMN Diagram Interchange (DI) XML lines
 * Aggregates shapes (with bounds) and edges (with waypoints) from registry handlers
 * and generates proper di:shape and di:edge XML elements
 * 
 * @param {Object} config
 * @param {Array} config.descriptors - BPMN element descriptors with elementId
 * @param {Array} config.nodes - Original engine nodes
 * @param {Array} config.sequenceFlows - BPMN sequenceFlow definitions
 * @param {Object} config.bpmnRegistry - BPMN handler registry
 * @param {string} config.processId - BPMN process element ID
 * @returns {Array} XML lines for bpmn:diagram and bpmn:plane elements
 */
export function buildDiagramInterchangeLines({
  descriptors,
  nodes,
  sequenceFlows,
  bpmnRegistry,
  processId,
}) {
  const nodeById = new Map();
  nodes.forEach((node) => {
    const normalizedId = normalizeNodeId(node && node.id);
    if (!normalizedId) return;
    nodeById.set(normalizedId, node);
  });

  const originalElementIdToExportedElementId = buildOriginalElementIdToExportedElementIdMap(descriptors);

  const shapeByElementId = new Map();
  const edges = [];

  descriptors.forEach((descriptor) => {
    const node = nodeById.get(descriptor.nodeId);
    const sourceSequenceFlows = sequenceFlows.filter(
      (sequenceFlow) => sequenceFlow.sourceRef === descriptor.elementId
    );

    const diResult = bpmnRegistry.runExport('bpmn:diagramInterchange', {
      node,
      nodeId: descriptor.nodeId,
      elementId: descriptor.elementId,
      sourceSequenceFlows,
    });

    if (!diResult || diResult.tag !== 'DIElement') return;

    if (diResult.shape && diResult.shape.bounds) {
      shapeByElementId.set(descriptor.elementId, {
        id: diResult.shape.id || `${descriptor.elementId}_di`,
        bpmnElement: descriptor.elementId,
        bounds: normalizeBounds(diResult.shape.bounds),
      });
    }

    const edgeById = new Map();
    if (Array.isArray(diResult.edges)) {
      diResult.edges.forEach((edge) => {
        const key = normalizeNodeId(edge && edge.edgeId);
        if (!key) return;
        edgeById.set(key, edge);
      });
    }

    const edgeFallback = Array.from(edgeById.values());
    sourceSequenceFlows.forEach((sequenceFlow, index) => {
      const configuredEdge = resolveDiagramEdgeForSequenceFlow(
        sequenceFlow,
        edgeById,
        edgeFallback,
        index,
        originalElementIdToExportedElementId
      );
      const waypoints = normalizeWaypoints(configuredEdge && configuredEdge.waypoints);
      if (waypoints.length === 0) return;

      edges.push({
        id: (configuredEdge && configuredEdge.id) || `${sequenceFlow.id}_di`,
        bpmnElement: sequenceFlow.id,
        waypoints,
      });
    });
  });

  if (shapeByElementId.size === 0 && edges.length === 0) return [];

  const lines = [
    openTag('bpmn:diagram', { id: 'Diagram_1' }),
    `  ${openTag('bpmn:plane', { id: 'Plane_1', bpmnElement: processId })}`,
  ];

  shapeByElementId.forEach((shape) => {
    lines.push(`    ${openTag('di:shape', { id: shape.id, bpmnElement: shape.bpmnElement })}`);
    lines.push(`      ${selfClosingTag('di:bounds', shape.bounds)}`);
    lines.push(`    ${closeTag('di:shape')}`);
  });

  edges.forEach((edge) => {
    lines.push(`    ${openTag('di:edge', { id: edge.id, bpmnElement: edge.bpmnElement })}`);
    edge.waypoints.forEach((waypoint) => {
      lines.push(`      ${selfClosingTag('di:waypoint', waypoint)}`);
    });
    lines.push(`    ${closeTag('di:edge')}`);
  });

  lines.push(`  ${closeTag('bpmn:plane')}`);
  lines.push(closeTag('bpmn:diagram'));

  return lines;
}
