import { useCallback } from 'react';

export function useFlowEditorUiControls({
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
}) {
  const handleShowErrors = useCallback(() => {
    setRightPanelCollapsed(false);
    setValidationCollapsed(false);

    const errorCount = Array.isArray(validation?.uiErrors) ? validation.uiErrors.length : 0;
    if (errorCount > 0) {
      showToast(`Exibindo ${errorCount} erro(s)/aviso(s)`, 'info', 1800);
    } else {
      showToast('Nenhum erro de validação para exibir', 'info', 1800);
    }
  }, [setRightPanelCollapsed, setValidationCollapsed, showToast, validation?.uiErrors]);

  const handleToggleDebug = useCallback(() => {
    const next = !debugModeEnabled;
    setDebugModeEnabled(next);
    showToast(`Modo debug ${next ? 'ativado' : 'desativado'}`, 'info', 1600);
  }, [debugModeEnabled, setDebugModeEnabled, showToast]);

  const handleShowStatistics = useCallback(() => {
    if (editorMode === 'bpmn' && canRenderBpmn) {
      const nodeCount = (bpmnViewModel?.nodes || []).length;
      const participantCount = (bpmnViewModel?.participants || []).length;
      const laneCount = (bpmnViewModel?.lanes || []).length;
      const sequenceCount = (bpmnViewModel?.sequenceFlows || []).length;
      const messageCount = (bpmnViewModel?.messageFlows || []).length;
      showToast(
        `BPMN: ${nodeCount} nó(s), ${participantCount} pool(s), ${laneCount} lane(s), ${sequenceCount} sequence flow(s), ${messageCount} message flow(s)`,
        'info',
        4200
      );
      return;
    }

    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 1800);
      return;
    }

    const nodes = editor.getNodes();
    const connections = typeof editor.getConnections === 'function' ? editor.getConnections() : [];
    const selectedCount = nodes.filter((node) => !!node?.selected).length;
    const byType = {};
    nodes.forEach((node) => {
      const type = String(node?.data?.type || 'unknown');
      byType[type] = (byType[type] || 0) + 1;
    });

    const topTypes = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${type}:${count}`)
      .join(', ');

    showToast(
      `Engine: ${nodes.length} nó(s), ${connections.length} conexão(ões), ${selectedCount} selecionado(s)${topTypes ? ` · Top tipos: ${topTypes}` : ''}`,
      'info',
      4200
    );
  }, [
    bpmnViewModel?.lanes,
    bpmnViewModel?.messageFlows,
    bpmnViewModel?.nodes,
    bpmnViewModel?.participants,
    bpmnViewModel?.sequenceFlows,
    canRenderBpmn,
    editorMode,
    editorRef,
    showToast,
  ]);

  const handleOptimizeLayout = useCallback(() => handleArrange(), [handleArrange]);

  const handleToggleMinimap = useCallback(() => {
    const next = !minimapVisible;
    setMinimapVisible(next);
    showToast(`Minimap ${next ? 'ativado' : 'desativado'}`, 'info', 1500);
  }, [minimapVisible, setMinimapVisible, showToast]);

  return {
    handleShowErrors,
    handleToggleDebug,
    handleShowStatistics,
    handleOptimizeLayout,
    handleToggleMinimap,
  };
}
