import React, { useState, useRef, useCallback, useEffect } from 'react';
import { FlowEditor } from '../FlowEditor';
import { SidebarProperties } from '../SidebarProperties';
import { Toolbar } from '../Toolbar';
import { AreaExtensions } from 'rete-area-plugin';
import { SimulationPanel } from '../simulator/SimulationPanel';
import { useEditor } from '../state/editorStore';
import { NodePalette, NodePaletteCollapsed } from '../components/NodePalette';
import { ThemeSelector } from '../components/ThemeSelector';
import { FlowSelector } from '../components/FlowSelector';
import { FlowTemplateSelector } from '../components/FlowTemplateSelector';
import { SaveAsTemplateDialog } from '../components/SaveAsTemplateDialog';
import { Button } from '../styles/Button';
import { createFlow, saveTemplate } from '../api/flows';
import logger from '../utils/logger';
import { LogViewer } from '../components/LogViewer';
import { ResizableDivider } from '../components/ResizableDivider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useTheme } from '../styles/themeContext';
import { Dialog } from '../components/Dialog';
import { FlowTestChat } from '../components/FlowTestChat';
import { reteJsonToEngineFlow } from '../engine-mapper/engineMapper';
import { NavigationLink } from '../components/NavigationLink';

export function FlowEditorPage() {
  const { themeName } = useTheme();
  const {
    currentFlow,
    selectedNode,
    validation,
    simulation,
    loading,
    error,
    setSelectedNode,
    validateCurrentFlow,
    saveFlow,
    simulateCurrentFlow,
    loadFlow,
    deleteFlow,
    clearCurrentFlow,
  } = useEditor();

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTestChat, setShowTestChat] = useState(false);
  const [testFlowDefinition, setTestFlowDefinition] = useState(null);
  const [testChatSize, setTestChatSize] = useState(null);
  const [testKey, setTestKey] = useState(0);
  const [flowListRefreshTrigger, setFlowListRefreshTrigger] = useState(0);
  const [templateListRefreshTrigger, setTemplateListRefreshTrigger] = useState(0);
  const { showToast, ToastContainer } = useToast();

  // Monitora erros do editorStore e exibe via Toast
  useEffect(() => {
    if (error && !error.includes('"validation_failed"')) {
      // Extrai mensagem amigável do erro
      let errorMessage = error;
      if (error.includes('Erro HTTP')) {
        try {
          const match = error.match(/\{.*\}/);
          if (match) {
            const errorObj = JSON.parse(match[0]);
            errorMessage = errorObj.message || errorObj.error || error;
          }
        } catch (e) {
          // Se não conseguir parsear, usa o erro original
        }
      }
      showToast(errorMessage, 'error', 5000);
    }
  }, [error, showToast]);
  
  // Estados para colapso e larguras (EXATAMENTE como no modelo)
  const [paletteCollapsed, setPaletteCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  
  // Estados para colapso vertical dos painéis do painel direito
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [validationCollapsed, setValidationCollapsed] = useState(true); // Inicia colapsada (tamanho mínimo)
  const [simulationCollapsed, setSimulationCollapsed] = useState(true); // Inicia colapsada (tamanho mínimo)
  
  const [paletteWidth, setPaletteWidth] = useState(() => {
    const saved = localStorage.getItem('paletteWidth');
    return saved ? parseInt(saved) : 224; // w-56 = 224px
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem('rightPanelWidth');
    return saved ? parseInt(saved) : 288; // w-72 = 288px
  });
  
  // Salva larguras no localStorage
  useEffect(() => {
    localStorage.setItem('paletteWidth', paletteWidth.toString());
  }, [paletteWidth]);
  useEffect(() => {
    localStorage.setItem('rightPanelWidth', rightPanelWidth.toString());
  }, [rightPanelWidth]);

  // Funções de toggle EXATAMENTE como no modelo
  const togglePalette = useCallback(() => {
    setPaletteCollapsed(prev => !prev);
  }, []);

  const toggleRightPanel = () => {
    setRightPanelCollapsed(!rightPanelCollapsed);
  };

  const [displayedFlow, setDisplayedFlow] = useState(null);

  useEffect(() => {
    if (currentFlow && currentFlow.id) {
      setDisplayedFlow(currentFlow);
    } else {
      setDisplayedFlow(null);
    }
  }, [currentFlow]);

  const handleFlowSelected = async (flow) => {
    if (flow && flow.id) {
      await loadFlow(flow.id);
      
      // ✅ Executa validação do backend após carregar fluxo salvo
      setTimeout(async () => {
        const editor = editorRef.current?.editor?.current;
        const area = editorRef.current?.area;
        if (editor && area) {
          try {
            const reteJson = await editor.toJSON();
            const validationResult = await validateCurrentFlow(reteJson);
            
            // ✅ Sempre aplica (limpa erros antigos e aplica novos, ou limpa tudo se válido)
            const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
            if (validationResult && validationResult.errors) {
              applyBackendValidationErrors(editor, area, validationResult.valid ? [] : validationResult.errors);
              logger.debug('Validação do backend aplicada após carregar fluxo', {
                valid: validationResult.valid,
                errorCount: validationResult.errors.length,
              });
            }
          } catch (validationErr) {
            logger.debug('Erro ao validar fluxo após carregar (não crítico)', { error: validationErr });
          }
        }
      }, 500); // Aguarda 500ms para garantir que o editor foi atualizado
    }
  };

  const handleTemplateSelected = async (flow) => {
    logger.info('Template selecionado', { templateId: flow?.id, templateName: flow?.name });
    setShowTemplateSelector(false);
    if (flow && flow.id) {
      setDisplayedFlow(flow);
    }
    
    try {
      const savedFlow = await createFlow(flow);
      logger.info('Fluxo salvo no backend', { savedFlowId: savedFlow?.id });
      setFlowListRefreshTrigger(prev => prev + 1);
      await loadFlow(savedFlow.id);
      logger.info('Fluxo carregado no editor com sucesso');
      
      // ✅ Executa validação do backend após criar novo fluxo
      // Aguarda um pouco para garantir que o editor foi atualizado
      setTimeout(async () => {
        const editor = editorRef.current?.editor?.current;
        const area = editorRef.current?.area;
        if (editor && area) {
          try {
            const reteJson = await editor.toJSON();
            const validationResult = await validateCurrentFlow(reteJson);
            
            // ✅ Aplica erros do backend (limpa se válido, aplica se inválido)
            const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
            if (validationResult && validationResult.errors) {
              applyBackendValidationErrors(editor, area, validationResult.valid ? [] : validationResult.errors);
              logger.debug('Validação do backend aplicada após criar novo fluxo', {
                valid: validationResult.valid,
                errorCount: validationResult.errors.length,
              });
            }
          } catch (validationErr) {
            logger.debug('Erro ao validar fluxo após criar (não crítico)', { error: validationErr });
          }
        }
      }, 500); // Aguarda 500ms para garantir que o editor foi atualizado
    } catch (err) {
      logger.error('Erro ao criar fluxo do template', err);
      if (displayedFlow) {
        loadFlow(displayedFlow.id);
      }
      showToast('Erro ao criar fluxo do template. Verifique os logs.', 'error', 5000);
    }
  };

  const handleFlowChanged = useCallback(() => {}, []);
  const handleNodeSelected = useCallback((node) => {
    if (node) {
      let previousNodeId = null;
      let nextNodeId = null;
      
      try {
        if (editorRef.current?.editor?.current) {
          const editor = editorRef.current.editor.current;
          const nodeId = String(node.id || '');
          
          const allConnections = editor.getConnections();
          
          for (const conn of allConnections) {
            const targetId = String(conn.target || '');
            if (targetId === nodeId) {
              previousNodeId = String(conn.source || '');
              break;
            }
          }
          
          for (const conn of allConnections) {
            const sourceId = String(conn.source || '');
            if (sourceId === nodeId) {
              nextNodeId = String(conn.target || '');
              break;
            }
          }
        }
      } catch (err) {
        logger.warn('Erro ao obter conexões do nó', { nodeId: node.id, error: err });
      }
      
      // ✅ Obtém erros de validação diretamente do nó no editor (já formatados como objetos)
      let nodeValidationErrors = [];
      try {
        if (editorRef.current?.editor?.current) {
          const editor = editorRef.current.editor.current;
          const editorNode = editor.getNode(String(node.id || ''));
          const validationErrors = editorNode?.data?.validation?.errors || [];
          
          // ✅ Usa erros exatamente como estão (sem transformação)
          nodeValidationErrors = validationErrors;
        }
      } catch (err) {
        logger.debug('Erro ao obter erros de validação do nó', { nodeId: node.id, error: err });
      }
      
      // ✅ Fallback: se não encontrou erros no editor, tenta buscar nos erros de validação do backend
      if (nodeValidationErrors.length === 0 && validation?.uiErrors) {
        const nodeIdStr = String(node.id || '');
        nodeValidationErrors = (validation.uiErrors || []).filter(
          (err) => Array.isArray(err.nodeIds) && err.nodeIds.includes(nodeIdStr),
        );
      }

      const nodeData = {
        id: String(node.id || ''),
        type: node.type || 'unknown',
        config: node.config || {},
        previousNodeId,
        nextNodeId,
        validationErrors: nodeValidationErrors,
      };
      setSelectedNode(nodeData);
    } else {
      setSelectedNode(null);
    }
  }, [setSelectedNode, validation]);

  const handleUpdateNodeConfig = (nodeId, newConfig) => {
    if (!editorRef.current) return;
    try {
      if (editorRef.current.updateNodeConfig) {
        editorRef.current.updateNodeConfig(nodeId, newConfig);
      } else if (editorRef.current.editor?.current) {
        const editor = editorRef.current.editor.current;
        const node = editor.getNode(nodeId);
        if (node) {
          node.data.config = { ...node.data.config, ...newConfig };
        }
      }
      if (selectedNode && selectedNode.id === nodeId) {
        setSelectedNode({ ...selectedNode, config: { ...selectedNode.config, ...newConfig } });
      }
    } catch (err) {
      logger.error('Erro ao atualizar config do nó', { nodeId, error: err });
    }
  };

  const handleSave = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const reteJson = await editor.toJSON();
      const saved = await saveFlow(reteJson);
    if (saved) {
      setFlowListRefreshTrigger(prev => prev + 1);
      showToast('Fluxo salvo com sucesso', 'success');
    } else {
        showToast('Erro ao salvar fluxo', 'error');
      }
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao salvar fluxo', 'error');
    }
  };

  const handleSaveAsTemplate = async (templateData) => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }

    try {
      const reteJson = await editor.toJSON();
      const flowDefinition = reteJsonToEngineFlow(reteJson, currentFlow || undefined);

      // Prepara o template com o fluxo atual
      const template = {
        ...templateData,
        flow: flowDefinition,
      };

      await saveTemplate(template);
      showToast(`Template "${templateData.name}" salvo com sucesso!`, 'success', 3000);
      setShowSaveAsTemplate(false);
      // Atualiza a lista de templates para incluir o novo template
      setTemplateListRefreshTrigger(prev => prev + 1);
    } catch (err) {
      logger.error('Erro ao salvar template', err);
      const errorMessage = err?.body?.message || err?.message || 'Erro ao salvar template';
      showToast(errorMessage, 'error', 5000);
    }
  };

  const handleValidate = async () => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    // Expande a seção de validação para mostrar os resultados
    setValidationCollapsed(false);
    try {
      const reteJson = await editor.toJSON();
      const validationResult = await validateCurrentFlow(reteJson);
      
      // ✅ Aplica erros de validação do backend aos nós do editor
      // Se válido, passa array vazio (limpa erros do backend)
      // Se inválido, passa os erros recebidos do servidor
      if (validationResult && validationResult.errors) {
        const { applyBackendValidationErrors } = await import('../editor/validation/runFlowValidation');
        applyBackendValidationErrors(editor, area, validationResult.valid ? [] : validationResult.errors);
      }
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao validar fluxo', 'error');
    }
  };

  const handleClearEditor = async () => {
    const editorInstance = editorRef.current;
    if (!editorInstance || !editorInstance.clearEditor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      await editorInstance.clearEditor();
      clearCurrentFlow();
      setSelectedNode(null);
      showToast('Editor limpo com sucesso', 'success');
    } catch (err) {
      logger.error('Erro ao limpar editor', err);
      showToast('Erro ao limpar editor', 'error');
    }
  };

  const handleSimulate = async () => {
    // Expande a seção de simulação para mostrar os resultados
    setSimulationCollapsed(false);
    await simulateCurrentFlow();
  };

  const handleTest = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const reteJson = await editor.toJSON();
      const flowDefinition = reteJsonToEngineFlow(reteJson, currentFlow || undefined);
      setTestFlowDefinition(flowDefinition);
      setTestKey(prev => prev + 1); // Incrementa a key para forçar remontagem e limpar log
      setShowTestChat(true);
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao preparar teste do fluxo', 'error');
    }
  };

  const handleDeleteClick = () => {
    if (!currentFlow || !currentFlow.id) return;
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentFlow || !currentFlow.id) return;
    try {
      await deleteFlow(currentFlow.id);
      
      // ✅ Limpa o editor visual quando o fluxo é removido
      const editor = editorRef.current?.editor?.current;
      if (editor && typeof editor.clear === 'function') {
        editor.clear();
        logger.debug('Editor limpo após remoção do fluxo');
      }
      
      showToast('Fluxo removido com sucesso', 'success');
      setFlowListRefreshTrigger(prev => prev + 1);
    } catch (err) {
      logger.error('Erro ao remover fluxo', { error: err });
      showToast(`Erro ao remover fluxo: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    }
  };

  const handleArrange = async () => {
    try {
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
      
      showToast('Organizando nós...', 'info', 1000);
      await new Promise(resolve => {
        requestAnimationFrame(async () => {
          try {
            await arrange.layout();
            resolve();
          } catch (err) {
            logger.warn('Erro ao calcular layout', { error: err?.message || String(err) });
            resolve();
          }
        });
      });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
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

  // Handlers simplificados para zoom
  const handleZoomIn = async () => {
    const area = editorRef.current?.area;
    if (!area || !area.area) return;
    try {
      const currentZoom = area.area.transform?.k || 1;
      const newZoom = Math.min(currentZoom * 1.2, 3);
      await area.area.zoom(newZoom);
      showToast(`Zoom: ${Math.round(newZoom * 100)}%`, 'info', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom in', { error: err?.message || String(err) });
      showToast('Erro ao aumentar zoom', 'error', 2000);
    }
  };

  const handleZoomOut = async () => {
    const area = editorRef.current?.area;
    if (!area || !area.area) return;
    try {
      const currentZoom = area.area.transform?.k || 1;
      const newZoom = Math.max(currentZoom / 1.2, 0.1);
      await area.area.zoom(newZoom);
      showToast(`Zoom: ${Math.round(newZoom * 100)}%`, 'info', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom out', { error: err?.message || String(err) });
      showToast('Erro ao diminuir zoom', 'error', 2000);
    }
  };

  const handleZoomFit = () => {
    const area = editorRef.current?.area;
    const editor = editorRef.current?.editor?.current;
    if (!area || !editor) return;
    try {
      const nodes = editor.getNodes();
      if (nodes.length === 0) {
        showToast('Nenhum nó para fazer zoom', 'info', 2000);
        return;
      }
      AreaExtensions.zoomAt(area, nodes);
      showToast('Zoom ajustado', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao fazer zoom fit', { error: err });
    }
  };

  const handleResetZoom = async () => {
    const area = editorRef.current?.area;
    if (!area || !area.area) return;
    try {
      await area.area.zoom(1);
      showToast('Zoom resetado para 100%', 'success', 1000);
    } catch (err) {
      logger.warn('Erro ao resetar zoom', { error: err?.message || String(err) });
      showToast('Erro ao resetar zoom', 'error', 2000);
    }
  };

  const handleCenterCanvas = () => {
    const area = editorRef.current?.area;
    const editor = editorRef.current?.editor?.current;
    if (!area || !editor) return;
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

  // Handlers simplificados (stubs para funcionalidades futuras)
  const handleUndo = () => showToast('Undo não implementado', 'warning', 2000);
  const handleRedo = () => showToast('Redo não implementado', 'warning', 2000);
  const handleCopy = () => showToast('Copy não implementado', 'warning', 2000);
  const handlePaste = () => showToast('Paste não implementado', 'warning', 2000);
  const handleDuplicate = () => showToast('Duplicate não implementado', 'warning', 2000);
  const handleSelectAll = () => showToast('Select All não implementado', 'warning', 2000);
  const handleDeselectAll = () => showToast('Deselect All não implementado', 'warning', 2000);
  const handleAlignLeft = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignCenter = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignRight = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignTop = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignMiddle = () => showToast('Align não implementado', 'warning', 2000);
  const handleAlignBottom = () => showToast('Align não implementado', 'warning', 2000);
  const handleDistributeHorizontal = () => showToast('Distribute não implementado', 'warning', 2000);
  const handleDistributeVertical = () => showToast('Distribute não implementado', 'warning', 2000);
  const handleToggleReroutePoints = () => showToast('Reroute não implementado', 'warning', 2000);
  const handleClearOrphanConnections = () => showToast('Clear não implementado', 'warning', 2000);
  const handleSearchNode = () => showToast('Search não implementado', 'warning', 2000);
  const handleGoToNode = () => showToast('Go to não implementado', 'warning', 2000);
  const handleNextNode = () => showToast('Next não implementado', 'warning', 2000);
  const handlePreviousNode = () => showToast('Previous não implementado', 'warning', 2000);
  const handleExportPNG = () => showToast('Export PNG não implementado', 'warning', 2000);
  const handleExportSVG = () => showToast('Export SVG não implementado', 'warning', 2000);
  const handleExportPDF = () => showToast('Export PDF não implementado', 'warning', 2000);
  const handleImportTemplate = () => setShowTemplateSelector(true);
  const handleValidateAndFix = () => showToast('Validate and Fix não implementado', 'warning', 2000);
  const handleShowErrors = () => showToast('Show Errors não implementado', 'warning', 2000);
  const handleToggleDebug = () => showToast('Debug não implementado', 'warning', 2000);
  const handleShowStatistics = () => showToast('Statistics não implementado', 'warning', 2000);
  const handleOptimizeLayout = () => handleArrange();
  const handleSimplifyGraph = () => showToast('Simplify não implementado', 'warning', 2000);
  const handleToggleMinimap = () => showToast('Minimap não implementado', 'warning', 2000);
  const handleImportJson = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };
  const handleExportJson = async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }
    try {
      const reteJson = await editor.toJSON();
      const blob = new Blob([JSON.stringify(reteJson, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = currentFlow?.name ? `${currentFlow.name.replace(/[^a-z0-9]/gi, '_')}.json` : 'flow.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Fluxo exportado com sucesso', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao exportar JSON', err);
      showToast('Erro ao exportar fluxo', 'error', 3000);
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = JSON.parse(reader.result);
        showToast('Importação de JSON não implementada completamente', 'warning', 2000);
      } catch (err) {
        logger.error('Erro ao importar JSON', err);
        showToast('Erro ao importar fluxo: JSON inválido', 'error', 3000);
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flow-editor-page">
      <Toolbar
        onImportJson={handleImportJson}
        onExportJson={handleExportJson}
        onSimulate={handleSimulate}
        onTest={handleTest}
        onSave={handleSave}
        onSaveAsTemplate={() => setShowSaveAsTemplate(true)}
        onValidate={handleValidate}
        onArrange={handleArrange}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onResetZoom={handleResetZoom}
        onCenterCanvas={handleCenterCanvas}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onDuplicate={handleDuplicate}
        onSearchNode={handleSearchNode}
        onGoToNode={handleGoToNode}
        onNextNode={handleNextNode}
        onPreviousNode={handlePreviousNode}
        onClearEditor={handleClearEditor}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportPDF={handleExportPDF}
        onImportTemplate={handleImportTemplate}
        onValidateAndFix={handleValidateAndFix}
        onShowErrors={handleShowErrors}
        onToggleDebug={handleToggleDebug}
        onShowStatistics={handleShowStatistics}
        onOptimizeLayout={handleOptimizeLayout}
        onSimplifyGraph={handleSimplifyGraph}
        onToggleMinimap={handleToggleMinimap}
        minimapVisible={false}
        currentZoom={1}
      >
        <button className="btn-base" onClick={() => setShowTemplateSelector(true)}>
          <span className="icon icon-plus"></span>
          <span>Novo</span>
        </button>
        <FlowSelector
          onFlowSelected={handleFlowSelected}
          currentFlowId={currentFlow?.id}
          refreshTrigger={flowListRefreshTrigger}
        />
        {currentFlow?.id && (
          <button className="btn-base" onClick={handleDeleteClick}>
            <span className="icon icon-delete"></span>
            <span>Remover</span>
          </button>
        )}
        <button className="btn-base" onClick={() => setShowLogViewer(true)}>
          <span className="icon icon-logs"></span>
          <span>Logs</span>
        </button>
        <ThemeSelector />
        <NavigationLink to="/support" className="btn-base">
          <span className="icon">👤</span>
          <span>Atendimento</span>
        </NavigationLink>
        <NavigationLink to="/maintenance" className="btn-base">
          <span className="icon">🔧</span>
          <span>Manutenção</span>
        </NavigationLink>
        <NavigationLink to="/config" className="btn-base">
          <span className="icon">⚙️</span>
          <span>Configuração</span>
        </NavigationLink>
      </Toolbar>

      {showTemplateSelector && (
        <FlowTemplateSelector
          onTemplateSelected={handleTemplateSelected}
          onCancel={() => setShowTemplateSelector(false)}
          refreshTrigger={templateListRefreshTrigger}
        />
      )}

      <SaveAsTemplateDialog
        isOpen={showSaveAsTemplate}
        onClose={() => setShowSaveAsTemplate(false)}
        onSave={handleSaveAsTemplate}
        flowName={currentFlow?.name || 'Fluxo sem nome'}
      />

      {showLogViewer && (
        <LogViewer onClose={() => setShowLogViewer(false)} />
      )}

      {loading && <div className="loading-indicator">Carregando...</div>}

      {/* Barra "Fluxo atual" - EXATAMENTE como no modelo */}
      <div className="flow-current-display">
        Fluxo atual: <strong className="ml-1">{displayedFlow ? (displayedFlow.name || displayedFlow.id) : 'não carregado'}</strong>
      </div>

      {/* MAIN - EXATAMENTE como no modelo */}
      <div className="flex min-h-0">
        {/* PALETA - EXATAMENTE como no modelo */}
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
            <div className="flex-1 p-2 text-sm space-y-2">
                <NodePalette />
            </div>
          ) : (
            <div className="flex-1 p-2 flex flex-col items-center gap-2 overflow-y-auto">
              <NodePaletteCollapsed />
            </div>
          )}
        </div>

        {/* DIVIDER PALETA - EXATAMENTE como no modelo */}
        <ResizableDivider
          direction="horizontal-left"
          targetId="palette"
          onResize={setPaletteWidth}
        />

        {/* CANVAS - EXATAMENTE como no modelo */}
        <div className="flex-1 relative overflow-hidden canvas-container">
          <div className="absolute inset-0 canvas-grid pointer-events-none"></div>
          <div className="relative h-full">
              <FlowEditor
              ref={editorRef}
                onFlowChanged={handleFlowChanged}
                onNodeSelected={handleNodeSelected}
                showToast={showToast}
              />
          </div>
        </div>

        {/* DIVIDER DIREITA - EXATAMENTE como no modelo */}
        <ResizableDivider
          direction="horizontal-right"
          targetId="rightPanel"
          onResize={setRightPanelWidth}
        />

        {/* PAINEL DIREITO - EXATAMENTE como no modelo */}
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
                <div className="flex-1 p-2 section-container flex items-center justify-center vertical">
                  Propriedades
                </div>
                <div className="flex-1 p-2 section-container flex items-center justify-center vertical">
                  Validação
                </div>
                <div className="flex-1 p-2 flex items-center justify-center vertical">
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
                      <SidebarProperties
                        selectedNode={selectedNode}
                        onChangeConfig={(newConfig) => {
                          if (selectedNode?.id) {
                            handleUpdateNodeConfig(selectedNode.id, newConfig);
                          }
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Validação - com colapso vertical */}
                <div className={`flex flex-col ${validationCollapsed ? 'section-collapsed' : 'section-expanded'} section-container`}>
                  <div className="section-header">
                    <span className="section-header-title">Validação</span>
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
                                const errorsByNode = new Map();
                                validation.uiErrors.forEach((err) => {
                                  if (err.nodeIds && err.nodeIds.length > 0) {
                                    err.nodeIds.forEach((nodeId) => {
                                      if (!errorsByNode.has(nodeId)) {
                                        errorsByNode.set(nodeId, []);
                                      }
                                      errorsByNode.get(nodeId).push(err);
                                    });
                                  } else {
                                    if (!errorsByNode.has('_global')) {
                                      errorsByNode.set('_global', []);
                                    }
                                    errorsByNode.get('_global').push(err);
                                  }
                                });

                                return Array.from(errorsByNode.entries()).map(([nodeId, errors]) => (
                                  <div key={nodeId} className="mb-3">
                                    <div className="font-semibold mb-1">
                                      {nodeId !== '_global' ? `Nó: ${nodeId}` : 'Erros Gerais'}
                                    </div>
                                    <ul className="list-disc list-inside space-y-1">
                                      {errors.map((err, idx) => (
                                        <li key={`${err.code}-${idx}`}>
                                          <span className="text-gray-600 dark:text-gray-400">[{err.code}]</span>
                                          <span> {err.message}</span>
                                        </li>
                                      ))}
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
              </>
            )}
          </div>
        </div>
      </div>

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

      <Dialog
        isOpen={showTestChat}
        onClose={() => {
          // Limpa estados visuais antes de fechar
          if (typeof window !== 'undefined') {
            try {
              window.dispatchEvent(
                new CustomEvent('flow-runner-cleanup', {
                  detail: {
                    clearAll: true,
                  },
                }),
              );
            } catch (err) {
              logger.debug('FlowEditorPage - erro ao emitir evento de limpeza', err);
            }
          }
          
          setShowTestChat(false);
          setTestFlowDefinition(null);
          setTestChatSize(null);
        }}
        title="Chat de Teste"
        size="xl"
        draggable={true}
        resizable={true}
        dynamicSize={testChatSize}
      >
        {testFlowDefinition && (
          <div className="h-[600px] min-h-[400px]">
            <FlowTestChat 
              key={testKey} // Key muda quando clica em Testar, forçando remontagem completa e limpeza do log
              flow={testFlowDefinition} 
              onSizeChange={setTestChatSize}
            />
          </div>
        )}
      </Dialog>

      <ToastContainer />
      
      <input
        type="file"
        accept="application/json"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
