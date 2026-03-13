import React from 'react';

import { BpmnRenderer } from './BpmnRenderer';
import './bpmn-view.css';

export function BpmnCanvas({
  viewModel,
  selection,
  onSelect,
  zoom = 1,
}) {
  if (!viewModel) {
    return (
      <div className="bpmn-canvas">
        <div className="bpmn-canvas__empty">
          Nenhum diagrama BPMN visual disponível.
        </div>
      </div>
    );
  }

  return (
    <div className="bpmn-canvas">
      <BpmnRenderer
        viewModel={viewModel}
        selection={selection}
        onSelect={onSelect}
        zoom={zoom}
      />
    </div>
  );
}

export default BpmnCanvas;