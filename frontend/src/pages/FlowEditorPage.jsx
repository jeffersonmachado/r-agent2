import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useEditor } from '../state/editorStore';
import { createFlow, saveTemplate, updateFlowEnvironment } from '../api/flows';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import logger from '../utils/logger';
import { ResizableDivider } from '../components/ResizableDivider';
import { useToast } from '../components/Toast';
import { useTheme } from '../styles/themeContext';
import { reteJsonToEngineFlow, engineFlowToReteJson } from '../engine-mapper/engineMapper';
import { bpmnXmlToViewModel } from '../bpmn/bpmnXmlToViewModel';
import { engineFlowToBpmnXml } from '../bpmn/engineFlowToBpmnXml';
import { NavigationLink } from '../components/NavigationLink';
import { FallbackEventsViewer } from '../components/FallbackEventsViewer';
import { applyBackendValidationErrors } from '../editor/validation/runFlowValidation';
import { useIsMobile } from '../hooks/useIsMobile';
import { shouldLockCanvas as shouldLockCanvasUtil } from '../utils/aiGenerationLock';
import { FlowEditorOverlays } from './flow-editor/FlowEditorOverlays';
import { FlowEditorRightPanel } from './flow-editor/FlowEditorRightPanel';
import { FlowEditorPalettePanel } from './flow-editor/FlowEditorPalettePanel';
import { FlowEditorCanvasSection } from './flow-editor/FlowEditorCanvasSection';
import { FlowEditorToolbarSection } from './flow-editor/FlowEditorToolbarSection';
import { useFlowEditorBpmnZoom } from './flow-editor/useFlowEditorBpmnZoom';
import { useFlowEditorExport } from './flow-editor/useFlowEditorExport';
import { useFlowEditorSelectionLayout } from './flow-editor/useFlowEditorSelectionLayout';
import { useFlowEditorSearchNavigation } from './flow-editor/useFlowEditorSearchNavigation';
import { useFlowEditorFileIO } from './flow-editor/useFlowEditorFileIO';
import { useFlowEditorMaintenance } from './flow-editor/useFlowEditorMaintenance';
import { useFlowEditorUiControls } from './flow-editor/useFlowEditorUiControls';
import { useFlowEditorClipboard } from './flow-editor/useFlowEditorClipboard';
import { useFlowEditorCanvasHistory } from './flow-editor/useFlowEditorCanvasHistory';
import { useFlowEditorWorkflowActions } from './flow-editor/useFlowEditorWorkflowActions';
import { useFlowEditorLifecycle } from './flow-editor/useFlowEditorLifecycle';
import { useFlowEditorNodeInteraction } from './flow-editor/useFlowEditorNodeInteraction';
import { useFlowEditorRealtimeStatus } from './flow-editor/useFlowEditorRealtimeStatus';

function summarizeValidationBySeverity(validationWarnings) {
  const errors = Array.isArray(validationWarnings?.errors) ? validationWarnings.errors : [];
  const counts = { error: 0, warning: 0, info: 0, other: 0, total: errors.length };
  for (const e of errors) {
    const sev = String(e?.severity || 'warning').toLowerCase();
    if (sev === 'error') counts.error += 1;
    else if (sev === 'warning') counts.warning += 1;
    else if (sev === 'info') counts.info += 1;
    else counts.other += 1;
  }
  return counts;
}

function hasBlockingValidationErrors(validationWarnings) {
  const errors = Array.isArray(validationWarnings?.errors) ? validationWarnings.errors : [];
  return errors.some((e) => String(e?.severity || 'warning').toLowerCase() === 'error');
}

function getBpmnStageSizeFromViewport(viewport) {
  return {
    width: Math.max(Math.ceil((viewport?.width || 0) + 120), 800),
    height: Math.max(Math.ceil((viewport?.height || 0) + 120), 500),
  };
}

