import { useRete } from 'rete-react-plugin';
import { forwardRef, useImperativeHandle, useCallback } from 'react';
import { AreaExtensions } from 'rete-area-plugin';

import { createEditor } from './editor/createEditor';
import { useEditor } from './state/editorStore';
import { engineFlowToReteJson } from './engine-mapper/engineMapper';
import logger from './utils/logger';

/**
 * Componente FlowEditor usando useRete hook seguindo o padrão do reference.
 * 
 * O hook useRete gerencia automaticamente o ciclo de vida do editor:
 * - Criação quando o componente é montado
 * - Cleanup quando o componente é desmontado
 * - Re-criação quando as dependências mudam
 */
export const FlowEditor = forwardRef(function FlowEditor({
  onFlowChanged,
  onNodeSelected
}, ref) {
  // Obtém currentFlow do contexto
  const { currentFlow } = useEditor();
  
  // Usa useRete hook seguindo o padrão do reference
  // O hook gerencia automaticamente o ciclo de vida (criação e cleanup)
  // A função createEditor é memoizada com useCallback para evitar recriação
  const createEditorFn = useCallback(async (container) => {
    const instance = await createEditor(container, {
      onFlowChanged,
      onNodeSelected,
    });
    
    // Carrega o fluxo se houver currentFlow usando helper do próprio editor
    if (currentFlow && instance && typeof instance.loadFromJson === 'function') {
      const reteJson = engineFlowToReteJson(currentFlow);
      try {
        await instance.loadFromJson(reteJson);
        logger.debug('Fluxo carregado do JSON', {
          flowId: currentFlow.id,
          nodeCount: reteJson?.nodes ? Object.keys(reteJson.nodes).length : 0,
        });
      } catch (err) {
        logger.error('Erro ao carregar fluxo do JSON via loadFromJson', err);
      }
    }
    
    return instance;
  }, [currentFlow, onFlowChanged, onNodeSelected]);
  
  const [containerRef, editorInstance] = useRete(createEditorFn);

  // Expõe editor e area através da ref (para compatibilidade com FlowEditorPage)
  useImperativeHandle(ref, () => {
    if (!editorInstance) return null;
    
    return {
      editor: { current: editorInstance.editor },
      area: editorInstance.area,
      arrange: editorInstance.arrange,
      // Métodos auxiliares para compatibilidade
      zoomToFit: () => {
        if (editorInstance.area && editorInstance.editor) {
          const nodes = editorInstance.editor.getNodes();
          if (nodes.length > 0) {
            try {
              AreaExtensions.zoomAt(editorInstance.area, nodes);
            } catch (err) {
              logger.warn('Erro ao fazer zoom', { error: err });
            }
          }
        }
      },
    };
  }, [editorInstance]);

  return (
    <div
      ref={containerRef}
      className="flow-editor-container"
    />
  );
});
