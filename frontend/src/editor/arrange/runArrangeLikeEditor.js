import { AreaExtensions } from 'rete-area-plugin';
import { createTranslateOnlyApplier, cleanupInlineNodeSize } from './translateOnlyApplier';

/**
 * Best-effort: aplica auto-arrange no editor, seguindo o mesmo espírito do botão “Organizar”
 * do editor principal (FlowEditorPage), mas reduzido para uso em previews (ex.: modal).
 *
 * @param {object} params
 * @param {object} params.editorInstance - retorno de createEditor (useRete)
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runArrangeLikeEditor({ editorInstance }) {
  const arrange = editorInstance?.arrange;
  const area = editorInstance?.area;
  const editor = editorInstance?.editor;

  if (!arrange || !area || !editor) return { ok: false, reason: 'editor_not_ready' };
  if (typeof editor.getNodes !== 'function') return { ok: false, reason: 'missing_getNodes' };

  const nodes = editor.getNodes();
  if (!Array.isArray(nodes) || nodes.length === 0) return { ok: false, reason: 'no_nodes' };

  const safeAreaUpdate = async () => {
    try {
      if (area && typeof area.update === 'function') {
        area.update('node');
        area.update('connection');
      }
    } catch {
      // best-effort
    }
  };

  const waitFrames = async (count = 1) => {
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
  };

  // Filtra conexões para evitar edges com ports inválidos (protege ELK/auto-arrange).
  const nodesById = new Map(nodes.map((n) => [String(n?.id), n]));
  const allConnections = typeof editor.getConnections === 'function' ? editor.getConnections() : [];
  const arrangeConnections = (allConnections || []).filter((c) => {
    if (!c) return false;
    const sourceId = String(c.source || '');
    const targetId = String(c.target || '');
    const sourceKey = typeof c.sourceOutput === 'string' ? c.sourceOutput : null;
    const targetKey = typeof c.targetInput === 'string' ? c.targetInput : null;
    if (!sourceId || !targetId || !sourceKey || !targetKey) return false;
    const sourceNode = nodesById.get(sourceId);
    const targetNode = nodesById.get(targetId);
    if (!sourceNode || !targetNode) return false;
    const hasSourcePort = !!sourceNode.outputs?.[sourceKey];
    const hasTargetPort = !!targetNode.inputs?.[targetKey];
    return hasSourcePort && hasTargetPort;
  });

  const runLayoutOnce = async () => {
    let ok = true;
    await new Promise((resolve) => {
      requestAnimationFrame(async () => {
        try {
          await safeAreaUpdate();
          await waitFrames(2);
          cleanupInlineNodeSize(area, nodes);
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
        } catch {
          ok = false;
        } finally {
          resolve();
        }
      });
    });
    return ok;
  };

  // Duas passadas: reduz chance de rodar cedo demais (views/DOM ainda medindo).
  const ok1 = await runLayoutOnce();
  await new Promise((r) => setTimeout(r, 80));
  const ok2 = await runLayoutOnce();

  // “Zoom fit” best-effort
  try {
    const nodesNow = editor.getNodes();
    if (Array.isArray(nodesNow) && nodesNow.length > 0) {
      AreaExtensions.zoomAt(area, nodesNow);
    }
  } catch {
    // best-effort
  }

  return { ok: !!(ok1 && ok2) };
}

