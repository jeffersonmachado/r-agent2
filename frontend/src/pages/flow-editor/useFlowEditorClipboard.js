import { useCallback, useRef } from 'react';
import { createNode } from '../../editor/nodeFactory';
import logger from '../../utils/logger';

export function useFlowEditorClipboard({
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
}) {
  const clipboardRef = useRef(null);

  const handleCopy = useCallback(() => {
    if (editorMode !== 'engine') {
      showToast('Copiar disponível no modo engine', 'info', 1800);
      return;
    }

    const editor = editorRef.current?.editor?.current;
    if (!editor || !selectedNode?.id) {
      showToast('Selecione um nó para copiar', 'warning', 1800);
      return;
    }

    const node = editor.getNode(String(selectedNode.id));
    const nodeType = String(node?.data?.type || selectedNode.type || '').trim();
    if (!nodeType) {
      showToast('Não foi possível copiar esse nó', 'error', 2000);
      return;
    }

    clipboardRef.current = {
      type: nodeType,
      config: cloneSerializable(node?.data?.config || selectedNode.config || {}, {}),
    };

    showToast('Nó copiado', 'success', 1200);
  }, [cloneSerializable, editorMode, editorRef, selectedNode, showToast]);

  const handlePaste = useCallback(async () => {
    if (editorMode !== 'engine') {
      showToast('Colar disponível no modo engine', 'info', 1800);
      return;
    }

    const clipboard = clipboardRef.current;
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;

    if (!clipboard?.type) {
      showToast('Nada copiado para colar', 'warning', 1800);
      return;
    }

    if (!editor || !area) {
      showToast('Editor não está pronto', 'warning', 1800);
      return;
    }

    try {
      const node = createNode(clipboard.type, {
        config: cloneSerializable(clipboard.config || {}, {}),
      });
      await editor.addNode(node);

      let targetPosition = { x: 120, y: 120 };
      if (selectedNode?.id) {
        const anchor = editor.getNode(String(selectedNode.id));
        const anchorPosition = area.nodeViews?.get(anchor?.id)?.position;
        if (anchorPosition) {
          targetPosition = {
            x: Number(anchorPosition.x || 0) + 80,
            y: Number(anchorPosition.y || 0) + 60,
          };
        }
      }

      await area.translate(node.id, targetPosition);

      editor.getNodes().forEach((candidate) => {
        // eslint-disable-next-line no-param-reassign
        candidate.selected = String(candidate.id) === String(node.id);
      });
      if (typeof area.update === 'function') {
        area.update('node', node.id);
      }

      setSelectedNode(buildSelectedNodeData(node));
      setBpmnSelection(null);
      setRightPanelCollapsed(false);
      setPropertiesCollapsed(false);

      handleFlowChanged();
      await captureHistorySnapshot();
      showToast('Nó colado', 'success', 1200);
    } catch (err) {
      logger.error('Erro ao colar nó', { error: err });
      showToast('Falha ao colar nó', 'error', 2200);
    }
  }, [
    buildSelectedNodeData,
    captureHistorySnapshot,
    cloneSerializable,
    editorMode,
    editorRef,
    handleFlowChanged,
    selectedNode?.id,
    setBpmnSelection,
    setPropertiesCollapsed,
    setRightPanelCollapsed,
    setSelectedNode,
    showToast,
  ]);

  const handleDuplicate = useCallback(async () => {
    if (editorMode !== 'engine') {
      showToast('Duplicar disponível no modo engine', 'info', 1800);
      return;
    }

    if (!selectedNode?.id) {
      showToast('Selecione um nó para duplicar', 'warning', 1800);
      return;
    }

    handleCopy();
    await handlePaste();
  }, [editorMode, handleCopy, handlePaste, selectedNode?.id, showToast]);

  return {
    handleCopy,
    handlePaste,
    handleDuplicate,
  };
}
