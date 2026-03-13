import React from 'react';

import { BpmnPoolLaneLayer } from './BpmnPoolLaneLayer';
import { BpmnShape } from './BpmnShape';
import { BpmnEdge } from './BpmnEdge';
import { BpmnSelectionLayer } from './BpmnSelectionLayer';

function getStageSize(viewport) {
  return {
    width: Math.max(Math.ceil(viewport.width), 800),
    height: Math.max(Math.ceil(viewport.height), 500),
  };
}

export function BpmnRenderer({ viewModel, selection, onSelect, zoom = 1 }) {
  const viewport = viewModel?.viewport;

  if (!viewModel || !viewport) {
    return null;
  }

  const { width, height } = getStageSize(viewport);
  const normalizedZoom = Math.max(0.3, Math.min(Number(zoom) || 1, 3));

  return (
    <div className="bpmn-stage-shell" style={{ width: width * normalizedZoom, height: height * normalizedZoom }}>
      <div
        className="bpmn-stage-viewport"
        style={{
          width,
          height,
          transform: `scale(${normalizedZoom})`,
        }}
      >
        <div className="bpmn-stage" style={{ width, height }}>
          <svg className="bpmn-defs" aria-hidden="true" width="0" height="0">
            <defs>
              <marker
                id="bpmn-sequence-arrow"
                markerWidth="5"
                markerHeight="5"
                refX="5"
                refY="2.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 5 2.5 L 0 5 z" className="bpmn-edge__arrow" />
              </marker>
              <marker
                id="bpmn-message-arrow"
                markerWidth="5"
                markerHeight="5"
                refX="5"
                refY="2.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M 0 0 L 5 2.5 L 0 5" className="bpmn-edge__arrow bpmn-edge__arrow--message" />
              </marker>
            </defs>
          </svg>

          <BpmnPoolLaneLayer
            participants={viewModel.participants}
            lanes={viewModel.lanes}
            viewport={viewport}
            selection={selection}
            onSelect={onSelect}
          />

          <svg className="bpmn-edge-layer" width={width} height={height}>
            {(viewModel.sequenceFlows || []).map((edge) => (
              <BpmnEdge
                key={edge.id}
                edge={edge}
                viewport={viewport}
                selected={selection?.kind === 'sequenceFlow' && selection?.id === edge.id}
                onSelect={onSelect}
                kind="sequenceFlow"
              />
            ))}
            {(viewModel.messageFlows || []).map((edge) => (
              <BpmnEdge
                key={edge.id}
                edge={edge}
                viewport={viewport}
                selected={selection?.kind === 'messageFlow' && selection?.id === edge.id}
                onSelect={onSelect}
                kind="messageFlow"
              />
            ))}
          </svg>

          <div className="bpmn-shape-layer">
            {(viewModel.nodes || []).map((node) => (
              <BpmnShape
                key={node.id}
                node={node}
                viewport={viewport}
                selected={selection?.kind === 'node' && selection?.id === node.id}
                onSelect={onSelect}
              />
            ))}
          </div>

          <BpmnSelectionLayer selection={selection} viewModel={viewModel} viewport={viewport} />
        </div>
      </div>
    </div>
  );
}

export default BpmnRenderer;