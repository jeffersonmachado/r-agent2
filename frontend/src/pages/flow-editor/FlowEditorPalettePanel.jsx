import React from 'react';
import { NodePalette, NodePaletteCollapsed } from '../../components/NodePalette';
import { Button } from '../../styles/Button';

export function FlowEditorPalettePanel({
  paletteCollapsed,
  paletteWidth,
  togglePalette,
  isBpmnDiagram,
  displayedFlow,
  currentFlow,
  handleFlowKindChange,
}) {
  return (
    <>
        <div
          id="palette"
          className={`${paletteCollapsed ? 'w-12' : ''} min-w-[48px] flex flex-col transition-all duration-200 flow-editor-palette`}
          style={!paletteCollapsed ? { width: `${paletteWidth}px` } : {}}
        >
          <div className="section-header">
            <span className={paletteCollapsed ? 'hidden' : 'inline'}>
              Paleta
            </span>
            <button 
              className={`collapse-btn-horizontal ${paletteCollapsed ? 'collapsed' : ''}`}
              onClick={togglePalette}
              aria-label={paletteCollapsed ? 'Expandir paleta' : 'Recolher paleta'}
            >
            </button>
          </div>

          {!paletteCollapsed ? (
            <div className="flex-1 p-2 text-sm space-y-2 overflow-y-auto">
                {!isBpmnDiagram && String(displayedFlow?.kind || currentFlow?.kind || 'chat').toLowerCase() !== 'voice' ? (
                  <div className="rounded-lg border border-border-default bg-bg-elevated p-2">
                    <div className="text-xs text-text-secondary">
                      Nos de voz (URA) estao ocultos porque o fluxo esta em <strong>Chat</strong>.
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleFlowKindChange('voice')}
                        title="Troca o tipo do fluxo para Voz (URA) e mostra os nos de voz na paleta"
                      >
                        Ativar Voz (URA)
                      </Button>
                    </div>
                  </div>
                ) : null}
                {isBpmnDiagram ? (
                  <div className="rounded-lg border border-border-default bg-bg-elevated p-2 text-xs text-text-secondary">
                    Paleta em modo BPMN: exibindo subconjunto de nós compatível com exportação BPMN.
                  </div>
                ) : null}
                <NodePalette
                  flowKind={displayedFlow?.kind || currentFlow?.kind || 'chat'}
                  diagramType={isBpmnDiagram ? 'bpmn' : 'engine'}
                />
            </div>
          ) : (
            <div className="flex-1 p-2 flex flex-col items-center gap-2 overflow-y-auto">
              <NodePaletteCollapsed
                flowKind={displayedFlow?.kind || currentFlow?.kind || 'chat'}
                diagramType={isBpmnDiagram ? 'bpmn' : 'engine'}
              />
            </div>
          )}
        </div>
    </>
  );
}
