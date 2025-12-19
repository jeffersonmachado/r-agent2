import React, { useState, useRef } from 'react';
import { FlowEditor } from '../FlowEditor';
import { SidebarProperties } from '../SidebarProperties';
import { Toolbar } from '../Toolbar';
import { AreaExtensions } from 'rete-area-plugin';
import { SimulationPanel } from '../simulator/SimulationPanel';
import { useEditor } from '../state/editorStore';
import { useTheme } from '../styles/themeContext';
import { Input } from '../styles/Input';
import { NodePalette } from '../components/NodePalette';
import { ThemeSelector } from '../components/ThemeSelector';
import { FlowSelector } from '../components/FlowSelector';
import { FlowTemplateSelector } from '../components/FlowTemplateSelector';
import { Button } from '../styles/Button';
import { createFlow } from '../api/flows';
import { engineFlowToReteJson } from '../engine-mapper/engineMapper';
import logger from '../utils/logger';
import { LogViewer } from '../components/LogViewer';
import { ResizablePanel } from '../components/ResizablePanel';
import { NodePaletteCollapsed } from '../components/NodePalette';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';

/**
 * Página principal de edição de fluxo.
 *
 * Responsabilidades:
 * - Compor editor gráfico, painel lateral e barra de ferramentas.
 * - Orquestrar chamadas à API via editorStore (salvar, validar, simular).
 */
