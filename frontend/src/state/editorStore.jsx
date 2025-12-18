import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import * as flowsApi from '../api/flows';
import {
  engineFlowToReteJson,
  reteJsonToEngineFlow,
  mapValidationErrorsToUi,
} from '../engine-mapper/engineMapper';
import logger from '../utils/logger';

/**
 * Estado global do editor de fluxo.
 *
 * Responsabilidades:
 * - Guardar o fluxo atual (forma "engine" e forma "editor/Rete")
 * - Guardar seleção de nó, resultado de validação e simulação
 * - Orquestrar chamadas à API (CRUD, validação, simulação)
 */

const EditorContext = createContext(null);

// Nota: Este arquivo exporta tanto um componente (EditorProvider) quanto um hook (useEditor).
// O Vite Fast Refresh pode mostrar um aviso, mas o código funciona corretamente.
// O aviso não afeta a funcionalidade, apenas indica que o Fast Refresh recarregará a página
// em vez de fazer hot reload para este arquivo específico.

export function EditorProvider({ children }) {
  const [currentFlow, setCurrentFlow] = useState(null);
  const [editorJson, setEditorJson] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [validation, setValidation] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Atualiza JSON do editor (Rete).
   *
   * @param {any} reteJson
   */
  const updateEditorJson = useCallback((reteJson) => {
    setEditorJson(reteJson);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /**
   * Carrega um fluxo do backend e converte para JSON do editor.
   *
   * @param {string} flowId
   */
  const loadFlow = useCallback(async (flowId) => {
    if (!flowId) {
      logger.warn('loadFlow chamado sem flowId');
      return;
    }
    
    logger.info('Carregando fluxo', { flowId });
    setLoading(true);
    setError(null);
    
    try {
      logger.debug('Buscando fluxo na API', { flowId });
      const flow = await flowsApi.getFlow(flowId);
      logger.info('Fluxo carregado da API', { flowId: flow?.id, flowName: flow?.name });
      
      logger.debug('Convertendo fluxo para formato Rete', { flowId });
      const reteJson = engineFlowToReteJson(flow);
      const nodeCount = reteJson?.nodes ? Object.keys(reteJson.nodes).length : 0;
      logger.debug('Fluxo convertido', { 
        nodeCount,
        flowNodes: flow?.nodes?.length || 0,
        reteNodes: Object.keys(reteJson?.nodes || {}).length,
        reteJsonKeys: Object.keys(reteJson || {})
      });
      
      setCurrentFlow(flow);
      setEditorJson(reteJson);
      setValidation(null);
      setSimulation(null);
      
      logger.info('Fluxo carregado no editor com sucesso', { flowId });
    } catch (err) {
      logger.error('Erro ao carregar fluxo', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Salva o fluxo atual (create ou update) usando o backend.
   *
   * @param {{ tenantId?: string, id?: string, name?: string }} [metaOverrides]
   */
  const saveFlow = useCallback(
    async (metaOverrides) => {
      if (!editorJson) {
        logger.warn('saveFlow chamado sem editorJson');
        return null;
      }

      logger.info('Salvando fluxo', { 
        hasCurrentFlow: !!currentFlow,
        currentFlowId: currentFlow?.id 
      });
      setLoading(true);
      setError(null);

      try {
        const baseMeta = {
          tenantId:
            (currentFlow && currentFlow.tenantId) ||
            (metaOverrides && metaOverrides.tenantId) ||
            'demo-tenant',
          id:
            (currentFlow && currentFlow.id) ||
            (metaOverrides && metaOverrides.id) ||
            'demo-flow',
          name:
            (currentFlow && currentFlow.name) ||
            (metaOverrides && metaOverrides.name) ||
            'Fluxo sem nome',
          version: (currentFlow && currentFlow.version) || 1,
        };

        logger.debug('Metadados do fluxo', baseMeta);
        const editorNodeCount = editorJson?.nodes ? Object.keys(editorJson.nodes).length : 0;
        logger.debug('Convertendo editorJson para formato engine', { 
          nodeCount: editorNodeCount,
          editorJsonKeys: Object.keys(editorJson || {})
        });

        const flowDefinition = reteJsonToEngineFlow(editorJson, baseMeta);
        logger.debug('Fluxo convertido para formato engine', { 
          nodeCount: flowDefinition?.nodes?.length || 0 
        });

        let saved;
        if (currentFlow && currentFlow.id) {
          logger.info('Atualizando fluxo existente', { flowId: currentFlow.id });
          saved = await flowsApi.updateFlow(currentFlow.id, flowDefinition);
        } else {
          logger.info('Criando novo fluxo');
          saved = await flowsApi.createFlow(flowDefinition);
        }

        logger.info('Fluxo salvo com sucesso', { flowId: saved?.id, flowName: saved?.name });
        setCurrentFlow(saved);
        return saved;
      } catch (err) {
        logger.error('Erro ao salvar fluxo', err);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [currentFlow, editorJson],
  );

  /**
   * Valida o fluxo atual no backend.
   */
  const validateCurrentFlow = useCallback(async () => {
    if (!editorJson) return null;

    setLoading(true);
    setError(null);

    try {
      const flowDefinition = reteJsonToEngineFlow(editorJson, currentFlow || undefined);
      const result = await flowsApi.validateFlow(flowDefinition);
      const uiErrors = mapValidationErrorsToUi(result.errors || []);
      const validationResult = {
        ...result,
        uiErrors,
      };
      setValidation(validationResult);
      return validationResult;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Erro ao validar fluxo', err);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [currentFlow, editorJson]);

  /**
   * Simula o fluxo atual usando o backend.
   *
   * @param {any} [options]
   */
  const simulateCurrentFlow = useCallback(
    async (options) => {
      if (!currentFlow || !currentFlow.id) {
        // Sem id persistido ainda; na ausência de endpoint específico
        // para simular a partir do JSON bruto, optamos por não simular.
        return null;
      }

      setLoading(true);
      setError(null);

      try {
        const result = await flowsApi.simulateFlow(currentFlow.id, options || {});
        setSimulation(result);
        return result;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Erro ao simular fluxo', err);
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [currentFlow],
  );

  /**
   * Remove um fluxo do backend.
   *
   * @param {string} flowId
   */
  const deleteFlow = useCallback(
    async (flowId) => {
      if (!flowId) {
        logger.warn('deleteFlow chamado sem flowId');
        return;
      }

      setLoading(true);
      setError(null);

      try {
        await flowsApi.deleteFlow(flowId);
        logger.info('Fluxo removido com sucesso', { flowId });

        // Se o fluxo removido é o atual, limpa o estado
        if (currentFlow && currentFlow.id === flowId) {
          setCurrentFlow(null);
          setEditorJson(null);
          setSelectedNode(null);
          setValidation(null);
          setSimulation(null);
        }
      } catch (err) {
        logger.error('Erro ao remover fluxo', { flowId, error: err });
        setError(err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [currentFlow],
  );

  const value = useMemo(
    () => ({
      currentFlow,
      editorJson,
      selectedNode,
      validation,
      simulation,
      loading,
      error,

      setSelectedNode,
      updateEditorJson,
      setValidation,
      setSimulation,
      clearError,

      loadFlow,
      saveFlow,
      validateCurrentFlow,
      simulateCurrentFlow,
      deleteFlow,
    }),
    [
      clearError,
      currentFlow,
      editorJson,
      error,
      loadFlow,
      loading,
      selectedNode,
      simulation,
      updateEditorJson,
      validateCurrentFlow,
      validation,
      saveFlow,
      simulateCurrentFlow,
      deleteFlow,
    ],
  );

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export function useEditor() {
  const ctx = useContext(EditorContext);
  if (!ctx) {
    throw new Error('useEditor deve ser usado dentro de um <EditorProvider>');
  }
  return ctx;
}


