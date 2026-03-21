import { useCallback } from 'react';
import { AreaExtensions } from 'rete-area-plugin';
import logger from '../../utils/logger';

function getBpmnStageSizeFromViewport(viewport) {
  return {
    width: Math.max(Math.ceil((viewport?.width || 0) + 120), 800),
    height: Math.max(Math.ceil((viewport?.height || 0) + 120), 500),
  };
}

export function useFlowEditorBpmnZoom({
  bpmnHostRef,
  bpmnZoomRef,
  bpmnViewModel,
  setBpmnZoom,
  editorRef,
  editorMode,
  showToast,
}) {
  const getBpmnScrollContainer = useCallback(() => {
    if (!bpmnHostRef.current) return null;
    return bpmnHostRef.current.querySelector('.bpmn-canvas');
  }, [bpmnHostRef]);

  const centerBpmnCanvas = useCallback(() => {
    const container = getBpmnScrollContainer();
    const viewport = bpmnViewModel?.viewport;
    if (!container || !viewport) return false;

    const stageSize = getBpmnStageSizeFromViewport(viewport);
    const zoom = bpmnZoomRef.current || 1;
    const contentWidth = stageSize.width * zoom;
    const contentHeight = stageSize.height * zoom;

    container.scrollLeft = Math.max(0, (contentWidth - container.clientWidth) / 2);
    container.scrollTop = Math.max(0, (contentHeight - container.clientHeight) / 2);
    return true;
  }, [bpmnViewModel?.viewport, bpmnZoomRef, getBpmnScrollContainer]);

  const centerBpmnSelection = useCallback((selection) => {
    const container = getBpmnScrollContainer();
    const viewport = bpmnViewModel?.viewport;
    if (!container || !viewport || !selection?.kind || !selection?.id) return;

    const maps = {
      node: bpmnViewModel?.nodes,
      participant: bpmnViewModel?.participants,
      lane: bpmnViewModel?.lanes,
      sequenceFlow: bpmnViewModel?.sequenceFlows,
      messageFlow: bpmnViewModel?.messageFlows,
    };

    const source = Array.isArray(maps[selection.kind])
      ? maps[selection.kind].find((entry) => entry.id === selection.id)
      : null;
    if (!source) return;

    let stageX = null;
    let stageY = null;

    if (source.bounds) {
      stageX = source.bounds.x - viewport.minX + 60 + (source.bounds.width || 0) / 2;
      stageY = source.bounds.y - viewport.minY + 60 + (source.bounds.height || 0) / 2;
    } else if (Array.isArray(source.waypoints) && source.waypoints.length > 0) {
      const midpoint = source.waypoints[Math.floor(source.waypoints.length / 2)];
      stageX = midpoint.x - viewport.minX + 60;
      stageY = midpoint.y - viewport.minY + 60;
    }

    if (!Number.isFinite(stageX) || !Number.isFinite(stageY)) return;

    const zoom = bpmnZoomRef.current || 1;
    container.scrollLeft = Math.max(0, stageX * zoom - container.clientWidth / 2);
    container.scrollTop = Math.max(0, stageY * zoom - container.clientHeight / 2);
  }, [
    bpmnViewModel?.lanes,
    bpmnViewModel?.messageFlows,
    bpmnViewModel?.nodes,
    bpmnViewModel?.participants,
    bpmnViewModel?.sequenceFlows,
    bpmnViewModel?.viewport,
    bpmnZoomRef,
    getBpmnScrollContainer,
  ]);

  const setBpmnZoomLevel = useCallback((targetZoom, { toast = true } = {}) => {
    const clamped = Math.max(0.3, Math.min(Number(targetZoom) || 1, 3));
    const container = getBpmnScrollContainer();
    const current = bpmnZoomRef.current || 1;

    if (container) {
      const centerX = (container.scrollLeft + container.clientWidth / 2) / current;
      const centerY = (container.scrollTop + container.clientHeight / 2) / current;

      setBpmnZoom(clamped);
      requestAnimationFrame(() => {
        const nextContainer = getBpmnScrollContainer();
        if (!nextContainer) return;
        nextContainer.scrollLeft = Math.max(0, centerX * clamped - nextContainer.clientWidth / 2);
        nextContainer.scrollTop = Math.max(0, centerY * clamped - nextContainer.clientHeight / 2);
      });
    } else {
      setBpmnZoom(clamped);
    }

    if (toast) {
      showToast(`Zoom BPMN: ${Math.round(clamped * 100)}%`, 'info', 1000);
    }
  }, [bpmnZoomRef, getBpmnScrollContainer, setBpmnZoom, showToast]);

  const handleBpmnZoomFit = useCallback(() => {
    const container = getBpmnScrollContainer();
    const viewport = bpmnViewModel?.viewport;

    if (!container || !viewport) {
      showToast('Nenhum diagrama BPMN disponível para ajustar zoom', 'info', 1800);
      return;
    }

    const stageSize = getBpmnStageSizeFromViewport(viewport);
    const fitByWidth = container.clientWidth / stageSize.width;
    const fitByHeight = container.clientHeight / stageSize.height;
    const nextZoom = Math.max(0.3, Math.min(fitByWidth, fitByHeight, 2.2));

    setBpmnZoomLevel(nextZoom, { toast: false });
    requestAnimationFrame(() => {
      centerBpmnCanvas();
    });
    showToast(`Zoom BPMN ajustado: ${Math.round(nextZoom * 100)}%`, 'success', 1000);
  }, [bpmnViewModel?.viewport, centerBpmnCanvas, getBpmnScrollContainer, setBpmnZoomLevel, showToast]);

  // Zoom do toolbar (engine + BPMN)
  const handleZoomIn = async () => {
    if (editorMode === 'bpmn') {
      setBpmnZoomLevel((bpmnZoomRef.current || 1) * 1.2);
      return;
    }

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
    if (editorMode === 'bpmn') {
      setBpmnZoomLevel((bpmnZoomRef.current || 1) / 1.2);
      return;
    }

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
    if (editorMode === 'bpmn') {
      handleBpmnZoomFit();
      return;
    }

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
    if (editorMode === 'bpmn') {
      setBpmnZoomLevel(1, { toast: false });
      requestAnimationFrame(() => {
        centerBpmnCanvas();
      });
      showToast('Zoom BPMN resetado para 100%', 'success', 1000);
      return;
    }

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
    if (editorMode === 'bpmn') {
      const centered = centerBpmnCanvas();
      if (!centered) {
        showToast('Nenhum diagrama BPMN para centralizar', 'info', 1800);
        return;
      }
      showToast('Canvas BPMN centralizado', 'success', 1000);
      return;
    }

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

  return {
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
  };
}
