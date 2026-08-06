import { useCallback } from 'react';
import { AreaExtensions } from 'rete-area-plugin';
import logger from '../../utils/logger';

export function useFlowEditorNodeInteraction({
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
}) {
  const captureHistorySnapshot = useCallback(async ({ resetFuture = true, force = false } = {}) => {
    if (editorMode !== 'engine') return false;

    const editor = editorRef.current?.editor?.current;
    if (!editor || historyRef.current.isApplying) return false;

    try {
      const json = await editor.toJSON();
      const signature = JSON.stringify(json);

      if (!force && signature === historyRef.current.lastSignature) {
        return false;
      }

      historyRef.current.past.push({ json: cloneSerializable(json, {}), signature });
      if (historyRef.current.past.length > 80) {
        historyRef.current.past.shift();
      }

      historyRef.current.lastSignature = signature;
      if (resetFuture) {
        historyRef.current.future = [];
      }
      return true;
    } catch (err) {
      logger.debug('Historico: falha ao capturar snapshot', { error: err });
      return false;
    }
  }, [cloneSerializable, editorMode, editorRef, historyRef]);

  const scheduleHistorySnapshot = useCallback(() => {
    if (editorMode !== 'engine' || historyRef.current.isApplying) return;

    if (historyRef.current.captureTimer) {
      clearTimeout(historyRef.current.captureTimer);
    }

    historyRef.current.captureTimer = setTimeout(() => {
      captureHistorySnapshot().catch((err) => {
        logger.debug('Historico: falha assincrona ao capturar snapshot', { error: err });
      });
    }, 220);
  }, [captureHistorySnapshot, editorMode, historyRef]);

  const handleFlowChanged = useCallback(() => {
    if (!historyRef.current.isApplying) {
      scheduleHistorySnapshot();
    }

    if (isBpmnDiagram && editorMode === 'engine') {
      setBpmnSourceDirty(true);
    }
  }, [editorMode, historyRef, isBpmnDiagram, scheduleHistorySnapshot, setBpmnSourceDirty]);

  const buildSelectedNodeData = useCallback((node) => {
    if (!node) return null;

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
      logger.warn('Erro ao obter conexoes do no', { nodeId: node.id, error: err });
    }

    let nodeValidationErrors = [];
    try {
      if (editorRef.current?.editor?.current) {
        const editor = editorRef.current.editor.current;
        const editorNode = editor.getNode(String(node.id || ''));
        const validationErrors = editorNode?.data?.validation?.errors || [];
        nodeValidationErrors = validationErrors;
      }
    } catch (err) {
      logger.warn('Erro ao obter erros de validacao do no', { nodeId: node.id, error: err });
    }

    if (nodeValidationErrors.length === 0 && validation?.uiErrors) {
      const nodeIdStr = String(node.id || '');
      nodeValidationErrors = (validation.uiErrors || []).filter(
        (err) => Array.isArray(err.nodeIds) && err.nodeIds.includes(nodeIdStr),
      );
    }

    return {
      id: String(node.id || ''),
      type: node.type || node.data?.type || 'unknown',
      config: node.config || node.data?.config || {},
      previousNodeId,
      nextNodeId,
      validationErrors: nodeValidationErrors,
    };
  }, [editorRef, validation]);

  const focusEngineNodeFromBpmnTarget = useCallback((targetId) => {
    const normalizedTarget = String(targetId || '').trim();
    if (!normalizedTarget) return false;

    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor) return false;

    const nodes = editor.getNodes();
    const targetNode = nodes.find((candidate) => {
      const nodeId = String(candidate?.id || '');
      const engineId = String(candidate?.data?.__engineId || '');
      const jsonId = String(candidate?.data?.__jsonId || '');
      const bpmnElementId = String(candidate?.data?.config?.bpmnElementId || '');
      const sourceElementId = String(candidate?.data?.config?.sourceElementId || '');

      return (
        nodeId === normalizedTarget ||
        engineId === normalizedTarget ||
        jsonId === normalizedTarget ||
        bpmnElementId === normalizedTarget ||
        sourceElementId === normalizedTarget
      );
    });

    if (!targetNode) return false;

    try {
      nodes.forEach((candidate) => {
        // eslint-disable-next-line no-param-reassign
        candidate.selected = String(candidate.id) === String(targetNode.id);
      });

      if (area && typeof area.update === 'function') {
        area.update('node', targetNode.id);
      }

      if (area) {
        AreaExtensions.zoomAt(area, [targetNode]);
      }
    } catch (err) {
      logger.debug('Falha best-effort ao sincronizar selecao visual no engine', {
        targetId: normalizedTarget,
        error: err,
      });
    }

    setSelectedNode(buildSelectedNodeData(targetNode));
    return true;
  }, [buildSelectedNodeData, editorRef, setSelectedNode]);

  const handleBpmnElementSelected = useCallback((selection) => {
    setBpmnSelection(selection || null);
    setSelectedNode(null);
    if (selection) {
      setRightPanelCollapsed(false);
      setPropertiesCollapsed(false);
    }
  }, [setBpmnSelection, setPropertiesCollapsed, setRightPanelCollapsed, setSelectedNode]);

  const handleSwitchEditorMode = useCallback((nextMode, preferredEngineTargetId = null) => {
    const normalizedMode = nextMode === 'bpmn' ? 'bpmn' : 'engine';
    const fallbackTargetId = normalizedMode === 'engine' && bpmnSelection?.kind === 'node'
      ? bpmnSelection.id
      : null;
    const targetId = preferredEngineTargetId || fallbackTargetId;

    setEditorMode(normalizedMode);
    setSelectedNode(null);
    setBpmnSelection(null);

    if (normalizedMode === 'engine') {
      scheduleHistorySnapshot();
    }

    if (normalizedMode === 'engine' && targetId) {
      setTimeout(() => {
        const found = focusEngineNodeFromBpmnTarget(targetId);
        if (!found) {
          showToast('Nao foi possivel localizar esse elemento no modo engine.', 'warning', 2500);
        }
      }, 0);
    }
  }, [
    bpmnSelection,
    focusEngineNodeFromBpmnTarget,
    scheduleHistorySnapshot,
    setBpmnSelection,
    setEditorMode,
    setSelectedNode,
    showToast,
  ]);

  const handleNodeSelected = useCallback((node) => {
    if (node) {
      setBpmnSelection(null);
      setSelectedNode(buildSelectedNodeData(node));
      setRightPanelCollapsed(false);
      setPropertiesCollapsed(false);
    } else {
      setBpmnSelection(null);
      setSelectedNode(null);
    }
  }, [buildSelectedNodeData, setBpmnSelection, setPropertiesCollapsed, setRightPanelCollapsed, setSelectedNode]);

  const handleUpdateNodeConfig = useCallback((nodeId, newConfig) => {
    if (!editorRef.current) return;

    try {
      const editor = editorRef.current.editor?.current;
      if (!editor) return;

      const node = editor.getNode(nodeId);
      if (!node) return;

      node.data.config = { ...node.data.config, ...newConfig };

      if (editorRef.current.updateNodeIO) {
        editorRef.current.updateNodeIO(nodeId);
      }

      setSelectedNode((prev) => {
        if (!prev || prev.id !== nodeId) return prev;
        return { ...prev, config: { ...prev.config, ...newConfig } };
      });

      if (editorRef.current.onFlowChanged) {
        editorRef.current.onFlowChanged(editor);
      }
    } catch (err) {
      logger.error('Erro ao atualizar config do no', { nodeId, error: err });
    }
  }, [editorRef, setSelectedNode]);

  return {
    captureHistorySnapshot,
    handleFlowChanged,
    buildSelectedNodeData,
    handleBpmnElementSelected,
    handleSwitchEditorMode,
    handleNodeSelected,
    handleUpdateNodeConfig,
  };
}
