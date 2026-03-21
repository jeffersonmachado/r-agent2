import { useCallback } from 'react';
import { AreaExtensions } from 'rete-area-plugin';
import logger from '../../utils/logger';
import { createTranslateOnlyApplier, cleanupInlineNodeSize } from '../../editor/arrange/translateOnlyApplier';

export function useFlowEditorCanvasHistory({
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
}) {
  const handleArrange = useCallback(async () => {
    try {
      const arrange = editorRef.current?.arrange;
      const area = editorRef.current?.area;
      const editor = editorRef.current?.editor?.current;
      const updateNodeIO = editorRef.current?.updateNodeIO;

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

      const safeAreaUpdate = async () => {
        try {
          if (area && typeof area.update === 'function') {
            area.update('node');
            area.update('connection');
          }
        } catch (err) {
          logger.debug('Falha best-effort ao atualizar área antes/depois do layout', {
            error: err?.message || String(err),
          });
        }
      };

      cleanupInlineNodeSize(area, nodes);

      const waitFrames = async (count = 1) => {
        for (let index = 0; index < count; index += 1) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        }
      };

      const measureNodeDimensions = () => {
        let withSize = 0;
        let maxWidth = 0;
        let maxHeight = 0;

        nodes.forEach((node) => {
          try {
            const view = area?.nodeViews?.get?.(node?.id);
            const wrapper = view?.element;
            if (!wrapper || !(wrapper instanceof HTMLElement)) return;

            const element =
              wrapper.querySelector('.flow-node') ||
              wrapper.querySelector('*:not(span):not([fragment])') ||
              wrapper.firstElementChild ||
              wrapper;
            if (!(element instanceof HTMLElement)) return;

            const rect = element.getBoundingClientRect();
            const rectWidth = Number(rect?.width);
            const rectHeight = Number(rect?.height);
            const width = Number.isFinite(rectWidth) && rectWidth > 10 ? rectWidth : Number(wrapper.clientWidth || 0);
            const height = Number.isFinite(rectHeight) && rectHeight > 10 ? rectHeight : Number(wrapper.clientHeight || 0);

            if (Number.isFinite(width) && width > 10) {
              node.width = Math.round(width);
              maxWidth = Math.max(maxWidth, node.width);
            }

            if (Number.isFinite(height) && height > 10) {
              node.height = Math.round(height);
              maxHeight = Math.max(maxHeight, node.height);
            }

            if ((node.width || 0) > 10 && (node.height || 0) > 10) {
              withSize += 1;
            }
          } catch {
            // best-effort
          }
        });

        return { withSize, maxWidth, maxHeight };
      };

      const hasOverlaps = () => {
        try {
          const rects = nodes
            .map((node) => {
              const view = area?.nodeViews?.get?.(node.id);
              const position = view?.position;
              const x = Number(position?.x);
              const y = Number(position?.y);
              const width = Number(node?.width || 0);
              const height = Number(node?.height || 0);
              if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 10 || height <= 10) return null;
              return { id: node.id, x, y, w: width, h: height };
            })
            .filter(Boolean);

          const margin = 12;
          for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
            for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
              const left = rects[leftIndex];
              const right = rects[rightIndex];
              const overlapX = left.x < right.x + right.w - margin && left.x + left.w - margin > right.x;
              const overlapY = left.y < right.y + right.h - margin && left.y + left.h - margin > right.y;
              if (overlapX && overlapY) return true;
            }
          }

          return false;
        } catch {
          return false;
        }
      };

      const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
      const allConnections = typeof editor.getConnections === 'function' ? editor.getConnections() : [];
      const arrangeConnections = (allConnections || []).filter((connection) => {
        if (!connection) return false;

        const sourceId = String(connection.source || '');
        const targetId = String(connection.target || '');
        const sourceKey = typeof connection.sourceOutput === 'string' ? connection.sourceOutput : null;
        const targetKey = typeof connection.targetInput === 'string' ? connection.targetInput : null;
        if (!sourceId || !targetId || !sourceKey || !targetKey) return false;

        const sourceNode = nodesById.get(sourceId);
        const targetNode = nodesById.get(targetId);
        if (!sourceNode || !targetNode) return false;

        return !!sourceNode.outputs?.[sourceKey] && !!targetNode.inputs?.[targetKey];
      });

      const runLayoutOnce = async () => {
        let ok = true;

        await new Promise((resolve) => {
          requestAnimationFrame(async () => {
            try {
              await new Promise((nextFrame) => requestAnimationFrame(() => nextFrame()));
              await safeAreaUpdate();
              await arrange.layout({
                nodes,
                connections: arrangeConnections,
                applier: createTranslateOnlyApplier(),
                options: {
                  'elk.spacing.nodeNode': '80',
                  'elk.layered.spacing.nodeNodeBetweenLayers': '140',
                  'elk.spacing.edgeNode': '40',
                },
              });
              await safeAreaUpdate();
              resolve();
            } catch (err) {
              ok = false;
              logger.warn('Erro ao calcular layout', { error: err?.message || String(err) });
              resolve();
            }
          });
        });

        return ok;
      };

      try {
        if (typeof updateNodeIO === 'function') {
          nodes.forEach((node) => {
            try {
              updateNodeIO(String(node.id));
            } catch {
              // best-effort
            }
          });
          await safeAreaUpdate();
          arrangeDisabledRef.current = false;
        }
      } catch (err) {
        logger.debug('Organizar - falha best-effort ao sincronizar IO dinâmico', {
          error: err?.message || String(err),
        });
      }

      try {
        await safeAreaUpdate();
        await waitFrames(2);
        let stats = measureNodeDimensions();
        if (stats.withSize < Math.ceil(nodes.length * 0.6)) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          await waitFrames(2);
          stats = measureNodeDimensions();
        }
      } catch (err) {
        logger.debug('Organizar - falha best-effort ao medir dimensões dos nós', {
          error: err?.message || String(err),
        });
      }

      let layoutOk = true;
      let appliedFallback = false;

      if (arrangeDisabledRef.current) {
        layoutOk = false;
      } else {
        layoutOk = (await runLayoutOnce()) && layoutOk;
        await new Promise((resolve) => setTimeout(resolve, 80));
        layoutOk = (await runLayoutOnce()) && layoutOk;
        await new Promise((resolve) => setTimeout(resolve, 80));

        if (layoutOk) {
          try {
            await safeAreaUpdate();
            await waitFrames(1);
            measureNodeDimensions();
            if (hasOverlaps()) {
              layoutOk = (await runLayoutOnce()) && layoutOk;
              await new Promise((resolve) => setTimeout(resolve, 80));
            }
          } catch {
            // best-effort
          }
        }

        if (!layoutOk) {
          arrangeDisabledRef.current = true;
        }
      }

      try {
        if (!layoutOk) {
          logger.warn('Organizar - auto-arrange falhou; aplicando fallback em grade', {
            reason: 'layout_failed',
          });
        }

        const viewPositions = nodes
          .map((node) => {
            const view = area?.nodeViews?.get?.(node.id);
            const position = view?.position;
            const x = Number(position?.x);
            const y = Number(position?.y);
            return Number.isFinite(x) && Number.isFinite(y) ? { id: node.id, x, y } : null;
          })
          .filter(Boolean);

        const counts = new Map();
        for (const position of viewPositions) {
          const key = `${Math.round(position.x)},${Math.round(position.y)}`;
          counts.set(key, (counts.get(key) || 0) + 1);
        }

        let maxDup = 0;
        for (const count of counts.values()) {
          maxDup = Math.max(maxDup, count);
        }

        const uniqueCount = counts.size;
        const looksCollapsed = viewPositions.length > 1 && (uniqueCount <= 1 || maxDup >= 3);
        const shouldApplyGrid = !layoutOk || looksCollapsed;

        if (shouldApplyGrid && typeof area?.translate === 'function') {
          logger.info('Organizar - fallback de grade aplicado', {
            trigger: !layoutOk ? 'layout_failed' : 'positions_collapsed',
            uniqueCount,
            maxDup,
            total: viewPositions.length,
          });

          const { maxWidth, maxHeight } = measureNodeDimensions();
          const cols = 5;
          const dx = Math.max(320, (maxWidth || 0) + 120);
          const dy = Math.max(220, (maxHeight || 0) + 120);

          for (let index = 0; index < nodes.length; index += 1) {
            const x = (index % cols) * dx;
            const y = Math.floor(index / cols) * dy;
            // eslint-disable-next-line no-await-in-loop
            await area.translate(nodes[index].id, { x, y });
          }

          await safeAreaUpdate();
          appliedFallback = true;
        }
      } catch (err) {
        logger.debug('Organizar - fallback de grade falhou (best-effort)', {
          error: err?.message || String(err),
        });
      }

      cleanupInlineNodeSize(area, nodes);
      await safeAreaUpdate();

      if (nodes.length > 0) {
        try {
          AreaExtensions.zoomAt(area, nodes);
        } catch (err) {
          logger.warn('Erro ao fazer zoom após organizar', { error: err?.message });
        }
      }

      if (layoutOk) {
        showToast('Nós organizados automaticamente', 'success', 2000);
      } else if (appliedFallback) {
        showToast('Auto-layout falhou; nós espalhados em grade para evitar sobreposição', 'warning', 3500);
      } else {
        showToast('Não foi possível organizar automaticamente', 'error', 3000);
      }
    } catch (err) {
      logger.error('Erro ao organizar nós', { error: err });
      showToast('Erro ao organizar nós. Tente novamente.', 'error', 3000);
    }
  }, [arrangeDisabledRef, editorRef, showToast]);

  const handleUndo = useCallback(async () => {
    if (editorMode !== 'engine') {
      showToast('Undo disponível no modo engine', 'info', 1800);
      return;
    }

    await captureHistorySnapshot({ resetFuture: false });

    if (historyRef.current.past.length < 2) {
      showToast('Nada para desfazer', 'info', 1500);
      return;
    }

    const currentState = historyRef.current.past.pop();
    if (currentState) {
      historyRef.current.future.push(currentState);
      if (historyRef.current.future.length > 80) {
        historyRef.current.future.shift();
      }
    }

    const previousState = historyRef.current.past[historyRef.current.past.length - 1];
    if (!previousState) {
      showToast('Nada para desfazer', 'info', 1500);
      return;
    }

    try {
      historyRef.current.isApplying = true;
      await editorRef.current?.loadFromJson?.(cloneSerializable(previousState.json, { nodes: {} }));
      historyRef.current.lastSignature = previousState.signature;
      setSelectedNode(null);
      showToast('Desfazer aplicado', 'success', 1200);
    } catch (err) {
      logger.warn('Undo falhou', { error: err });
      showToast('Falha ao desfazer alteração', 'error', 2000);
    } finally {
      historyRef.current.isApplying = false;
    }
  }, [captureHistorySnapshot, cloneSerializable, editorMode, editorRef, historyRef, setSelectedNode, showToast]);

  const handleRedo = useCallback(async () => {
    if (editorMode !== 'engine') {
      showToast('Redo disponível no modo engine', 'info', 1800);
      return;
    }

    if (historyRef.current.future.length === 0) {
      showToast('Nada para refazer', 'info', 1500);
      return;
    }

    const nextState = historyRef.current.future.pop();
    if (!nextState) {
      showToast('Nada para refazer', 'info', 1500);
      return;
    }

    historyRef.current.past.push(nextState);

    try {
      historyRef.current.isApplying = true;
      await editorRef.current?.loadFromJson?.(cloneSerializable(nextState.json, { nodes: {} }));
      historyRef.current.lastSignature = nextState.signature;
      setSelectedNode(null);
      showToast('Refazer aplicado', 'success', 1200);
    } catch (err) {
      logger.warn('Redo falhou', { error: err });
      showToast('Falha ao refazer alteração', 'error', 2000);
    } finally {
      historyRef.current.isApplying = false;
    }
  }, [cloneSerializable, editorMode, editorRef, historyRef, setSelectedNode, showToast]);

  const handleToggleReroutePoints = useCallback(() => {
    const next = !reroutePointsVisible;
    setReroutePointsVisible(next);
    showToast(`Reroute ${next ? 'ativado' : 'desativado'}`, 'info', 1400);
  }, [reroutePointsVisible, setReroutePointsVisible, showToast]);

  return {
    handleArrange,
    handleUndo,
    handleRedo,
    handleToggleReroutePoints,
  };
}