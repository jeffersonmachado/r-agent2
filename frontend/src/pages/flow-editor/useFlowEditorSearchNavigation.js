import { useCallback } from 'react';
import { AreaExtensions } from 'rete-area-plugin';
import logger from '../../utils/logger';
import { getNodeSchema } from '../../editor/nodeSchemas';

export function useFlowEditorSearchNavigation({
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
}) {
  const handleSearchNode = useCallback((query) => {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
      showToast('Digite um termo para buscar', 'warning', 1500);
      return;
    }

    if (editorMode === 'bpmn' && canRenderBpmn) {
      const collections = [
        { kind: 'node', items: bpmnViewModel?.nodes || [] },
        { kind: 'participant', items: bpmnViewModel?.participants || [] },
        { kind: 'lane', items: bpmnViewModel?.lanes || [] },
        { kind: 'sequenceFlow', items: bpmnViewModel?.sequenceFlows || [] },
        { kind: 'messageFlow', items: bpmnViewModel?.messageFlows || [] },
      ];

      let firstMatch = null;
      let totalMatches = 0;

      collections.forEach(({ kind, items }) => {
        items.forEach((item) => {
          const haystack = [item?.id, item?.name, item?.bpmnType, item?.category]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (haystack.includes(normalizedQuery)) {
            totalMatches += 1;
            if (!firstMatch) {
              firstMatch = { kind, id: item.id };
            }
          }
        });
      });

      if (!firstMatch) {
        showToast('Nenhum elemento BPMN encontrado', 'info', 1800);
        return;
      }

      setBpmnSelection(firstMatch);
      setRightPanelCollapsed(false);
      setPropertiesCollapsed(false);

      requestAnimationFrame(() => {
        centerBpmnSelection(firstMatch);
      });

      showToast(`${totalMatches} resultado(s) em BPMN. Focando no primeiro.`, 'success', 1800);
      return;
    }

    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 1800);
      return;
    }

    const nodes = editor.getNodes();
    const matches = nodes.filter((node) => {
      const schema = getNodeSchema(node?.data?.type);
      const configText = JSON.stringify(node?.data?.config || {});
      const haystack = [
        node?.id,
        node?.data?.type,
        schema?.label,
        configText,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    if (matches.length === 0) {
      showToast('Nenhum nó encontrado', 'info', 1800);
      return;
    }

    const target = matches[0];
    try {
      nodes.forEach((candidate) => {
        // eslint-disable-next-line no-param-reassign
        candidate.selected = String(candidate.id) === String(target.id);
      });
      if (area && typeof area.update === 'function') {
        area.update('node', target.id);
      }
      if (area) {
        AreaExtensions.zoomAt(area, [target]);
      }
    } catch (err) {
      logger.debug('Busca: falha ao focar nó no canvas', { error: err });
    }

    setSelectedNode(buildSelectedNodeData(target));
    setBpmnSelection(null);
    setRightPanelCollapsed(false);
    setPropertiesCollapsed(false);
    showToast(`${matches.length} resultado(s). Focando no primeiro.`, 'success', 1800);
  }, [
    bpmnViewModel?.lanes,
    bpmnViewModel?.messageFlows,
    bpmnViewModel?.nodes,
    bpmnViewModel?.participants,
    bpmnViewModel?.sequenceFlows,
    buildSelectedNodeData,
    canRenderBpmn,
    centerBpmnSelection,
    editorMode,
    editorRef,
    setBpmnSelection,
    setPropertiesCollapsed,
    setRightPanelCollapsed,
    setSelectedNode,
    showToast,
  ]);

  const handleGoToNode = useCallback(() => {
    if (editorMode !== 'engine') {
      showToast('Use a busca para navegar no modo BPMN', 'info', 1800);
      return;
    }

    if (typeof window === 'undefined' || typeof window.prompt !== 'function') {
      showToast('Navegação indisponível neste ambiente', 'warning', 1800);
      return;
    }

    const query = window.prompt('Ir para nó (id, tipo ou texto):', selectedNode?.id ? String(selectedNode.id) : '');
    if (!query || !query.trim()) return;
    handleSearchNode(query.trim());
  }, [editorMode, handleSearchNode, selectedNode?.id, showToast]);

  const handleNextNode = useCallback(() => {
    if (editorMode !== 'engine') {
      showToast('Próximo/Anterior disponível no modo engine', 'info', 1800);
      return;
    }

    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area) {
      showToast('Editor não está pronto', 'warning', 1800);
      return;
    }

    const sorted = editor
      .getNodes()
      .map((node) => ({
        node,
        layout: getNodeLayout(node, area),
      }))
      .sort((a, b) => {
        const yDiff = a.layout.y - b.layout.y;
        if (Math.abs(yDiff) > 20) return yDiff;
        return a.layout.x - b.layout.x;
      })
      .map((entry) => entry.node);

    if (sorted.length === 0) {
      showToast('Nenhum nó disponível', 'info', 1800);
      return;
    }

    const currentIndex = sorted.findIndex((node) => String(node.id) === String(selectedNode?.id || ''));
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % sorted.length : 0;
    const target = sorted[nextIndex];
    focusEngineNodeById(target?.id);
    showToast(`Nó ${nextIndex + 1}/${sorted.length}`, 'info', 1200);
  }, [editorMode, editorRef, focusEngineNodeById, getNodeLayout, selectedNode?.id, showToast]);

  const handlePreviousNode = useCallback(() => {
    if (editorMode !== 'engine') {
      showToast('Próximo/Anterior disponível no modo engine', 'info', 1800);
      return;
    }

    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor || !area) {
      showToast('Editor não está pronto', 'warning', 1800);
      return;
    }

    const sorted = editor
      .getNodes()
      .map((node) => ({
        node,
        layout: getNodeLayout(node, area),
      }))
      .sort((a, b) => {
        const yDiff = a.layout.y - b.layout.y;
        if (Math.abs(yDiff) > 20) return yDiff;
        return a.layout.x - b.layout.x;
      })
      .map((entry) => entry.node);

    if (sorted.length === 0) {
      showToast('Nenhum nó disponível', 'info', 1800);
      return;
    }

    const currentIndex = sorted.findIndex((node) => String(node.id) === String(selectedNode?.id || ''));
    const prevIndex = currentIndex >= 0 ? (currentIndex - 1 + sorted.length) % sorted.length : sorted.length - 1;
    const target = sorted[prevIndex];
    focusEngineNodeById(target?.id);
    showToast(`Nó ${prevIndex + 1}/${sorted.length}`, 'info', 1200);
  }, [editorMode, editorRef, focusEngineNodeById, getNodeLayout, selectedNode?.id, showToast]);

  return {
    handleSearchNode,
    handleGoToNode,
    handleNextNode,
    handlePreviousNode,
  };
}
