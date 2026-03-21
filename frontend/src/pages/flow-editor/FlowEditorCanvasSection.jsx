import React from 'react';
import { FlowEditor } from '../../FlowEditor';
import { BpmnCanvas } from '../../bpmn-view/BpmnCanvas';
import { Button } from '../../styles/Button';

export function FlowEditorCanvasSection({
  canvasContainerRef,
  canvasLocked,
  editorMode,
  canRenderBpmn,
  editorRef,
  handleFlowChanged,
  handleNodeSelected,
  showToast,
  bpmnHostRef,
  bpmnViewModel,
  bpmnSelection,
  handleBpmnElementSelected,
  bpmnZoom,
  canvasLockReason,
  setShowFlowGenerator,
  setCanvasLocked,
  setCanvasLockReason,
}) {
  return (
    <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden canvas-container">
      <div className="absolute inset-0 canvas-grid pointer-events-none"></div>
      <div className={`relative h-full ${canvasLocked ? 'pointer-events-none select-none' : ''}`}>
        <div className={`${editorMode === 'bpmn' && canRenderBpmn ? 'absolute inset-0 opacity-0 pointer-events-none' : 'relative h-full'}`}>
          <FlowEditor
            ref={editorRef}
            onFlowChanged={handleFlowChanged}
            onNodeSelected={handleNodeSelected}
            showToast={showToast}
          />
        </div>

        {editorMode === 'bpmn' && canRenderBpmn ? (
          <div className="absolute inset-0 z-10" ref={bpmnHostRef}>
            <BpmnCanvas
              viewModel={bpmnViewModel}
              selection={bpmnSelection}
              onSelect={handleBpmnElementSelected}
              zoom={bpmnZoom}
            />
          </div>
        ) : null}
      </div>

      {canvasLocked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-6 bg-bg-primary/70 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-xl border border-border-default bg-bg-elevated p-5 shadow-lg">
            <div className="text-lg font-semibold text-text-primary">
              Revisao necessaria
            </div>
            <div className="mt-2 text-sm text-text-secondary">
              {canvasLockReason || 'Este fluxo foi gerado em modo que exige revisao antes de editar.'}
            </div>
            <div className="mt-2 text-xs text-text-tertiary">
              Voce pode desbloquear para ajustar manualmente, ou tentar gerar novamente com uma descricao mais especifica.
            </div>

            <div className="mt-4 flex flex-wrap gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowFlowGenerator(true);
                }}
              >
                Gerar novamente
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setCanvasLocked(false);
                  setCanvasLockReason(null);
                }}
              >
                Desbloquear para editar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
