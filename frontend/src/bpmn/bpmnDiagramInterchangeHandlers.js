const DEFAULT_BOUNDS = Object.freeze({
  x: 0,
  y: 0,
  width: 100,
  height: 100,
});

function asTrimmedString(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function asFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBounds(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    x: asFiniteNumber(source.x ?? source.left, DEFAULT_BOUNDS.x),
    y: asFiniteNumber(source.y ?? source.top, DEFAULT_BOUNDS.y),
    width: asFiniteNumber(source.width ?? source.w, DEFAULT_BOUNDS.width),
    height: asFiniteNumber(source.height ?? source.h, DEFAULT_BOUNDS.height),
  };
}

function normalizeWaypoint(raw) {
  if (Array.isArray(raw) && raw.length >= 2) {
    return {
      x: asFiniteNumber(raw[0], 0),
      y: asFiniteNumber(raw[1], 0),
    };
  }

  if (!raw || typeof raw !== 'object') return null;

  return {
    x: asFiniteNumber(raw.x, 0),
    y: asFiniteNumber(raw.y, 0),
  };
}

function normalizeWaypoints(rawWaypoints) {
  if (!Array.isArray(rawWaypoints)) return [];
  return rawWaypoints.map((point) => normalizeWaypoint(point)).filter(Boolean);
}

function extractNodeBounds(node) {
  const layout = node?.layout;

  if (Array.isArray(layout) && layout.length >= 2) {
    return normalizeBounds({ x: layout[0], y: layout[1] });
  }

  if (layout && typeof layout === 'object') {
    return normalizeBounds(layout);
  }

  return normalizeBounds(node?.config?.bpmnDiShape?.bounds);
}

export function registerDiagramInterchangeHandlers(registry) {
  if (!registry || typeof registry.register !== 'function') return registry;

  registry.register('bpmn:diagramInterchange', {
    onExport: ({ node, nodeId }) => {
      if (!node || typeof node !== 'object') return null;

      const hasShapeInfo = !!node.layout || !!node?.config?.bpmnDiShape;
      const rawEdges =
        node?.config?.bpmnDiEdges && typeof node.config.bpmnDiEdges === 'object'
          ? node.config.bpmnDiEdges
          : null;

      if (!hasShapeInfo && !rawEdges) return null;

      const shapeId = asTrimmedString(node?.config?.bpmnDiShape?.id) || `${nodeId || 'Node'}_di`;
      const shape = hasShapeInfo
        ? {
            id: shapeId,
            bounds: extractNodeBounds(node),
          }
        : null;

      const edges = [];
      if (rawEdges) {
        Object.entries(rawEdges).forEach(([edgeId, edgeData]) => {
          const waypoints = normalizeWaypoints(edgeData?.waypoints);
          if (waypoints.length === 0) return;

          edges.push({
            edgeId,
            id: asTrimmedString(edgeData?.id) || `${edgeId}_di`,
            sourceRef: asTrimmedString(edgeData?.sourceRef) || null,
            targetRef: asTrimmedString(edgeData?.targetRef) || null,
            waypoints,
          });
        });
      }

      return {
        tag: 'DIElement',
        shape,
        edges,
      };
    },

    onImport: ({ nodeType, diShape, diEdges, elementId }) => {
      const configPatch = {};

      if (diShape) {
        configPatch.bpmnDiShape = {
          id: asTrimmedString(diShape.id) || `${elementId}_di`,
          bounds: normalizeBounds(diShape.bounds),
        };
      }

      if (diEdges && typeof diEdges === 'object') {
        const normalizedEdges = {};

        Object.entries(diEdges).forEach(([edgeId, edgeData]) => {
          const waypoints = normalizeWaypoints(edgeData?.waypoints);
          if (waypoints.length === 0) return;

          normalizedEdges[edgeId] = {
            ...(edgeData?.id ? { id: edgeData.id } : {}),
            ...(edgeData?.sourceRef ? { sourceRef: edgeData.sourceRef } : {}),
            ...(edgeData?.targetRef ? { targetRef: edgeData.targetRef } : {}),
            waypoints,
          };
        });

        if (Object.keys(normalizedEdges).length > 0) {
          configPatch.bpmnDiEdges = normalizedEdges;
        }
      }

      if (Object.keys(configPatch).length === 0) return null;

      return {
        nodeType: nodeType || null,
        configPatch,
      };
    },
  });

  return registry;
}
