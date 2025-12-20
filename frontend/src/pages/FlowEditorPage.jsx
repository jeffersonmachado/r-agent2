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

  // Estados para recursos adicionais
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [copiedNode, setCopiedNode] = useState(null);
  const [selectedNodes, setSelectedNodes] = useState([]);
  const [currentZoom, setCurrentZoom] = useState(1);

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
      
      // Verifica se todos os nós têm posições válidas antes de organizar
      const nodesWithValidPositions = nodes.filter(node => {
        try {
          const nodeView = area.nodeViews?.get(node.id);
          return nodeView && nodeView.position;
        } catch {
          return false;
        }
      });
      
      if (nodesWithValidPositions.length === 0) {
        showToast('Nenhum nó válido para organizar', 'warning', 2000);
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
            logger.warn('Erro ao calcular layout do AutoArrangePlugin', { 
              error: err?.message || String(err),
              nodeCount: nodes.length
            });
            resolve();
            // Não propaga o erro - apenas loga como warning
          }
        });
      });
      
      // Aguarda um pouco antes do zoom para a animação completar
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Zoom automático após organizar com animação suave
      if (nodes.length > 0) {
        try {
        AreaExtensions.zoomAt(area, nodes);
        } catch (err) {
          logger.warn('Erro ao fazer zoom após organizar', { error: err?.message });
        }
      }
      
      showToast('Nós organizados automaticamente', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao organizar nós', { error: err });
      showToast('Erro ao organizar nós. Tente novamente.', 'error', 3000);
    }
  };

  // ========== HANDLERS DE ZOOM ==========
  const handleZoomIn = () => {
    const area = editorRef.current?.area;
    if (!area) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const currentZoom = area.zoom?.x || 1;
      const newZoom = Math.min(currentZoom * 1.2, 3);
      area.zoom(newZoom, newZoom);
      setCurrentZoom(newZoom);
      showToast(`Zoom: ${Math.round(newZoom * 100)}%`, 'info', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom in', { error: err });
    }
  };

  const handleZoomOut = () => {
    const area = editorRef.current?.area;
    if (!area) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const currentZoom = area.zoom?.x || 1;
      const newZoom = Math.max(currentZoom / 1.2, 0.1);
      area.zoom(newZoom, newZoom);
      setCurrentZoom(newZoom);
      showToast(`Zoom: ${Math.round(newZoom * 100)}%`, 'info', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom out', { error: err });
    }
  };

  const handleZoomFit = () => {
    const area = editorRef.current?.area;
    const editor = editorRef.current?.editor?.current;
    if (!area || !editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const nodes = editor.getNodes();
      if (nodes.length === 0) {
        showToast('Nenhum nó para fazer zoom', 'info', 2000);
        return;
      }
      AreaExtensions.zoomAt(area, nodes);
      setCurrentZoom(1);
      showToast('Zoom ajustado', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom fit', { error: err });
    }
  };

  const handleResetZoom = () => {
    const area = editorRef.current?.area;
    if (!area) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      area.zoom(1, 1);
      setCurrentZoom(1);
      showToast('Zoom resetado para 100%', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao resetar zoom', { error: err });
    }
  };

  const handleCenterCanvas = () => {
    const area = editorRef.current?.area;
    const editor = editorRef.current?.editor?.current;
    if (!area || !editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const nodes = editor.getNodes();
      if (nodes.length === 0) {
        showToast('Nenhum nó para centralizar', 'info', 2000);
        return;
      }
      AreaExtensions.zoomAt(area, nodes);
      showToast('Canvas centralizado', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao centralizar canvas', { error: err });
    }
  };

  const handleToggleMinimap = () => {
    setMinimapVisible(!minimapVisible);
    showToast(`Minimapa ${!minimapVisible ? 'ativado' : 'desativado'}`, 'info', 1000);
  };

  // ========== HANDLERS DE EDIÇÃO ==========
  const saveToHistory = () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) return;
    
    try {
      const nodes = editor.getNodes();
      const connections = editor.getConnections();
      const snapshot = {
        nodes: nodes.map(n => ({ id: n.id, data: { ...n.data }, position: editorRef.current?.area?.nodeViews?.get(n.id)?.position })),
        connections: connections.map(c => ({ id: c.id, source: c.source, target: c.target })),
        timestamp: Date.now()
      };
      
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(snapshot);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      
      // Limita histórico a 50 itens
      if (newHistory.length > 50) {
        newHistory.shift();
        setHistoryIndex(newHistory.length - 1);
      }
    } catch (err) {
      logger.warn('Erro ao salvar histórico', { error: err });
    }
  };

  const handleUndo = () => {
    if (historyIndex <= 0) {
      showToast('Nada para desfazer', 'info', 1000);
      return;
    }
    // TODO: Implementar undo completo
    showToast('Undo não implementado completamente', 'warning', 2000);
  };

  const handleRedo = () => {
    if (historyIndex >= history.length - 1) {
      showToast('Nada para refazer', 'info', 1000);
      return;
    }
    // TODO: Implementar redo completo
    showToast('Redo não implementado completamente', 'warning', 2000);
  };

  const handleCopy = () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor || !selectedNode) {
      showToast('Nenhum nó selecionado para copiar', 'warning', 2000);
      return;
    }
    try {
      const node = editor.getNode(selectedNode.id);
      if (node) {
        setCopiedNode({
          type: node.data.type,
          config: { ...node.data.config },
          id: node.id
        });
        showToast('Nó copiado', 'success', 1000);
      }
    } catch (err) {
      logger.warn('Erro ao copiar nó', { error: err });
      showToast('Erro ao copiar nó', 'error', 2000);
    }
  };

  const handlePaste = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor || !copiedNode) {
      showToast('Nenhum nó copiado para colar', 'warning', 2000);
      return;
    }
    try {
      // TODO: Implementar criação de novo nó com dados copiados
      showToast('Paste não implementado completamente', 'warning', 2000);
    } catch (err) {
      logger.warn('Erro ao colar nó', { error: err });
      showToast('Erro ao colar nó', 'error', 2000);
    }
  };

  const handleDuplicate = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor || !selectedNode) {
      showToast('Nenhum nó selecionado para duplicar', 'warning', 2000);
      return;
    }
    try {
      const node = editor.getNode(selectedNode.id);
      if (node) {
        // TODO: Implementar duplicação completa
        showToast('Duplicar não implementado completamente', 'warning', 2000);
      }
    } catch (err) {
      logger.warn('Erro ao duplicar nó', { error: err });
      showToast('Erro ao duplicar nó', 'error', 2000);
    }
  };

  const handleSelectAll = () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const nodes = editor.getNodes();
      setSelectedNodes(nodes.map(n => n.id));
      showToast(`${nodes.length} nós selecionados`, 'info', 1000);
    } catch (err) {
      logger.warn('Erro ao selecionar todos os nós', { error: err });
    }
  };

  const handleDeselectAll = () => {
    setSelectedNodes([]);
    setSelectedNode(null);
    showToast('Seleção limpa', 'info', 1000);
  };

  // ========== HANDLERS DE ALINHAMENTO ==========
  const alignNodes = (alignFn) => {
    const area = editorRef.current?.area;
    const editor = editorRef.current?.editor?.current;
    if (!area || !editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    
    const nodesToAlign = selectedNodes.length > 0 
      ? selectedNodes.map(id => editor.getNode(id)).filter(Boolean)
      : selectedNode 
        ? [editor.getNode(selectedNode.id)].filter(Boolean)
        : [];
    
    if (nodesToAlign.length < 2) {
      showToast('Selecione pelo menos 2 nós para alinhar', 'warning', 2000);
      return;
    }
    
    try {
      alignFn(nodesToAlign, area);
      showToast('Nós alinhados', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao alinhar nós', { error: err });
      showToast('Erro ao alinhar nós', 'error', 2000);
    }
  };

  const handleAlignLeft = () => alignNodes((nodes, area) => {
    const leftmost = Math.min(...nodes.map(n => {
      const view = area.nodeViews?.get(n.id);
      return view?.position?.x || 0;
    }));
    nodes.forEach(n => {
      const view = area.nodeViews?.get(n.id);
      if (view) area.translate(n.id, { x: leftmost, y: view.position.y });
    });
  });

  const handleAlignCenter = () => alignNodes((nodes, area) => {
    const centers = nodes.map(n => {
      const view = area.nodeViews?.get(n.id);
      return view ? view.position.x + (view.width || 150) / 2 : 0;
    });
    const avgCenter = centers.reduce((a, b) => a + b, 0) / centers.length;
    nodes.forEach(n => {
      const view = area.nodeViews?.get(n.id);
      if (view) {
        const offset = (view.width || 150) / 2;
        area.translate(n.id, { x: avgCenter - offset, y: view.position.y });
      }
    });
  });

  const handleAlignRight = () => alignNodes((nodes, area) => {
    const rightmost = Math.max(...nodes.map(n => {
      const view = area.nodeViews?.get(n.id);
      return view ? view.position.x + (view.width || 150) : 0;
    }));
    nodes.forEach(n => {
      const view = area.nodeViews?.get(n.id);
      if (view) {
        const offset = view.width || 150;
        area.translate(n.id, { x: rightmost - offset, y: view.position.y });
      }
    });
  });

  const handleAlignTop = () => alignNodes((nodes, area) => {
    const topmost = Math.min(...nodes.map(n => {
      const view = area.nodeViews?.get(n.id);
      return view?.position?.y || 0;
    }));
    nodes.forEach(n => {
      const view = area.nodeViews?.get(n.id);
      if (view) area.translate(n.id, { x: view.position.x, y: topmost });
    });
  });

  const handleAlignMiddle = () => alignNodes((nodes, area) => {
    const middles = nodes.map(n => {
      const view = area.nodeViews?.get(n.id);
      return view ? view.position.y + (view.height || 100) / 2 : 0;
    });
    const avgMiddle = middles.reduce((a, b) => a + b, 0) / middles.length;
    nodes.forEach(n => {
      const view = area.nodeViews?.get(n.id);
      if (view) {
        const offset = (view.height || 100) / 2;
        area.translate(n.id, { x: view.position.x, y: avgMiddle - offset });
      }
    });
  });

  const handleAlignBottom = () => alignNodes((nodes, area) => {
    const bottommost = Math.max(...nodes.map(n => {
      const view = area.nodeViews?.get(n.id);
      return view ? view.position.y + (view.height || 100) : 0;
    }));
    nodes.forEach(n => {
      const view = area.nodeViews?.get(n.id);
      if (view) {
        const offset = view.height || 100;
        area.translate(n.id, { x: view.position.x, y: bottommost - offset });
      }
    });
  });

  const handleDistributeHorizontal = () => alignNodes((nodes, area) => {
    const sorted = nodes.sort((a, b) => {
      const aView = area.nodeViews?.get(a.id);
      const bView = area.nodeViews?.get(b.id);
      return (aView?.position?.x || 0) - (bView?.position?.x || 0);
    });
    if (sorted.length < 3) {
      showToast('Selecione pelo menos 3 nós para distribuir', 'warning', 2000);
      return;
    }
    const first = area.nodeViews?.get(sorted[0].id);
    const last = area.nodeViews?.get(sorted[sorted.length - 1].id);
    if (!first || !last) return;
    const totalWidth = last.position.x - first.position.x;
    const step = totalWidth / (sorted.length - 1);
    sorted.forEach((n, i) => {
      const view = area.nodeViews?.get(n.id);
      if (view) area.translate(n.id, { x: first.position.x + step * i, y: view.position.y });
    });
  });

  const handleDistributeVertical = () => alignNodes((nodes, area) => {
    const sorted = nodes.sort((a, b) => {
      const aView = area.nodeViews?.get(a.id);
      const bView = area.nodeViews?.get(b.id);
      return (aView?.position?.y || 0) - (bView?.position?.y || 0);
    });
    if (sorted.length < 3) {
      showToast('Selecione pelo menos 3 nós para distribuir', 'warning', 2000);
      return;
    }
    const first = area.nodeViews?.get(sorted[0].id);
    const last = area.nodeViews?.get(sorted[sorted.length - 1].id);
    if (!first || !last) return;
    const totalHeight = last.position.y - first.position.y;
    const step = totalHeight / (sorted.length - 1);
    sorted.forEach((n, i) => {
      const view = area.nodeViews?.get(n.id);
      if (view) area.translate(n.id, { x: view.position.x, y: first.position.y + step * i });
    });
  });

  // ========== HANDLERS DE NAVEGAÇÃO ==========
  const handleSearchNode = (query) => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const nodes = editor.getNodes();
      const found = nodes.find(n => 
        String(n.id).includes(query) || 
        String(n.data?.type).includes(query) ||
        JSON.stringify(n.data?.config || {}).includes(query)
      );
      if (found) {
        const view = area.nodeViews?.get(found.id);
        if (view) {
          AreaExtensions.zoomAt(area, [found]);
          setSelectedNode({ id: String(found.id), type: found.data?.type, config: found.data?.config || {} });
          showToast(`Nó encontrado: ${found.id}`, 'success', 2000);
        }
      } else {
        showToast('Nó não encontrado', 'warning', 2000);
      }
    } catch (err) {
      logger.warn('Erro ao buscar nó', { error: err });
      showToast('Erro ao buscar nó', 'error', 2000);
    }
  };

  const handleGoToNode = () => {
    const query = prompt('Digite o ID do nó:');
    if (query) handleSearchNode(query);
  };

  const handleNextNode = () => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area || !selectedNode) {
      showToast('Nenhum nó selecionado', 'warning', 2000);
      return;
    }
    try {
      const nodes = editor.getNodes();
      const currentIndex = nodes.findIndex(n => String(n.id) === String(selectedNode.id));
      if (currentIndex >= 0 && currentIndex < nodes.length - 1) {
        const nextNode = nodes[currentIndex + 1];
        AreaExtensions.zoomAt(area, [nextNode]);
        setSelectedNode({ id: String(nextNode.id), type: nextNode.data?.type, config: nextNode.data?.config || {} });
      } else {
        showToast('Último nó', 'info', 1000);
      }
    } catch (err) {
      logger.warn('Erro ao navegar para próximo nó', { error: err });
    }
  };

  const handlePreviousNode = () => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area || !selectedNode) {
      showToast('Nenhum nó selecionado', 'warning', 2000);
      return;
    }
    try {
      const nodes = editor.getNodes();
      const currentIndex = nodes.findIndex(n => String(n.id) === String(selectedNode.id));
      if (currentIndex > 0) {
        const prevNode = nodes[currentIndex - 1];
        AreaExtensions.zoomAt(area, [prevNode]);
        setSelectedNode({ id: String(prevNode.id), type: prevNode.data?.type, config: prevNode.data?.config || {} });
      } else {
        showToast('Primeiro nó', 'info', 1000);
      }
    } catch (err) {
      logger.warn('Erro ao navegar para nó anterior', { error: err });
    }
  };

  // ========== HANDLERS DE EXPORTAÇÃO ==========
  const handleExportPNG = () => {
    showToast('Exportar PNG não implementado', 'warning', 2000);
  };

  const handleExportSVG = () => {
    showToast('Exportar SVG não implementado', 'warning', 2000);
  };

  const handleExportPDF = () => {
    showToast('Exportar PDF não implementado', 'warning', 2000);
  };

  const handleImportTemplate = () => {
    setShowTemplateSelector(true);
  };

  // ========== HANDLERS DE VALIDAÇÃO E DEBUG ==========
  const handleValidateAndFix = async () => {
    await validateCurrentFlow();
    // TODO: Implementar correção automática
    showToast('Correção automática não implementada', 'info', 2000);
  };

  const handleShowErrors = () => {
    if (!validation || !validation.uiErrors || validation.uiErrors.length === 0) {
      showToast('Nenhum erro encontrado', 'info', 2000);
      return;
    }
    // TODO: Destacar nós com erros
    showToast(`${validation.uiErrors.length} erro(s) encontrado(s)`, 'warning', 2000);
  };

  const handleToggleDebug = () => {
    setDebugMode(!debugMode);
    showToast(`Modo debug ${!debugMode ? 'ativado' : 'desativado'}`, 'info', 1000);
  };

  const handleShowStatistics = () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const nodes = editor.getNodes();
      const connections = editor.getConnections();
      const nodeTypes = {};
      nodes.forEach(n => {
        const type = n.data?.type || 'unknown';
        nodeTypes[type] = (nodeTypes[type] || 0) + 1;
      });
      const stats = `Nós: ${nodes.length}\nConexões: ${connections.length}\n\nTipos:\n${Object.entries(nodeTypes).map(([t, c]) => `  ${t}: ${c}`).join('\n')}`;
      alert(stats);
    } catch (err) {
      logger.warn('Erro ao obter estatísticas', { error: err });
    }
  };

  // ========== HANDLERS DE PERFORMANCE ==========
  const handleOptimizeLayout = () => {
    handleArrange();
    showToast('Layout otimizado', 'success', 1000);
  };

  const handleSimplifyGraph = () => {
    showToast('Simplificar grafo não implementado', 'warning', 2000);
  };

  // ========== HANDLERS DE CONEXÕES ==========
  const handleToggleReroutePoints = () => {
    showToast('Reroute points não implementado', 'warning', 2000);
  };

  const handleClearOrphanConnections = () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const connections = editor.getConnections();
      const nodes = editor.getNodes();
      const nodeIds = new Set(nodes.map(n => String(n.id)));
      let removed = 0;
      connections.forEach(conn => {
        if (!nodeIds.has(String(conn.source)) || !nodeIds.has(String(conn.target))) {
          editor.removeConnection(conn.id);
          removed++;
        }
      });
      if (removed > 0) {
        showToast(`${removed} conexão(ões) órfã(s) removida(s)`, 'success', 2000);
      } else {
        showToast('Nenhuma conexão órfã encontrada', 'info', 2000);
      }
    } catch (err) {
      logger.warn('Erro ao limpar conexões órfãs', { error: err });
      showToast('Erro ao limpar conexões órfãs', 'error', 2000);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-bg-primary text-text-primary font-sans">
      <Toolbar
        // Recursos básicos
        onImportJson={null}
        onExportJson={null}
        onSimulate={handleSimulate}
        onSave={handleSave}
        onValidate={handleValidate}
        onLoadFlow={null}
        onArrange={handleArrange}
        
        // Controles de zoom
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onResetZoom={handleResetZoom}
        onCenterCanvas={handleCenterCanvas}
        
        // Controles de edição
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDuplicate={handleDuplicate}
        onSelectAll={handleSelectAll}
        onDeselectAll={handleDeselectAll}
        
        // Controles de alinhamento
        onAlignLeft={handleAlignLeft}
        onAlignCenter={handleAlignCenter}
        onAlignRight={handleAlignRight}
        onAlignTop={handleAlignTop}
        onAlignMiddle={handleAlignMiddle}
        onAlignBottom={handleAlignBottom}
        onDistributeHorizontal={handleDistributeHorizontal}
        onDistributeVertical={handleDistributeVertical}
        
        // Controles de conexão
        onToggleReroutePoints={handleToggleReroutePoints}
        onClearOrphanConnections={handleClearOrphanConnections}
        
        // Controles de busca e navegação
        onSearchNode={handleSearchNode}
        onGoToNode={handleGoToNode}
        onNextNode={handleNextNode}
        onPreviousNode={handlePreviousNode}
        
        // Controles de exportação
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportPDF={handleExportPDF}
        onImportTemplate={handleImportTemplate}
        
        // Controles de validação e debug
        onValidateAndFix={handleValidateAndFix}
        onShowErrors={handleShowErrors}
        onToggleDebug={handleToggleDebug}
        onShowStatistics={handleShowStatistics}
        
        // Controles de performance
        onOptimizeLayout={handleOptimizeLayout}
        onSimplifyGraph={handleSimplifyGraph}
        
        // Controles de minimap
        onToggleMinimap={handleToggleMinimap}
        minimapVisible={minimapVisible}
        currentZoom={currentZoom}
      >
        {/* Botões no início da toolbar */}
        <div className="flex items-center gap-2">
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
        </div>
        {/* Logs e ThemeSelector no final */}
        <Button variant="ghost" size="sm" onClick={() => setShowLogViewer(true)}>
          📋 Logs
        </Button>
        <ThemeSelector />
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


