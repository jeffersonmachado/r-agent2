import { useRete } from 'rete-react-plugin';
import { forwardRef, useImperativeHandle, useCallback, useEffect, useRef } from 'react';
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
 * - NÃO recria quando currentFlow muda (conforme padrão do reference)
 */
export const FlowEditor = forwardRef(function FlowEditor({
  onFlowChanged,
  onNodeSelected,
  showToast
}, ref) {
  // Obtém currentFlow do contexto
  const { currentFlow } = useEditor();
  const lastLoadedFlowIdRef = useRef(null);
  
  // ✅ Usa refs para manter referências estáveis às funções
  // Isso evita que createEditorFn mude quando as props mudam
  const onFlowChangedRef = useRef(onFlowChanged);
  const onNodeSelectedRef = useRef(onNodeSelected);
  const showToastRef = useRef(showToast);
  
  // Atualiza refs quando props mudam (sem recriar o editor)
  useEffect(() => {
    onFlowChangedRef.current = onFlowChanged;
    onNodeSelectedRef.current = onNodeSelected;
    showToastRef.current = showToast;
  }, [onFlowChanged, onNodeSelected, showToast]);
  
  // ✅ CONFORME COM REFERENCE: createEditorFn SEM dependências dinâmicas
  // O editor é criado uma vez e não recriado quando props mudam
  const createEditorFn = useCallback(async (container) => {
    const instance = await createEditor(container, {
      onFlowChanged: (...args) => onFlowChangedRef.current?.(...args),
      onNodeSelected: (...args) => onNodeSelectedRef.current?.(...args),
      showToast: (...args) => showToastRef.current?.(...args),
    });
    
    return instance;
  }, []); // ✅ Array vazio - nunca recria
  
  const [containerRef, editorInstance] = useRete(createEditorFn);

  // ✅ useEffect separado para carregar fluxo quando currentFlow muda
  // Isso evita recriar o editor e previne loops infinitos
  useEffect(() => {
    if (!editorInstance) return;
    
    // Se currentFlow é null, reseta a referência do último fluxo carregado
    if (!currentFlow) {
      lastLoadedFlowIdRef.current = null;
      return;
    }
    
    // Evita recarregar o mesmo fluxo
    if (lastLoadedFlowIdRef.current === currentFlow.id) return;
    
    const loadFlow = async () => {
      if (editorInstance && typeof editorInstance.loadFromJson === 'function') {
        const reteJson = engineFlowToReteJson(currentFlow);
        try {
          await editorInstance.loadFromJson(reteJson);
          lastLoadedFlowIdRef.current = currentFlow.id;
          logger.debug('Fluxo carregado do JSON', {
            flowId: currentFlow.id,
            nodeCount: reteJson?.nodes ? Object.keys(reteJson.nodes).length : 0,
          });
        } catch (err) {
          logger.error('Erro ao carregar fluxo do JSON via loadFromJson', err);
        }
      }
    };
    
    loadFlow();
  }, [editorInstance, currentFlow]);

  // Expõe editor e area através da ref (para compatibilidade com FlowEditorPage)
  useImperativeHandle(ref, () => {
    if (!editorInstance) return null;
    
    // ✅ Garante que o editor tenha o método toJSON
    const editor = editorInstance.editor;
    if (editor && !editor.toJSON && editorInstance.toJSON) {
      editor.toJSON = editorInstance.toJSON;
    }
    
    return {
      editor: { current: editor },
      area: editorInstance.area,
      arrange: editorInstance.arrange,
      clearEditor: editorInstance.clearEditor,
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
