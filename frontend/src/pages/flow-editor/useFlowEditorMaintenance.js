import { useCallback } from 'react';
import { AreaExtensions } from 'rete-area-plugin';
import { getReplay } from '../../api/flows';
import logger from '../../utils/logger';

export function useFlowEditorMaintenance({
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
}) {
  const handleLoadReplay = useCallback(async () => {
    if (!sessionId.trim()) {
      showToast('Digite um Session ID', 'warning', 2000);
      return;
    }

    setLoadingReplay(true);
    setReplayError(null);
    try {
      const result = await getReplay(sessionId.trim());
      setReplay(result);
      setReplayCollapsed(false);
      showToast('Replay carregado com sucesso', 'success', 2000);
    } catch (err) {
      logger.error('Erro ao carregar replay', err);
      setReplayError(err instanceof Error ? err.message : String(err));
      setReplay(null);
      showToast('Erro ao carregar replay', 'error', 3000);
    } finally {
      setLoadingReplay(false);
    }
  }, [sessionId, setLoadingReplay, setReplayError, setReplay, setReplayCollapsed, showToast]);

  const handleSeekNode = useCallback((nodeId, index) => {
    // index is kept for API compatibility with replay callbacks.
    void index;

    if (nodeId && editorRef.current?.editor?.current) {
      const editor = editorRef.current.editor.current;
      const node = editor.getNodes().find((n) => String(n.id) === String(nodeId));
      if (node) {
        setSelectedNode(node);
        const area = editorRef.current?.area;
        if (area && area.area) {
          AreaExtensions.zoomAt(area, [node]);
        }
      }
    }
  }, [editorRef, setSelectedNode]);

  const handleClearOrphanConnections = useCallback(async (options = {}) => {
    const silent = options && options.silent === true;
    if (editorMode !== 'engine') {
      if (!silent) showToast('Limpeza de conexões disponível no modo engine', 'info', 1800);
      return 0;
    }

    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor) {
      if (!silent) showToast('Editor não está pronto', 'warning', 1800);
      return 0;
    }

    const nodesById = new Map(editor.getNodes().map((node) => [String(node.id), node]));
    const connections = typeof editor.getConnections === 'function' ? editor.getConnections() : [];
    let removed = 0;

    connections.forEach((connection) => {
      const sourceId = String(connection?.source || '');
      const targetId = String(connection?.target || '');
      const sourceOutput = String(connection?.sourceOutput || '');
      const targetInput = String(connection?.targetInput || '');
      const sourceNode = nodesById.get(sourceId);
      const targetNode = nodesById.get(targetId);

      const invalid =
        !sourceNode ||
        !targetNode ||
        !sourceOutput ||
        !targetInput ||
        !sourceNode.outputs?.[sourceOutput] ||
        !targetNode.inputs?.[targetInput];

      if (invalid) {
        try {
          editor.removeConnection(connection.id);
          removed += 1;
        } catch (err) {
          logger.debug('Falha ao remover conexão órfã (best-effort)', {
            connectionId: connection?.id,
            error: err,
          });
        }
      }
    });

    if (removed > 0) {
      if (area && typeof area.update === 'function') {
        area.update('connection');
      }
      handleFlowChanged();
      await captureHistorySnapshot();
    }

    if (!silent) {
      if (removed > 0) {
        showToast(`${removed} conexão(ões) órfã(s) removida(s)`, 'success', 2200);
      } else {
        showToast('Nenhuma conexão órfã encontrada', 'info', 1800);
      }
    }

    return removed;
  }, [captureHistorySnapshot, editorMode, editorRef, handleFlowChanged, showToast]);

  const handleValidateAndFix = useCallback(async () => {
    if (editorMode !== 'engine') {
      await handleValidate();
      showToast('Validação executada no modo BPMN', 'info', 2000);
      return;
    }

    const removedOrphans = await handleClearOrphanConnections({ silent: true });
    if (removedOrphans > 0) {
      await handleArrange();
    }

    await handleValidate();
    showToast(
      removedOrphans > 0
        ? `Validação com correção aplicada (${removedOrphans} conexão(ões) removida(s))`
        : 'Validação concluída (nenhuma correção automática necessária)',
      'info',
      2600
    );
  }, [editorMode, handleArrange, handleClearOrphanConnections, handleValidate, showToast]);

  const handleSimplifyGraph = useCallback(async () => {
    if (editorMode !== 'engine') {
      showToast('Simplify disponível no modo engine', 'info', 1800);
      return;
    }

    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 1800);
      return;
    }

    const dedupeSet = new Set();
    const connections = typeof editor.getConnections === 'function' ? editor.getConnections() : [];
    let removedDuplicates = 0;
    connections.forEach((connection) => {
      const key = [
        String(connection?.source || ''),
        String(connection?.sourceOutput || ''),
        String(connection?.target || ''),
        String(connection?.targetInput || ''),
      ].join('::');
      if (dedupeSet.has(key)) {
        try {
          editor.removeConnection(connection.id);
          removedDuplicates += 1;
        } catch {
          // best-effort
        }
        return;
      }
      dedupeSet.add(key);
    });

    const removedOrphans = await handleClearOrphanConnections({ silent: true });
    if (removedDuplicates > 0 || removedOrphans > 0) {
      await captureHistorySnapshot();
      showToast(
        `Grafo simplificado: ${removedDuplicates} duplicada(s), ${removedOrphans} órfã(s) removida(s)`,
        'success',
        2600
      );
    } else {
      showToast('Grafo já está simplificado', 'info', 1800);
    }
  }, [captureHistorySnapshot, editorMode, editorRef, handleClearOrphanConnections, showToast]);

  return {
    handleLoadReplay,
    handleSeekNode,
    handleValidateAndFix,
    handleSimplifyGraph,
  };
}
