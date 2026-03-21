import React from 'react';
import { SidebarProperties } from '../../SidebarProperties';
import { SimulationPanel } from '../../simulator/SimulationPanel';
import { ConversationTimeline } from '../../simulator/ConversationTimeline';
import { Button } from '../../styles/Button';
import { getNodeSchema } from '../../editor/nodeSchemas';
import { BpmnInspectorBridge } from '../../bpmn-view/BpmnInspectorBridge.jsx';

export function FlowEditorRightPanel({
  rightPanelCollapsed,
  rightPanelWidth,
  toggleRightPanel,
  setRightPanelCollapsed,
  setPropertiesCollapsed,
  setValidationCollapsed,
  setSimulationCollapsed,
  propertiesCollapsed,
  validationCollapsed,
  simulationCollapsed,
  replayCollapsed,
  setReplayCollapsed,
  editorMode,
  canRenderBpmn,
  bpmnSelection,
  bpmnViewModel,
  handleSwitchEditorMode,
  selectedNode,
  handleUpdateNodeConfig,
  editorRef,
  logger,
  validation,
  summarizeValidationBySeverity,
  simulation,
  sessionId,
  setSessionId,
  loadingReplay,
  handleLoadReplay,
  replayError,
  replay,
  handleSeekNode,
}) {
  return (
    <>
        <div
          id="rightPanel"
          className={`${rightPanelCollapsed ? 'w-12' : ''} min-w-[48px] flex flex-col transition-all duration-200 flow-editor-right-panel`}
          style={!rightPanelCollapsed ? { width: `${rightPanelWidth}px` } : {}}
        >
          {/* HEADER */}
          <div className="section-header">
            <button className={`collapse-btn-horizontal collapse-btn-right ${rightPanelCollapsed ? 'collapsed' : ''}`} onClick={toggleRightPanel}>
            </button>
          </div>

          {/* CONTEÚDO - EXATAMENTE como no modelo */}
          <div id="rightContent" className="flex-1 flex flex-col min-h-0 overflow-x-hidden">
            {rightPanelCollapsed ? (
              <>
                {/* Modo colapsado - textos verticais */}
                <div 
                  className="flex-1 p-2 section-container flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                  onClick={() => {
                    setRightPanelCollapsed(false);
                    setPropertiesCollapsed(false);
                  }}
                  title="Clique para expandir Propriedades"
                >
                  Propriedades
                </div>
                <div 
                  className="flex-1 p-2 section-container flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                  onClick={() => {
                    setRightPanelCollapsed(false);
                    setValidationCollapsed(false);
                  }}
                  title="Clique para expandir Validação"
                >
                  Validação
                </div>
                <div 
                  className="flex-1 p-2 flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                  onClick={() => {
                    setRightPanelCollapsed(false);
                    setSimulationCollapsed(false);
                  }}
                  title="Clique para expandir Simulação"
                >
                  Simulação
                </div>
              </>
            ) : (
              <>
                {/* Propriedades - com colapso vertical */}
                <div className={`flex flex-col ${propertiesCollapsed ? 'section-collapsed' : 'section-expanded-full'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Propriedades</span>
                    <button
                      className={`collapse-btn-vertical ${propertiesCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setPropertiesCollapsed(!propertiesCollapsed)}
                      title={propertiesCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!propertiesCollapsed && (
                    <div className="section-content">
                      {editorMode === 'bpmn' && canRenderBpmn ? (
                        <BpmnInspectorBridge
                          selection={bpmnSelection}
                          viewModel={bpmnViewModel}
                          onSwitchToEngine={(targetId) => handleSwitchEditorMode('engine', targetId)}
                        />
                      ) : (
                        <SidebarProperties
                          selectedNode={selectedNode}
                          onChangeConfig={(newConfig) => {
                            if (selectedNode?.id) {
                              handleUpdateNodeConfig(selectedNode.id, newConfig);
                            }
                          }}
                          availableNodes={(() => {
                            // Obtém lista de nós disponíveis do editor para o combobox
                            try {
                              if (editorRef.current?.editor?.current) {
                                const editor = editorRef.current.editor.current;
                                const nodes = editor.getNodes();
                                return nodes.map(node => {
                                  const schema = getNodeSchema(node.data?.type);
                                  return {
                                    id: String(node.id),
                                    type: node.data?.type || 'unknown',
                                    label: schema?.label || node.data?.type || 'unknown',
                                  };
                                }).filter(node => node.id !== selectedNode?.id); // Exclui o nó atual
                              }
                            } catch (err) {
                              logger.warn('Erro ao obter nós disponíveis', { error: err });
                            }
                            return [];
                          })()}
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Validação - com colapso vertical */}
                <div className={`flex flex-col ${validationCollapsed ? 'section-collapsed' : 'section-expanded'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Validação</span>
                    {(() => {
                      const counts = summarizeValidationBySeverity({ errors: validation?.uiErrors || [] });
                      if (!counts.total) return null;
                      const label = `Erros: ${counts.error} · Warnings: ${counts.warning} · Info: ${counts.info}`;
                      // Mostra sempre quando existe resultado, mesmo colapsado
                      return (
                        <span
                          className={`text-[11px] px-2 py-0.5 rounded border ${
                            counts.error > 0
                              ? 'text-status-error border-status-error/30 bg-status-error/10'
                              : counts.warning > 0
                                ? 'text-status-warning border-status-warning/30 bg-status-warning/10'
                                : 'text-status-info border-status-info/30 bg-status-info/10'
                          }`}
                          title={label}
                        >
                          {counts.error > 0 ? `${counts.error} erro(s)` : counts.warning > 0 ? `${counts.warning} warning(s)` : `${counts.info} info`}
                        </span>
                      );
                    })()}
                    <button
                      className={`collapse-btn-vertical ${validationCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setValidationCollapsed(!validationCollapsed)}
                      title={validationCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!validationCollapsed && (
                    <div className="section-content">
                      {!validation ? (
                        <div className="w-full h-full flex flex-col items-center justify-center text-sm sidebar-properties-empty">
                          <div className="text-center space-y-3 max-w-[240px]">
                            <div className="text-4xl mb-3 opacity-40">
                              <span className="icon icon-check sidebar-properties-empty-icon"></span>
                            </div>
                            <div className="text-base font-semibold mb-1 sidebar-properties-empty-title">
                              Nenhuma validação executada
                            </div>
                            <div className="text-xs leading-relaxed sidebar-properties-empty-description">
                              Execute a validação para ver os resultados.
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="text-sm mb-2">
                            <span>Resultado: </span>
                            <span className={validation.valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {validation.valid ? 'Válido' : 'Inválido'}
                            </span>
                          </div>
                          {validation.uiErrors && validation.uiErrors.length > 0 && (
                            <div className="text-xs space-y-2">
                              {(() => {
                                const issuesByNode = new Map();
                                validation.uiErrors.forEach((err) => {
                                  if (err.nodeIds && err.nodeIds.length > 0) {
                                    err.nodeIds.forEach((nodeId) => {
                                      if (!issuesByNode.has(nodeId)) {
                                        issuesByNode.set(nodeId, []);
                                      }
                                      issuesByNode.get(nodeId).push(err);
                                    });
                                  } else {
                                    if (!issuesByNode.has('_global')) {
                                      issuesByNode.set('_global', []);
                                    }
                                    issuesByNode.get('_global').push(err);
                                  }
                                });

                                const normalizeSeverity = (e) => {
                                  const sev = String(e?.severity || '').toLowerCase();
                                  if (sev === 'warning') return 'warning';
                                  if (sev === 'info') return 'info';
                                  return 'error';
                                };

                                const severityMeta = (sev) => {
                                  if (sev === 'warning') {
                                    return { label: 'WARNING', className: 'text-status-warning border-status-warning/30 bg-status-warning/10' };
                                  }
                                  if (sev === 'info') {
                                    return { label: 'INFO', className: 'text-status-info border-status-info/30 bg-status-info/10' };
                                  }
                                  return { label: 'ERRO', className: 'text-status-error border-status-error/30 bg-status-error/10' };
                                };

                                return Array.from(issuesByNode.entries()).map(([nodeId, issues]) => (
                                  <div key={nodeId} className="mb-3">
                                    <div className="font-semibold mb-1">
                                      {nodeId !== '_global' ? `Nó: ${nodeId}` : 'Mensagens gerais'}
                                    </div>
                                    <ul className="list-disc list-inside space-y-1">
                                      {issues.map((err, idx) => {
                                        const sev = normalizeSeverity(err);
                                        const meta = severityMeta(sev);
                                        return (
                                          <li key={`${err.code}-${idx}`}>
                                            <span className={`inline-flex items-center px-1.5 py-0.5 mr-2 rounded border text-[10px] font-mono ${meta.className}`}>
                                              {meta.label}
                                            </span>
                                            <span className="text-gray-600 dark:text-gray-400">[{err.code}]</span>
                                            <span> {err.messageUi || err.message}</span>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                ));
                              })()}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Simulação - com colapso vertical */}
                <div className={`flex flex-col ${simulationCollapsed ? 'section-collapsed' : 'section-expanded'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Simulação</span>
                    <button
                      className={`collapse-btn-vertical ${simulationCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setSimulationCollapsed(!simulationCollapsed)}
                      title={simulationCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!simulationCollapsed && (
                    <div className="section-content">
                      <SimulationPanel simulation={simulation} />
                    </div>
                  )}
                </div>

                {/* Replay de Sessão - com colapso vertical */}
                <div className={`flex flex-col ${replayCollapsed ? 'section-collapsed' : 'section-expanded'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Replay de Sessão</span>
                    <button
                      className={`collapse-btn-vertical ${replayCollapsed ? 'collapsed' : ''}`}
                      onClick={() => setReplayCollapsed(!replayCollapsed)}
                      title={replayCollapsed ? 'Expandir' : 'Recolher'}
                    >
                    </button>
                  </div>
                  {!replayCollapsed && (
                    <div className="section-content">
                      <div className="space-y-3 p-3">
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={sessionId}
                            onChange={(e) => setSessionId(e.target.value)}
                            placeholder="Session ID (ex: sess-123)"
                            className="flex-1 px-3 py-2 text-sm border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-default"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter' && !loadingReplay) {
                                handleLoadReplay();
                              }
                            }}
                            disabled={loadingReplay}
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={handleLoadReplay}
                            disabled={loadingReplay || !sessionId.trim()}
                          >
                            {loadingReplay ? 'Carregando...' : 'Carregar'}
                          </Button>
                        </div>
                        {replayError && (
                          <div className="p-2 bg-status-error/10 border border-status-error/20 text-status-error text-sm rounded">
                            Erro: {replayError}
                          </div>
                        )}
                        {replay && (
                          <div className="space-y-3">
                            <ConversationTimeline replay={replay} onSeekNode={handleSeekNode} />
                            {replay.simulation && (
                              <div className="mt-3 pt-3 border-t border-border-default">
                                <SimulationPanel simulation={replay.simulation} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

        </div>

    </>
  );
}