export function FlowEditorPage() {
  const {
    currentFlow,
    editorJson,
    selectedNode,
    validation,
    simulation,
    loading,
    error,
    setSelectedNode,
    updateEditorJson,
    validateCurrentFlow,
    saveFlow,
    simulateCurrentFlow,
    loadFlow,
    deleteFlow,
  } = useEditor();

  const { theme } = useTheme();
  const editorRef = useRef(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [flowListRefreshTrigger, setFlowListRefreshTrigger] = useState(0);
  const { showToast, ToastContainer } = useToast();
  
  // Estados para redimensionamento dos painéis
  const [leftPanelWidth, setLeftPanelWidth] = useState(null); // null = usa flex
  const [rightPanelWidth, setRightPanelWidth] = useState(null);
  const [nodePaletteWidth, setNodePaletteWidth] = useState(200);
  const [sidebarWidth, setSidebarWidth] = useState(300);

  const handleFlowSelected = async (flow) => {
    if (flow && flow.id) {
      await loadFlow(flow.id);
    }
  };

  const handleTemplateSelected = async (flow) => {
    logger.info('Template selecionado', { templateId: flow?.id, templateName: flow?.name });
    setShowTemplateSelector(false);
    
    try {
      logger.debug('Iniciando criação de fluxo do template', flow);
      
      // Salva o fluxo no backend primeiro
      logger.info('Salvando fluxo no backend...');
      const savedFlow = await createFlow(flow);
      logger.info('Fluxo salvo no backend', { savedFlowId: savedFlow?.id });
      
      // Notifica o FlowSelector para atualizar a lista
      setFlowListRefreshTrigger(prev => prev + 1);
      
      // Carrega o fluxo salvo no editor
      logger.info('Carregando fluxo no editor...', { flowId: savedFlow.id });
      await loadFlow(savedFlow.id);
      logger.info('Fluxo carregado no editor com sucesso');
    } catch (err) {
      logger.error('Erro ao criar fluxo do template', err);
      // Mesmo com erro, tenta carregar no editor
      logger.warn('Tentando carregar fluxo localmente mesmo com erro', { flowId: flow?.id });
      const reteJson = engineFlowToReteJson(flow);
      const nodeCount = reteJson?.nodes ? Object.keys(reteJson.nodes).length : 0;
      logger.debug('Fluxo convertido localmente', { 
        nodeCount,
        flowNodes: flow?.nodes?.length || 0,
        flowStructure: { 
          hasNodes: !!flow?.nodes,
          nodesIsArray: Array.isArray(flow?.nodes),
          nodesLength: flow?.nodes?.length
        }
      });
      updateEditorJson(reteJson);
    }
  };

  const handleFlowChanged = (json) => {
    updateEditorJson(json);
  };

  const handleNodeSelected = (node) => {
    // Garante que o node tenha todas as propriedades necessárias
    if (node) {
      // Obtém informações sobre nós anterior e próximo
      let previousNodeId = null;
      let nextNodeId = null;
      
      try {
        if (editorRef.current?.editor?.current) {
          const editor = editorRef.current.editor.current;
          const nodeId = String(node.id || '');
          const allConnections = editor.getConnections();
          
          // Encontra nó anterior (conexões onde este nó é o target)
          for (const conn of allConnections) {
            const targetId = String(conn.target || '');
            if (targetId === nodeId) {
              previousNodeId = String(conn.source || '');
              break; // Pega apenas o primeiro
            }
          }
          
          // Encontra nó próximo (conexões onde este nó é o source)
          for (const conn of allConnections) {
            const sourceId = String(conn.source || '');
            if (sourceId === nodeId) {
              nextNodeId = String(conn.target || '');
              break; // Pega apenas o primeiro
            }
          }
        }
      } catch (err) {
        logger.warn('Erro ao obter conexões do nó', { nodeId: node.id, error: err });
      }
      
      const nodeData = {
        id: String(node.id || ''),
        type: node.type || 'unknown',
        config: node.config || {},
        previousNodeId,
        nextNodeId,
      };
      logger.debug('handleNodeSelected chamado', {
        nodeData,
        originalNode: node,
        hasConfig: !!node.config,
        configKeys: Object.keys(nodeData.config),
      });
      setSelectedNode(nodeData);
    } else {
      setSelectedNode(null);
    }
  };

  const handleUpdateNodeConfig = (nodeId, newConfig) => {
    if (!editorRef.current) {
      logger.warn('Editor não disponível para atualizar nó', { nodeId });
      return;
    }

    try {
      // Usa a função exposta pelo editor se disponível
      if (editorRef.current.updateNodeConfig) {
        editorRef.current.updateNodeConfig(nodeId, newConfig);
      } else if (editorRef.current.editor?.current) {
        // Fallback: atualiza manualmente
        const editor = editorRef.current.editor.current;
        const node = editor.getNode(nodeId);
        
        if (node) {
          node.data.config = { ...node.data.config, ...newConfig };
        }
      }
      
      // Atualiza o selectedNode local para refletir as mudanças
      if (selectedNode && selectedNode.id === nodeId) {
        setSelectedNode({
          ...selectedNode,
          config: { ...selectedNode.config, ...newConfig },
        });
      }
      
      logger.debug('Config do nó atualizado', { nodeId, newConfig });
    } catch (err) {
      logger.error('Erro ao atualizar config do nó', { nodeId, error: err });
    }
  };

  const handleSave = async () => {
    const saved = await saveFlow();
    if (saved) {
      // Notifica o FlowSelector para atualizar a lista (pode ter mudado nome, etc)
      setFlowListRefreshTrigger(prev => prev + 1);
      showToast('Fluxo salvo com sucesso', 'success');
    } else {
      showToast('Erro ao salvar fluxo', 'error');
    }
  };

  const handleValidate = async () => {
    await validateCurrentFlow();
  };

  const handleSimulate = async () => {
    await simulateCurrentFlow();
  };

  const handleDeleteClick = () => {
    if (!currentFlow || !currentFlow.id) {
      logger.warn('Nenhum fluxo carregado para deletar');
      return;
    }
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentFlow || !currentFlow.id) {
      return;
    }

    try {
      await deleteFlow(currentFlow.id);
      logger.info('Fluxo removido com sucesso', { flowId: currentFlow.id });
      showToast('Fluxo removido com sucesso', 'success');
      // O estado já é limpo automaticamente pelo deleteFlow
      // Notifica o FlowSelector para atualizar a lista
      setFlowListRefreshTrigger(prev => prev + 1);
    } catch (err) {
      logger.error('Erro ao remover fluxo', { error: err });
      showToast(
        `Erro ao remover fluxo: ${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000
      );
    }
  };

  const handleArrange = async () => {
    try {
      // O editorRef tem a estrutura: { editor: { current: NodeEditor }, arrange, area }
      const arrange = editorRef.current?.arrange;
      const area = editorRef.current?.area;
      const editor = editorRef.current?.editor?.current;
      
      if (!arrange || !area || !editor) {
        showToast('Editor não está pronto', 'warning', 2000);
        return;
      }
      
      const nodes = editor.getNodes();
      if (nodes.length === 0) {
        showToast('Nenhum nó para organizar', 'info', 2000);
        return;
      }
      
      // Anima a organização de forma suave
      showToast('Organizando nós...', 'info', 1000);
      
      // Usa requestAnimationFrame para animação suave
      await new Promise(resolve => {
        requestAnimationFrame(async () => {
          try {
            await arrange.layout();
            resolve();
          } catch (err) {
            resolve();
            throw err;
          }
        });
      });
      
      // Aguarda um pouco antes do zoom para a animação completar
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Zoom automático após organizar com animação suave
      if (nodes.length > 0) {
        AreaExtensions.zoomAt(area, nodes);
      }
      
      showToast('Nós organizados automaticamente', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao organizar nós', { error: err });
      showToast('Erro ao organizar nós', 'error', 3000);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary font-sans">
      <Toolbar
        onImportJson={null}
        onExportJson={null}
        onSimulate={handleSimulate}
        onSave={handleSave}
        onValidate={handleValidate}
        onLoadFlow={null}
        onArrange={handleArrange}
      >
        <div className="flex items-center gap-3 flex-1">
          <Button variant="primary" size="sm" onClick={() => setShowTemplateSelector(true)}>
            + Novo Fluxo
          </Button>
          <FlowSelector
            onFlowSelected={handleFlowSelected}
            currentFlowId={currentFlow?.id}
            refreshTrigger={flowListRefreshTrigger}
          />
          {currentFlow?.id ? (
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteClick}
              title={`Remover fluxo "${currentFlow.name || currentFlow.id}"`}
            >
              🗑️ Remover
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2 items-center">
            <Button variant="ghost" size="sm" onClick={() => setShowLogViewer(true)}>
              📋 Logs
            </Button>
            <ThemeSelector />
          </div>
        </div>
      </Toolbar>

      {showTemplateSelector && (
        <FlowTemplateSelector
          onTemplateSelected={handleTemplateSelected}
          onCancel={() => setShowTemplateSelector(false)}
        />
      )}

      {showLogViewer && (
        <LogViewer onClose={() => setShowLogViewer(false)} />
      )}

      {loading && (
        <div className="absolute top-16 right-4 px-3 py-2 bg-bg-elevated border border-border-default rounded-md text-xs text-text-secondary z-[1000]">
          Carregando...
        </div>
      )}

      {error && (
        <div className="absolute top-16 left-4 px-3 py-2 bg-bg-elevated border border-status-error rounded-md text-xs text-status-error z-[1000]">
          Erro: {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        <ResizablePanel
          defaultWidth={leftPanelWidth}
          minWidth={400}
          direction="horizontal"
          onResize={setLeftPanelWidth}
        >
          <div className="flex flex-col flex-1 min-h-0">
            <div className="px-5 py-3.5 border-b border-border-default text-sm bg-bg-secondary text-text-secondary">
              <span className="text-text-tertiary text-xs uppercase tracking-wider font-medium">Fluxo atual:</span>{' '}
              <span className="text-text-primary font-semibold">
                {currentFlow ? `${currentFlow.name} (${currentFlow.id})` : 'não carregado'}
              </span>
            </div>
            <div className="flex flex-1 min-h-0">
              <ResizablePanel
                defaultWidth={nodePaletteWidth || 200}
                minWidth={150}
                maxWidth={400}
                direction="horizontal"
                onResize={setNodePaletteWidth}
                collapsible={true}
                collapsedWidth={50}
                collapseDirection="left"
                title="Paleta"
                collapsedContent={<NodePaletteCollapsed />}
                onToggle={() => {
                  // Quando a paleta é expandida/recolhida, ajusta o zoom do editor
                  if (editorRef.current?.zoomToFit) {
                    // Aguarda a animação de transição do painel (200ms) antes de fazer zoom
                    setTimeout(() => {
                      editorRef.current?.zoomToFit();
                    }, 250);
                  }
                }}
              >
                <NodePalette />
              </ResizablePanel>
              <FlowEditor
                initialFlowJson={editorJson}
                onFlowChanged={handleFlowChanged}
                onNodeSelected={handleNodeSelected}
                onEvent={() => {}}
                editorRef={editorRef}
                selectedNodeId={selectedNode?.id}
                onUpdateNodeConfig={handleUpdateNodeConfig}
                showToast={showToast}
              />
              <ResizablePanel
                defaultWidth={sidebarWidth || 300}
                minWidth={200}
                maxWidth={500}
                direction="horizontal"
                onResize={setSidebarWidth}
                collapsible={true}
                collapsedWidth={40}
                title="Propriedades"
                onToggle={() => {
                  // Quando o painel de propriedades é expandido/recolhido, ajusta o zoom do editor
                  if (editorRef.current?.zoomToFit) {
                    // Aguarda a animação de transição do painel (200ms) antes de fazer zoom
                    setTimeout(() => {
                      editorRef.current?.zoomToFit();
                    }, 250);
                  }
                }}
              >
                <SidebarProperties
                  selectedNode={selectedNode}
                  onChangeConfig={(newConfig) => {
                    if (selectedNode?.id) {
                      handleUpdateNodeConfig(selectedNode.id, newConfig);
                    }
                  }}
                />
              </ResizablePanel>
            </div>
          </div>
        </ResizablePanel>

        <ResizablePanel
          defaultWidth={rightPanelWidth || 400}
          minWidth={300}
          direction="horizontal"
          onResize={setRightPanelWidth}
          collapsible={true}
          collapsedWidth={40}
          collapseDirection="right"
          title="Validação"
          className="flex-shrink-0"
          onToggle={() => {
            // Quando o painel de validação é expandido/recolhido, ajusta o zoom do editor
            if (editorRef.current?.zoomToFit) {
              // Aguarda a animação de transição do painel (200ms) antes de fazer zoom
              setTimeout(() => {
                editorRef.current?.zoomToFit();
              }, 250);
            }
          }}
        >
          <div className="flex flex-col flex-1 min-w-0 bg-bg-secondary">
            <div className="flex-1 min-h-0 overflow-auto p-4 text-xs">
              {!validation && (
                <div className="text-text-tertiary">Nenhuma validação executada.</div>
              )}
              {validation && (
                <>
                  <div className="mb-3">
                    <span className="text-text-secondary">Resultado: </span>
                    <span
                      className={`font-medium ${
                        validation.valid ? 'text-status-success' : 'text-status-error'
                      }`}
                    >
                      {validation.valid ? 'Válido' : 'Inválido'}
                    </span>
                  </div>
                  {validation.uiErrors && validation.uiErrors.length > 0 && (
                    <ul className="pl-5 m-0 text-text-secondary">
                      {validation.uiErrors.map((err) => (
                        <li key={`${err.code}-${(err.nodeIds || []).join('-')}`} className="mb-2">
                          <span className="text-status-error font-medium">[{err.code}]</span>{' '}
                          {err.message}{' '}
                          {err.nodeIds && err.nodeIds.length > 0 && (
                            <span className="text-text-tertiary">(nós: {err.nodeIds.join(', ')})</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <SimulationPanel simulation={simulation} />
          </div>
        </ResizablePanel>
      </div>

      {/* Confirm Dialog */}
      {currentFlow && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteConfirm}
          title="Remover fluxo"
          message={`Tem certeza que deseja remover o fluxo "${currentFlow.name || currentFlow.id}"?\n\nEsta ação não pode ser desfeita.`}
          confirmText="Remover"
          cancelText="Cancelar"
          variant="danger"
          icon="🗑️"
        />
      )}

      {/* Toast Container */}
      <ToastContainer />
    </div>
  );
}