function cloneSerializable(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

export function FlowEditorPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { themeName } = useTheme();
  const isMobile = useIsMobile();
  const [flowEnvironment, setFlowEnvironment] = useState('dev');

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  // Adiciona classe ao body quando estiver no editor para estilizar UserMenu como flutuante
  useEffect(() => {
    document.body.classList.add('flow-editor-active');
    return () => {
      document.body.classList.remove('flow-editor-active');
    };
  }, []);

  if (authLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p>Carregando...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }
  const {
    currentFlow,
    selectedNode,
    validation,
    simulation,
    loading,
    error,
    setSelectedNode,
    setValidation,
    setCurrentFlowKind,
    validateCurrentFlow,
    saveFlow,
    simulateCurrentFlow,
    loadFlow,
    deleteFlow,
    clearCurrentFlow,
  } = useEditor();

  // Se a página foi aberta com ?flowId=..., carrega automaticamente o fluxo
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const flowId = params.get('flowId');
      if (flowId) {
        loadFlow(flowId).catch(() => {});
      }
    } catch {}
  }, [loadFlow]);

  useEffect(() => {
    const env = currentFlow?.metadata?.environment;
    if (env && ['dev', 'stage', 'prod'].includes(String(env))) {
      setFlowEnvironment(String(env));
    } else if (currentFlow?.id) {
      setFlowEnvironment('dev');
    }
  }, [currentFlow?.id, currentFlow?.metadata?.environment]);

  const editorRef = useRef(null);
  const fileInputRef = useRef(null);
  // ✅ Se o auto-layout (rete-auto-arrange-plugin) falhar, desabilitamos ele nesta sessão
  // para evitar repetir erros no console e cair direto no fallback de grade.
  const arrangeDisabledRef = useRef(false);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showFlowGenerator, setShowFlowGenerator] = useState(false);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [showLogViewer, setShowLogViewer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTestChat, setShowTestChat] = useState(false);
  const [testFlowDefinition, setTestFlowDefinition] = useState(null);
  const [testChatSize, setTestChatSize] = useState(null);
  const [testKey, setTestKey] = useState(0);
  const [showGeneratedFlowModal, setShowGeneratedFlowModal] = useState(false);
  const [generatedFlowModalData, setGeneratedFlowModalData] = useState(null);
  const [flowListRefreshTrigger, setFlowListRefreshTrigger] = useState(0);
  const [templateListRefreshTrigger, setTemplateListRefreshTrigger] = useState(0);
  const { showToast, ToastContainer } = useToast();
  const lastErrorRef = useRef(null);
  
  // Estados para replay de sessão
  const [sessionId, setSessionId] = useState('');
  const [replay, setReplay] = useState(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [replayError, setReplayError] = useState(null);
  const [replayCollapsed, setReplayCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });

  const wsStatus = useFlowEditorRealtimeStatus({
    isAuthenticated,
    currentFlow,
    loadFlow,
    showToast,
  });

  // Monitora erros do editorStore e exibe via Toast
  useEffect(() => {
    // Ignora erros de validação e flow_not_found (já tratados em outros lugares)
    if (!error || error.includes('"validation_failed"') || error.includes('flow_not_found')) {
      return;
    }
    
    // Evita exibir o mesmo erro múltiplas vezes
    if (lastErrorRef.current === error) {
      return;
    }
    
    lastErrorRef.current = error;
    
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
    
    // Limpa a referência após um tempo para permitir que o mesmo erro seja exibido novamente se necessário
    setTimeout(() => {
      if (lastErrorRef.current === error) {
        lastErrorRef.current = null;
      }
    }, 6000);
  }, [error, showToast]);
  
  // Estados para colapso e larguras (EXATAMENTE como no modelo)
  // Em mobile, inicia recolhido
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  
  // Estados para colapso vertical dos painéis do painel direito
  // Em mobile, inicia recolhido
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < 768;
  });
  const [validationCollapsed, setValidationCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth < 768;
  }); // Em mobile, inicia colapsada
  const [simulationCollapsed, setSimulationCollapsed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth < 768;
  }); // Em mobile, inicia colapsada
  
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
  const [canvasLocked, setCanvasLocked] = useState(false);
  const [canvasLockReason, setCanvasLockReason] = useState(null);
  const [draftFlow, setDraftFlow] = useState(null);
  const [draftMeta, setDraftMeta] = useState(null);
  const [editorMode, setEditorMode] = useState('engine');
  const [bpmnViewModel, setBpmnViewModel] = useState(null);
  const [bpmnSelection, setBpmnSelection] = useState(null);
  const [bpmnZoom, setBpmnZoom] = useState(1);
  const [bpmnSourceDirty, setBpmnSourceDirty] = useState(false);
  const [debugModeEnabled, setDebugModeEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('flowEditorDebugMode') === '1';
  });
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [reroutePointsVisible, setReroutePointsVisible] = useState(false);
  const bpmnHostRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const bpmnZoomRef = useRef(1);
  const historyRef = useRef({
    past: [],
    future: [],
    lastSignature: null,
    isApplying: false,
    captureTimer: null,
  });
  const lastBpmnSourceSignatureRef = useRef(null);
  const bpmnImportSessionRef = useRef(0);

  useEffect(() => {
    bpmnZoomRef.current = bpmnZoom;
  }, [bpmnZoom]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('flow-editor-debug-mode', !!debugModeEnabled);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('flowEditorDebugMode', debugModeEnabled ? '1' : '0');
    }

    return () => {
      document.body.classList.remove('flow-editor-debug-mode');
    };
  }, [debugModeEnabled]);

  useEffect(() => {
    return () => {
      if (historyRef.current.captureTimer) {
        clearTimeout(historyRef.current.captureTimer);
      }
    };
  }, []);

  const shouldLockCanvas = useCallback((aiGeneration) => {
    return shouldLockCanvasUtil(aiGeneration);
  }, []);

  useEffect(() => {
    if (currentFlow && currentFlow.id) {
      setDisplayedFlow(currentFlow);
    } else if (draftFlow && draftFlow.id) {
      setDisplayedFlow(draftFlow);
    } else {
      setDisplayedFlow(null);
    }
  }, [currentFlow, draftFlow]);

  const activeFlow = (currentFlow && currentFlow.id) ? currentFlow : draftFlow;
  const activeFlowMetadata = (!currentFlow || !currentFlow.id)
    ? { ...(draftFlow?.metadata || {}), ...(draftMeta?.metadata || {}) }
    : (currentFlow?.metadata || {});
  const isBpmnDiagram = activeFlowMetadata?.diagramType === 'bpmn';
  const canRenderBpmn = Boolean(isBpmnDiagram && bpmnViewModel);

  const {
    captureHistorySnapshot,
    handleFlowChanged,
    buildSelectedNodeData,
    handleBpmnElementSelected,
    handleSwitchEditorMode,
    handleNodeSelected,
    handleUpdateNodeConfig,
  } = useFlowEditorNodeInteraction({
    editorMode,
    editorRef,
    historyRef,
    cloneSerializable,
    isBpmnDiagram,
    setBpmnSourceDirty,
    validation,
    setSelectedNode,
    setBpmnSelection,
    setRightPanelCollapsed,
    setPropertiesCollapsed,
    bpmnSelection,
    setEditorMode,
    showToast,
  });

  const {
    getBpmnScrollContainer,
    centerBpmnCanvas,
    centerBpmnSelection,
    setBpmnZoomLevel,
    handleBpmnZoomFit,
    handleZoomIn,
    handleZoomOut,
    handleZoomFit,
    handleResetZoom,
    handleCenterCanvas,
  } = useFlowEditorBpmnZoom({
    bpmnHostRef,
    bpmnZoomRef,
    bpmnViewModel,
    setBpmnZoom,
    editorRef,
    editorMode,
    showToast,
  });

  const {
    handleExportSVG,
    handleExportPNG,
    handleExportPDF,
  } = useFlowEditorExport({
    canRenderBpmn,
    bpmnViewModel,
    editorRef,
    draftMeta,
    currentFlow,
    activeFlow,
    draftFlow,
    activeFlowMetadata,
    agent,
    showToast,
  });

  const {
    getNodeLayout,
    focusEngineNodeById,
    handleSelectAll,
    handleDeselectAll,
    handleAlignLeft,
    handleAlignCenter,
    handleAlignRight,
    handleAlignTop,
    handleAlignMiddle,
    handleAlignBottom,
    handleDistributeHorizontal,
    handleDistributeVertical,
  } = useFlowEditorSelectionLayout({
    editorRef,
    selectedNode,
    setSelectedNode,
    setBpmnSelection,
    setRightPanelCollapsed,
    setPropertiesCollapsed,
    buildSelectedNodeData,
    handleFlowChanged,
    captureHistorySnapshot,
    editorMode,
    showToast,
  });

  const {
    handleSearchNode,
    handleGoToNode,
    handleNextNode,
    handlePreviousNode,
  } = useFlowEditorSearchNavigation({
    editorMode,
    canRenderBpmn,
    bpmnViewModel,
    setBpmnSelection,
    setRightPanelCollapsed,
    setPropertiesCollapsed,
    centerBpmnSelection,
    showToast,
    editorRef,
    getNodeLayout,
    focusEngineNodeById,
    selectedNode,
    setSelectedNode,
    buildSelectedNodeData,
  });

  const {
    handleImportJson,
    handleExportJson,
    handleFileChange,
  } = useFlowEditorFileIO({
    fileInputRef,
    editorRef,
    showToast,
    activeFlow,
    currentFlow,
    isBpmnDiagram,
    bpmnSourceDirty,
    activeFlowMetadata,
    draftMeta,
    agent,
    draftFlow,
    editorMode,
    setDraftFlow,
    setDraftMeta,
    setBpmnViewModel,
    setBpmnSelection,
    setBpmnSourceDirty,
    setEditorMode,
    setCanvasLocked,
    setCanvasLockReason,
    clearCurrentFlow,
    setSelectedNode,
    bpmnImportSessionRef,
    validateCurrentFlow,
    setValidationCollapsed,
  });

  const {
    handleCopy,
    handlePaste,
    handleDuplicate,
  } = useFlowEditorClipboard({
    editorMode,
    showToast,
    editorRef,
    selectedNode,
    cloneSerializable,
    setSelectedNode,
    buildSelectedNodeData,
    setBpmnSelection,
    setRightPanelCollapsed,
    setPropertiesCollapsed,
    handleFlowChanged,
    captureHistorySnapshot,
  });

  const {
    handleArrange,
    handleUndo,
    handleRedo,
    handleToggleReroutePoints,
  } = useFlowEditorCanvasHistory({
    editorMode,
    showToast,
    editorRef,
    captureHistorySnapshot,
    arrangeDisabledRef,
    historyRef,
    cloneSerializable,
    setSelectedNode,
    reroutePointsVisible,
    setReroutePointsVisible,
  });

  const {
    handleSave,
    handleSaveAsTemplate,
    handleValidate,
    handleClearEditor,
    handleSimulate,
    handleTest,
    handleEnvironmentChange,
    handleDeleteClick,
    handleDeleteConfirm,
  } = useFlowEditorWorkflowActions({
    editorRef,
    showToast,
    saveFlow,
    draftMeta,
    currentFlow,
    activeFlow,
    agent,
    draftFlow,
    activeFlowMetadata,
    isBpmnDiagram,
    editorMode,
    setDraftFlow,
    setDraftMeta,
    setCanvasLocked,
    setCanvasLockReason,
    setFlowListRefreshTrigger,
    setShowSaveAsTemplate,
    setTemplateListRefreshTrigger,
    setValidationCollapsed,
    validateCurrentFlow,
    setValidation,
    clearCurrentFlow,
    setSelectedNode,
    setSimulationCollapsed,
    simulateCurrentFlow,
    setTestFlowDefinition,
    setTestKey,
    setShowTestChat,
    setFlowEnvironment,
    loadFlow,
    setShowDeleteConfirm,
    deleteFlow,
  });

  const {
    handleLoadReplay,
    handleSeekNode,
    handleValidateAndFix,
    handleSimplifyGraph,
  } = useFlowEditorMaintenance({
    sessionId,
    setLoadingReplay,
    setReplayError,
    setReplay,
    setReplayCollapsed,
    showToast,
    editorRef,
    setSelectedNode,
    editorMode,
    handleFlowChanged,
    captureHistorySnapshot,
    handleValidate,
    handleArrange,
  });

  const {
    handleShowErrors,
    handleToggleDebug,
    handleShowStatistics,
    handleOptimizeLayout,
    handleToggleMinimap,
  } = useFlowEditorUiControls({
    setRightPanelCollapsed,
    setValidationCollapsed,
    validation,
    showToast,
    debugModeEnabled,
    setDebugModeEnabled,
    editorMode,
    canRenderBpmn,
    bpmnViewModel,
    editorRef,
    handleArrange,
    minimapVisible,
    setMinimapVisible,
  });

  useEffect(() => {
    if (historyRef.current.captureTimer) {
      clearTimeout(historyRef.current.captureTimer);
    }
    historyRef.current.past = [];
    historyRef.current.future = [];
    historyRef.current.lastSignature = null;
  }, [currentFlow?.id, draftFlow?.id]);

  useEffect(() => {
    const sourceFlow = (currentFlow && currentFlow.id) ? currentFlow : draftFlow;
    const sourceMetadata = (!currentFlow || !currentFlow.id)
      ? { ...(draftFlow?.metadata || {}), ...(draftMeta?.metadata || {}) }
      : (currentFlow?.metadata || {});

    if (!sourceMetadata || sourceMetadata.diagramType !== 'bpmn') {
      setBpmnViewModel(null);
      setBpmnSelection(null);
      setBpmnZoom(1);
      setBpmnSourceDirty(false);
      setEditorMode('engine');
      lastBpmnSourceSignatureRef.current = null;
      return;
    }

    const sourceXml = typeof sourceMetadata.sourceXml === 'string' && sourceMetadata.sourceXml.trim()
      ? sourceMetadata.sourceXml
      : null;
    const desiredMode = sourceMetadata.editorMode === 'engine' ? 'engine' : 'bpmn';
    const sourceSignature = `${sourceFlow?.id || 'draft'}::${sourceXml || 'generated'}`;

    try {
      const xmlForView = sourceXml || engineFlowToBpmnXml(sourceFlow || { nodes: [] }).xml;
      const nextViewModel = bpmnXmlToViewModel(xmlForView, {
        name: sourceMetadata?.sourceName || sourceFlow?.name || null,
      });
      setBpmnViewModel(nextViewModel);
      setEditorMode(desiredMode);
      setBpmnSelection(null);
      setBpmnZoom(1);
      if (lastBpmnSourceSignatureRef.current !== sourceSignature) {
        setBpmnSourceDirty(false);
        lastBpmnSourceSignatureRef.current = sourceSignature;
      }
    } catch (err) {
      logger.warn('Falha ao preparar modo BPMN visual', {
        flowId: sourceFlow?.id,
        error: err,
      });
      setBpmnViewModel(null);
      setBpmnSelection(null);
      setBpmnZoom(1);
      setEditorMode('engine');
      if (sourceXml) {
        showToast('Falha ao abrir o modo BPMN visual. Mantendo o editor engine.', 'warning', 4000);
      }
    }
  }, [
    currentFlow?.id,
    currentFlow?.metadata?.diagramType,
    currentFlow?.metadata?.editorMode,
    currentFlow?.metadata?.sourceXml,
    draftFlow?.id,
    draftFlow?.metadata?.diagramType,
    draftFlow?.metadata?.editorMode,
    draftFlow?.metadata?.sourceXml,
    draftMeta?.metadata?.diagramType,
    draftMeta?.metadata?.editorMode,
    draftMeta?.metadata?.sourceXml,
    showToast,
  ]);

  const {
    handleFlowKindChange,
    handleFlowSelected,
    handleFlowGenerated,
    handleTemplateSelected,
  } = useFlowEditorLifecycle({
    isBpmnDiagram,
    showToast,
    currentFlow,
    draftFlow,
    setCurrentFlowKind,
    setDraftFlow,
    setValidationCollapsed,
    validation,
    editorRef,
    setCanvasLocked,
    setCanvasLockReason,
    setDraftMeta,
    loadFlow,
    validateCurrentFlow,
    setValidation,
    clearCurrentFlow,
    setShowFlowGenerator,
    agent,
    setFlowListRefreshTrigger,
    setSelectedNode,
    setGeneratedFlowModalData,
    setShowGeneratedFlowModal,
    setShowTemplateSelector,
    summarizeValidationBySeverity,
    hasBlockingValidationErrors,
  });

  // ✅ Expande automaticamente o painel de validação quando há erros
  useEffect(() => {
    if (validation && !validation.valid && validation.uiErrors && validation.uiErrors.length > 0) {
      const hasBlockingErrors = hasBlockingValidationErrors({ errors: validation.uiErrors });
      if (!hasBlockingErrors) {
        // Warnings/info não forçam o painel a abrir automaticamente
        return;
      }

      logger.info('Painel de validação expandido automaticamente devido a erros', {
        errorCount: validation.uiErrors.length,
        hasGlobalErrors: validation.uiErrors.some(e => !e.nodeIds || e.nodeIds.length === 0),
      });
      setValidationCollapsed(false);
    }
  }, [validation]);

  // ✅ Ponte: sempre aplica o estado de validação no canvas quando possível
  // Isso evita o comportamento “painel mostra erros, mas nós só ficam vermelhos após clicar em Validar”.
  useEffect(() => {
    if (!validation) return;

    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area) return;

    // ✅ "valid" pode vir true mesmo com warnings/info.
    // Portanto, aplicamos SEMPRE `uiErrors` (ou `errors`) para que warnings
    // também apareçam no canvas/nós e no painel.
    const uiErrors = (validation.uiErrors || validation.errors || []);

    (async () => {
      applyBackendValidationErrors(editor, area, uiErrors);
    })().catch((err) => {
      logger.warn('Falha ao aplicar erros de validação no canvas (best-effort)', { error: err });
    });
  }, [validation, displayedFlow]);

  return (
    <div className={`flow-editor-page ${debugModeEnabled ? 'is-debug-mode' : ''} ${minimapVisible ? 'is-minimap-visible' : ''} ${reroutePointsVisible ? 'is-reroute-visible' : ''}`}>
      <FlowEditorToolbarSection
        handleImportJson={handleImportJson}
        handleExportJson={handleExportJson}
        handleSimulate={handleSimulate}
        handleTest={handleTest}
        handleSave={handleSave}
        handleValidate={handleValidate}
        handleArrange={handleArrange}
        handleZoomIn={handleZoomIn}
        handleZoomOut={handleZoomOut}
        handleZoomFit={handleZoomFit}
        handleResetZoom={handleResetZoom}
        handleCenterCanvas={handleCenterCanvas}
        handleUndo={handleUndo}
        handleRedo={handleRedo}
        handleCopy={handleCopy}
        handlePaste={handlePaste}
        handleDuplicate={handleDuplicate}
        handleSearchNode={handleSearchNode}
        handleGoToNode={handleGoToNode}
        handleNextNode={handleNextNode}
        handlePreviousNode={handlePreviousNode}
        handleClearEditor={handleClearEditor}
        handleExportPNG={handleExportPNG}
        handleExportSVG={handleExportSVG}
        handleExportPDF={handleExportPDF}
        handleImportTemplate={() => setShowTemplateSelector(true)}
        handleValidateAndFix={handleValidateAndFix}
        handleShowErrors={handleShowErrors}
        handleToggleDebug={handleToggleDebug}
        handleShowStatistics={handleShowStatistics}
        handleOptimizeLayout={handleOptimizeLayout}
        handleSimplifyGraph={handleSimplifyGraph}
        handleToggleMinimap={handleToggleMinimap}
        minimapVisible={minimapVisible}
        isAuthenticated={isAuthenticated}
        wsStatus={wsStatus}
        handleFlowSelected={handleFlowSelected}
        currentFlow={currentFlow}
        flowListRefreshTrigger={flowListRefreshTrigger}
        flowEnvironment={flowEnvironment}
        handleEnvironmentChange={handleEnvironmentChange}
        setShowTemplateSelector={setShowTemplateSelector}
        setShowFlowGenerator={setShowFlowGenerator}
        handleDeleteClick={handleDeleteClick}
        setShowLogViewer={setShowLogViewer}
        setShowSaveAsTemplate={setShowSaveAsTemplate}
        isBpmnDiagram={isBpmnDiagram}
        editorMode={editorMode}
        canRenderBpmn={canRenderBpmn}
        handleSwitchEditorMode={handleSwitchEditorMode}
        showTemplateSelector={showTemplateSelector}
        handleTemplateSelected={handleTemplateSelected}
        templateListRefreshTrigger={templateListRefreshTrigger}
        showFlowGenerator={showFlowGenerator}
        handleFlowGenerated={handleFlowGenerated}
        showSaveAsTemplate={showSaveAsTemplate}
        handleSaveAsTemplate={handleSaveAsTemplate}
        showLogViewer={showLogViewer}
        loading={loading}
        displayedFlow={displayedFlow}
        handleFlowKindChange={handleFlowKindChange}
      />

      {/* MAIN - EXATAMENTE como no modelo */}
      <div className="flex min-h-0">
        {/* PALETA - EXATAMENTE como no modelo */}
        <FlowEditorPalettePanel
          paletteCollapsed={paletteCollapsed}
          paletteWidth={paletteWidth}
          togglePalette={togglePalette}
          isBpmnDiagram={isBpmnDiagram}
          displayedFlow={displayedFlow}
          currentFlow={currentFlow}
          handleFlowKindChange={handleFlowKindChange}
        />

        {/* DIVIDER PALETA - EXATAMENTE como no modelo */}
        <ResizableDivider
          direction="horizontal-left"
          targetId="palette"
          onResize={setPaletteWidth}
        />

        {/* CANVAS - EXATAMENTE como no modelo */}
        <FlowEditorCanvasSection
          canvasContainerRef={canvasContainerRef}
          canvasLocked={canvasLocked}
          editorMode={editorMode}
          canRenderBpmn={canRenderBpmn}
          editorRef={editorRef}
          handleFlowChanged={handleFlowChanged}
          handleNodeSelected={handleNodeSelected}
          showToast={showToast}
          bpmnHostRef={bpmnHostRef}
          bpmnViewModel={bpmnViewModel}
          bpmnSelection={bpmnSelection}
          handleBpmnElementSelected={handleBpmnElementSelected}
          bpmnZoom={bpmnZoom}
          canvasLockReason={canvasLockReason}
          setShowFlowGenerator={setShowFlowGenerator}
          setCanvasLocked={setCanvasLocked}
          setCanvasLockReason={setCanvasLockReason}
        />

        {/* DIVIDER DIREITA - EXATAMENTE como no modelo */}
        <ResizableDivider
          direction="horizontal-right"
          targetId="rightPanel"
          onResize={setRightPanelWidth}
        />

        {/* PAINEL DIREITO - EXATAMENTE como no modelo */}
        <FlowEditorRightPanel
          rightPanelCollapsed={rightPanelCollapsed}
          rightPanelWidth={rightPanelWidth}
          toggleRightPanel={toggleRightPanel}
          setRightPanelCollapsed={setRightPanelCollapsed}
          setPropertiesCollapsed={setPropertiesCollapsed}
          setValidationCollapsed={setValidationCollapsed}
          setSimulationCollapsed={setSimulationCollapsed}
          propertiesCollapsed={propertiesCollapsed}
          validationCollapsed={validationCollapsed}
          simulationCollapsed={simulationCollapsed}
          replayCollapsed={replayCollapsed}
          setReplayCollapsed={setReplayCollapsed}
          editorMode={editorMode}
          canRenderBpmn={canRenderBpmn}
          bpmnSelection={bpmnSelection}
          bpmnViewModel={bpmnViewModel}
          handleSwitchEditorMode={handleSwitchEditorMode}
          selectedNode={selectedNode}
          handleUpdateNodeConfig={handleUpdateNodeConfig}
          editorRef={editorRef}
          logger={logger}
          validation={validation}
          summarizeValidationBySeverity={summarizeValidationBySeverity}
          simulation={simulation}
          sessionId={sessionId}
          setSessionId={setSessionId}
          loadingReplay={loadingReplay}
          handleLoadReplay={handleLoadReplay}
          replayError={replayError}
          replay={replay}
          handleSeekNode={handleSeekNode}
        />
      </div>

      <FlowEditorOverlays
        currentFlow={currentFlow}
        showDeleteConfirm={showDeleteConfirm}
        setShowDeleteConfirm={setShowDeleteConfirm}
        handleDeleteConfirm={handleDeleteConfirm}
        showTestChat={showTestChat}
        setShowTestChat={setShowTestChat}
        setTestFlowDefinition={setTestFlowDefinition}
        setTestChatSize={setTestChatSize}
        testChatSize={testChatSize}
        testFlowDefinition={testFlowDefinition}
        testKey={testKey}
        showGeneratedFlowModal={showGeneratedFlowModal}
        setShowGeneratedFlowModal={setShowGeneratedFlowModal}
        generatedFlowModalData={generatedFlowModalData}
        setGeneratedFlowModalData={setGeneratedFlowModalData}
        showToast={showToast}
        ToastContainer={ToastContainer}
        fileInputRef={fileInputRef}
        handleFileChange={handleFileChange}
        logger={logger}
      />
    </div>
  );
}
