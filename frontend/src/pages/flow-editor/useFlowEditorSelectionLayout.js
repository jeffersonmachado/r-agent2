import { useCallback } from 'react';
import { AreaExtensions } from 'rete-area-plugin';
import logger from '../../utils/logger';

export function useFlowEditorSelectionLayout({
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
}) {
  const getEngineSelectionContext = useCallback(() => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area) {
      return null;
    }

    const allNodes = editor.getNodes();
    const selectedNodes = allNodes.filter((node) => !!node?.selected);

    if (selectedNodes.length === 0 && selectedNode?.id) {
      const focusedNode = editor.getNode(String(selectedNode.id));
      if (focusedNode) {
        selectedNodes.push(focusedNode);
      }
    }

    return {
      editor,
      area,
      allNodes,
      selectedNodes,
    };
  }, [editorRef, selectedNode?.id]);

  const getNodeLayout = useCallback((node, area) => {
    const view = area?.nodeViews?.get?.(node?.id);
    const position = view?.position || { x: 0, y: 0 };

    const measuredWidth = Number(node?.width || 0);
    const measuredHeight = Number(node?.height || 0);
    const domWidth = Number(view?.element?.offsetWidth || 0);
    const domHeight = Number(view?.element?.offsetHeight || 0);

    return {
      x: Number(position.x || 0),
      y: Number(position.y || 0),
      width: measuredWidth > 8 ? measuredWidth : (domWidth > 8 ? domWidth : 180),
      height: measuredHeight > 8 ? measuredHeight : (domHeight > 8 ? domHeight : 100),
    };
  }, []);

  const focusEngineNodeById = useCallback((targetNodeId) => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area || !targetNodeId) return false;

    const target = editor.getNode(String(targetNodeId));
    if (!target) return false;

    try {
      editor.getNodes().forEach((candidate) => {
        // eslint-disable-next-line no-param-reassign
        candidate.selected = String(candidate.id) === String(target.id);
      });
      if (typeof area.update === 'function') {
        area.update('node', target.id);
      }
      AreaExtensions.zoomAt(area, [target]);
      setSelectedNode(buildSelectedNodeData(target));
      setBpmnSelection(null);
      setRightPanelCollapsed(false);
      setPropertiesCollapsed(false);
      return true;
    } catch (err) {
      logger.debug('Falha ao focar nó no engine', { error: err, targetNodeId });
      return false;
    }
  }, [
    buildSelectedNodeData,
    editorRef,
    setBpmnSelection,
    setPropertiesCollapsed,
    setRightPanelCollapsed,
    setSelectedNode,
  ]);

  const applyNodeTranslations = useCallback(async (updatesByNodeId) => {
    const area = editorRef.current?.area;
    if (!area || typeof area.translate !== 'function') return 0;

    const entries = Object.entries(updatesByNodeId || {});
    for (const [nodeId, nextPosition] of entries) {
      // eslint-disable-next-line no-await-in-loop
      await area.translate(nodeId, {
        x: Number(nextPosition?.x || 0),
        y: Number(nextPosition?.y || 0),
      });
    }

    if (typeof area.update === 'function') {
      area.update('node');
      area.update('connection');
    }

    handleFlowChanged();
    await captureHistorySnapshot();
    return entries.length;
  }, [captureHistorySnapshot, editorRef, handleFlowChanged]);

  const alignSelectedNodes = useCallback(async (mode) => {
    if (editorMode !== 'engine') {
      showToast('Alinhamento disponível no modo engine', 'info', 1800);
      return;
    }

    const context = getEngineSelectionContext();
    if (!context || context.selectedNodes.length < 2) {
      showToast('Selecione pelo menos 2 nós para alinhar', 'warning', 2200);
      return;
    }

    const metrics = context.selectedNodes.map((node) => ({
      node,
      layout: getNodeLayout(node, context.area),
    }));

    const minX = Math.min(...metrics.map((entry) => entry.layout.x));
    const maxX = Math.max(...metrics.map((entry) => entry.layout.x + entry.layout.width));
    const minY = Math.min(...metrics.map((entry) => entry.layout.y));
    const maxY = Math.max(...metrics.map((entry) => entry.layout.y + entry.layout.height));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const updates = {};
    metrics.forEach(({ node, layout }) => {
      let nextX = layout.x;
      let nextY = layout.y;

      if (mode === 'left') nextX = minX;
      if (mode === 'center') nextX = centerX - layout.width / 2;
      if (mode === 'right') nextX = maxX - layout.width;

      if (mode === 'top') nextY = minY;
      if (mode === 'middle') nextY = centerY - layout.height / 2;
      if (mode === 'bottom') nextY = maxY - layout.height;

      updates[String(node.id)] = { x: nextX, y: nextY };
    });

    const changed = await applyNodeTranslations(updates);
    if (changed > 0) {
      showToast(`Alinhamento aplicado (${changed} nó(s))`, 'success', 1800);
    }
  }, [applyNodeTranslations, editorMode, getEngineSelectionContext, getNodeLayout, showToast]);

  const distributeSelectedNodes = useCallback(async (axis) => {
    if (editorMode !== 'engine') {
      showToast('Distribuição disponível no modo engine', 'info', 1800);
      return;
    }

    const context = getEngineSelectionContext();
    if (!context || context.selectedNodes.length < 3) {
      showToast('Selecione pelo menos 3 nós para distribuir', 'warning', 2200);
      return;
    }

    const metrics = context.selectedNodes.map((node) => ({
      node,
      layout: getNodeLayout(node, context.area),
    }));

    const ordered = metrics.sort((a, b) => {
      if (axis === 'horizontal') return a.layout.x - b.layout.x;
      return a.layout.y - b.layout.y;
    });

    const first = ordered[0];
    const last = ordered[ordered.length - 1];

    const firstCenter = axis === 'horizontal'
      ? first.layout.x + first.layout.width / 2
      : first.layout.y + first.layout.height / 2;
    const lastCenter = axis === 'horizontal'
      ? last.layout.x + last.layout.width / 2
      : last.layout.y + last.layout.height / 2;

    const step = (lastCenter - firstCenter) / (ordered.length - 1);
    const updates = {};

    ordered.forEach((entry, index) => {
      const targetCenter = firstCenter + step * index;
      const nextPosition = {
        x: entry.layout.x,
        y: entry.layout.y,
      };

      if (axis === 'horizontal') {
        nextPosition.x = targetCenter - entry.layout.width / 2;
      } else {
        nextPosition.y = targetCenter - entry.layout.height / 2;
      }

      updates[String(entry.node.id)] = nextPosition;
    });

    const changed = await applyNodeTranslations(updates);
    if (changed > 0) {
      showToast(`Distribuição ${axis === 'horizontal' ? 'horizontal' : 'vertical'} aplicada`, 'success', 1800);
    }
  }, [applyNodeTranslations, editorMode, getEngineSelectionContext, getNodeLayout, showToast]);

  const handleSelectAll = useCallback(() => {
    if (editorMode !== 'engine') {
      showToast('Seleção total disponível no modo engine', 'info', 1800);
      return;
    }

    const context = getEngineSelectionContext();
    if (!context || context.allNodes.length === 0) {
      showToast('Nenhum nó para selecionar', 'info', 1800);
      return;
    }

    context.allNodes.forEach((node) => {
      // eslint-disable-next-line no-param-reassign
      node.selected = true;
    });
    if (typeof context.area.update === 'function') {
      context.area.update('node');
    }

    if (context.allNodes[0]) {
      setSelectedNode(buildSelectedNodeData(context.allNodes[0]));
    }
    showToast(`${context.allNodes.length} nó(s) selecionado(s)`, 'success', 1400);
  }, [buildSelectedNodeData, editorMode, getEngineSelectionContext, setSelectedNode, showToast]);

  const handleDeselectAll = useCallback(() => {
    if (editorMode !== 'engine') {
      setBpmnSelection(null);
      setSelectedNode(null);
      showToast('Seleção limpa', 'success', 1200);
      return;
    }

    const context = getEngineSelectionContext();
    if (!context) {
      showToast('Editor não está pronto', 'warning', 1800);
      return;
    }

    context.allNodes.forEach((node) => {
      // eslint-disable-next-line no-param-reassign
      node.selected = false;
    });
    if (typeof context.area.update === 'function') {
      context.area.update('node');
    }

    setSelectedNode(null);
    setBpmnSelection(null);
    showToast('Seleção limpa', 'success', 1200);
  }, [editorMode, getEngineSelectionContext, setBpmnSelection, setSelectedNode, showToast]);

  return {
    getNodeLayout,
    focusEngineNodeById,
    handleSelectAll,
    handleDeselectAll,
    handleAlignLeft: () => alignSelectedNodes('left'),
    handleAlignCenter: () => alignSelectedNodes('center'),
    handleAlignRight: () => alignSelectedNodes('right'),
    handleAlignTop: () => alignSelectedNodes('top'),
    handleAlignMiddle: () => alignSelectedNodes('middle'),
    handleAlignBottom: () => alignSelectedNodes('bottom'),
    handleDistributeHorizontal: () => distributeSelectedNodes('horizontal'),
    handleDistributeVertical: () => distributeSelectedNodes('vertical'),
  };
}
