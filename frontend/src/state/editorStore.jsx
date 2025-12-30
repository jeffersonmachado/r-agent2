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
  const [selectedNode, setSelectedNode] = useState(null);
  const [validation, setValidation] = useState(null);
  const [simulation, setSimulation] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
      
      setCurrentFlow(flow);
      setValidation(null);
      setSimulation(null);
      
      logger.info('Fluxo carregado no editor com sucesso', { flowId });
      
      // Retorna o flow para conversão imediata se necessário
      return flow;
    } catch (err) {
      logger.error('Erro ao carregar fluxo', err);
      
      // Se for um erro 404 (fluxo não encontrado), limpa o currentFlow
      // para evitar estados inconsistentes
      if (err && typeof err === 'object' && (err.status === 404 || (err.body && err.body.error === 'flow_not_found'))) {
        logger.warn('Fluxo não encontrado, limpando estado', { flowId });
        setCurrentFlow(null);
        setValidation(null);
        setSimulation(null);
      }
      
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Salva o fluxo atual (create ou update) usando o backend.
   *
   * @param {Object} reteJson - JSON do editor no formato Rete.js
   * @param {{ tenantId?: string, id?: string, name?: string }} [metaOverrides]
   */
  const saveFlow = useCallback(
    async (reteJson, metaOverrides) => {
      if (!reteJson) {
        logger.warn('saveFlow chamado sem reteJson');
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
        const editorNodeCount = reteJson?.nodes ? Object.keys(reteJson.nodes).length : 0;
        logger.debug('Convertendo reteJson para formato engine', { 
          nodeCount: editorNodeCount,
          reteJsonKeys: Object.keys(reteJson || {})
        });

        const flowDefinition = reteJsonToEngineFlow(reteJson, baseMeta);
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

        // Se o backend retornar erro de validação, atualiza o painel de validação
        // com os mesmos erros retornados pelo backend (sem o usuário precisar clicar em "Validar").
        if (err && typeof err === 'object' && err.body && err.body.error === 'validation_failed') {
          const rawErrors = Array.isArray(err.body.errors) ? err.body.errors : [];
          // ✅ Erros já vêm mapeados e amigáveis do backend
          const validationResult = {
            valid: false,
            errors: rawErrors,
            uiErrors: rawErrors, // ✅ Usa diretamente (já são amigáveis)
          };

          logger.info('Atualizando painel de validação após erro ao salvar fluxo', {
            errorCount: validationResult.uiErrors.length, // ✅ Corrigido: usa validationResult.uiErrors
            errors: validationResult.uiErrors.map((e) => ({ // ✅ Corrigido: usa validationResult.uiErrors
              code: e.code,
              message: e.message,
              nodeIds: e.nodeIds,
            })),
          });

          setValidation(validationResult);
        }

        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [currentFlow],
  );

  /**
   * Valida o fluxo atual no backend.
   * 
   * @param {Object} reteJson - JSON do editor no formato Rete.js
   */
  const validateCurrentFlow = useCallback(async (reteJson) => {
    if (!reteJson) return null;

    setLoading(true);
    setError(null);

    try {
      const flowDefinition = reteJsonToEngineFlow(reteJson, currentFlow || undefined);
      const result = await flowsApi.validateFlow(flowDefinition);
      
      // ✅ Remove mapeamento duplicado - erros já vêm mapeados e amigáveis do backend
      const validationResult = {
        ...result,
        uiErrors: result.errors || [], // ✅ Usa diretamente (já são amigáveis)
      };
      
      // Debug: log dos erros (já mapeados)
      logger.debug('Validação concluída', {
        valid: validationResult.valid,
        errorCount: validationResult.uiErrors.length,
        errors: validationResult.uiErrors.map(e => ({
          code: e.code,
          message: e.message,
          nodeIds: e.nodeIds,
        })),
      });
      
      setValidation(validationResult);
      return validationResult;
    } catch (err) {
      logger.error('Erro ao validar fluxo', err);
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [currentFlow]);

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
        logger.error('Erro ao simular fluxo', err);
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

  /**
   * Limpa o fluxo atual e todos os estados relacionados.
   */
  const clearCurrentFlow = useCallback(() => {
    logger.info('Limpando fluxo atual');
    setCurrentFlow(null);
    setSelectedNode(null);
    setValidation(null);
    setSimulation(null);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      currentFlow,
      selectedNode,
      validation,
      simulation,
      loading,
      error,

      setSelectedNode,
      setValidation,
      setSimulation,
      clearError,

      loadFlow,
      saveFlow,
      validateCurrentFlow,
      simulateCurrentFlow,
      deleteFlow,
      clearCurrentFlow,
    }),
    [
      clearError,
      currentFlow,
      error,
      loadFlow,
      loading,
      selectedNode,
      simulation,
      validateCurrentFlow,
      validation,
      saveFlow,
      simulateCurrentFlow,
      deleteFlow,
      clearCurrentFlow,
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


