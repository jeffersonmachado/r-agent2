import React from 'react';

function toStageBounds(bounds, _viewport) {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

export function BpmnSelectionLayer({ selection, viewModel, viewport }) {
  if (!selection?.id || !selection?.kind) return null;

  const collectionMap = {
    node: viewModel?.nodes,
    participant: viewModel?.participants,
    lane: viewModel?.lanes,
  };

  if (selection.kind === 'sequenceFlow' || selection.kind === 'messageFlow') {
    const edges = selection.kind === 'messageFlow' ? viewModel?.messageFlows : viewModel?.sequenceFlows;
    const edge = Array.isArray(edges) ? edges.find((item) => item.id === selection.id) : null;
    if (!edge?.waypoints?.length) return null;
    const stagePoints = edge.waypoints;
    return (
      <svg className="bpmn-selection-layer" aria-hidden="true" width="100%" height="100%">
        <polyline
          className="bpmn-selection-layer__edge"
          points={stagePoints.map((point) => `${point.x},${point.y}`).join(' ')}
        />
      </svg>
    );
  }

  const collection = collectionMap[selection.kind];
  const item = Array.isArray(collection) ? collection.find((entry) => entry.id === selection.id) : null;
  if (!item?.bounds) return null;

  const bounds = toStageBounds(item.bounds, viewport);

  return (
    <svg className="bpmn-selection-layer" aria-hidden="true" width="100%" height="100%">
      <rect
        className="bpmn-selection-layer__shape"
        x={bounds.x - 6}
        y={bounds.y - 6}
        width={bounds.width + 12}
        height={bounds.height + 12}
        rx="10"
        ry="10"
      />
    </svg>
  );
}

export default BpmnSelectionLayer;