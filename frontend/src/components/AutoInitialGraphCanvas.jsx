import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useRete } from 'rete-react-plugin';
import { AreaExtensions } from 'rete-area-plugin';

import { createEditor } from '../editor/createEditor';
import { engineFlowToReteJson } from '../engine-mapper/engineMapper';
import { runArrangeLikeEditor } from '../editor/arrange/runArrangeLikeEditor';
import logger from '../utils/logger';

export function AutoInitialGraphCanvas({ flow, showToast, height = 520 }) {
  const reteJsonRef = useRef(null);
  const flowRef = useRef(flow);
  useEffect(() => {
    flowRef.current = flow;
    reteJsonRef.current = flow ? engineFlowToReteJson(flow) : null;
  }, [flow]);

  const resolvedHeight = useMemo(() => {
    if (typeof height === 'number' && Number.isFinite(height)) return `${height}px`;
    if (typeof height === 'string' && height.trim()) return height.trim();
    return '520px';
  }, [height]);

  const showToastRef = useRef(showToast);
  useEffect(() => {
    showToastRef.current = showToast;
  }, [showToast]);

  const createEditorFn = useCallback(async (container) => {
    const instance = await createEditor(container, {
      showToast: (...args) => showToastRef.current?.(...args),
    });
    return instance;
  }, []);

  const [containerRef, editorInstance] = useRete(createEditorFn);

  useEffect(() => {
    let cancelled = false;
    const reteJson = reteJsonRef.current;
    if (!editorInstance || !reteJson) return undefined;

    (async () => {
      try {
        if (typeof editorInstance.loadFromJson !== 'function') return;
        await editorInstance.loadFromJson(reteJson);
        if (cancelled) return;

        // Organizar como o botão “Organizar” do editor (best-effort).
        try {
          await runArrangeLikeEditor({ editorInstance });
        } catch (err) {
          logger.debug('AutoInitialGraphCanvas - falha ao organizar (best-effort)', {
            error: err?.message || String(err),
          });
        }
      } catch (err) {
        logger.warn('AutoInitialGraphCanvas - erro ao carregar grafo', {
          error: err?.message || String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editorInstance, flow]);

  return (
    <div
      ref={containerRef}
      className="flow-editor-container"
      style={{ height: resolvedHeight, borderRadius: 12, overflow: 'hidden' }}
    />
  );
}

