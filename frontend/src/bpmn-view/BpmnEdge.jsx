import React from 'react';

function buildPolylinePoints(waypoints) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) return '';
  return waypoints.map((point) => `${point.x},${point.y}`).join(' ');
}

function hasLabelBounds(labelBounds) {
  if (!labelBounds) return false;
  return Number.isFinite(labelBounds.x)
    && Number.isFinite(labelBounds.y)
    && Number.isFinite(labelBounds.width)
    && Number.isFinite(labelBounds.height);
}

function resolveLabelPosition(edge, points) {
  if (hasLabelBounds(edge?.labelBounds)) {
    return {
      x: edge.labelBounds.x + edge.labelBounds.width / 2,
      y: edge.labelBounds.y + edge.labelBounds.height / 2,
    };
  }

  if (!Array.isArray(points) || points.length === 0) {
    return null;
  }

  const midpoint = points[Math.floor(points.length / 2)];
  return {
    x: midpoint.x,
    y: midpoint.y - 10,
  };
}

export function BpmnEdge({
  edge,
  viewport: _viewport,
  selected,
  onSelect,
  kind = 'sequenceFlow',
}) {
  const points = Array.isArray(edge?.waypoints)
    ? edge.waypoints
    : [];
  const polylinePoints = buildPolylinePoints(points);

  if (!polylinePoints) return null;

  const markerEnd = kind === 'messageFlow' ? 'url(#bpmn-message-arrow)' : 'url(#bpmn-sequence-arrow)';
  const visibleLabel = edge?.name && edge.name !== edge.id ? edge.name : '';
  const labelPosition = resolveLabelPosition(edge, points);
  const hoverTitle = [
    visibleLabel || `Fluxo ${kind === 'messageFlow' ? 'de mensagem' : 'de sequência'}`,
    edge?.sourceRef ? `Origem: ${edge.sourceRef}` : null,
    edge?.targetRef ? `Destino: ${edge.targetRef}` : null,
    edge?.id ? `ID: ${edge.id}` : null,
  ].filter(Boolean).join('\n');

  return (
    <g
      className={`bpmn-edge bpmn-edge--${kind} ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect?.({ kind, id: edge.id })}
    >
      <title>{hoverTitle}</title>
      <polyline className="bpmn-edge__hitbox" points={polylinePoints} fill="none" />
      <polyline className="bpmn-edge__line" points={polylinePoints} fill="none" markerEnd={markerEnd} />
      {visibleLabel && labelPosition ? (
        <text
          className="bpmn-edge__label"
          x={labelPosition.x}
          y={labelPosition.y}
          dominantBaseline="middle"
        >
          {visibleLabel}
        </text>
      ) : null}
    </g>
  );
}

export default BpmnEdge;