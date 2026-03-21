import { useCallback } from 'react';
import logger from '../../utils/logger';
import { reteJsonToEngineFlow } from '../../engine-mapper/engineMapper';
import { saveTemplate, updateFlowEnvironment } from '../../api/flows';
import { applyBackendValidationErrors } from '../../editor/validation/runFlowValidation';

export function useFlowEditorWorkflowActions({
  editorRef,
  showToast,
  saveFlow,
  draftMeta,
  currentFlow,
  activeFlow,
  agent,
  draftFlow,
  activeFlowMetadata,
  isBpmnDiagram,
  editorMode,
  setDraftFlow,
  setDraftMeta,
  setCanvasLocked,
  setCanvasLockReason,
  setFlowListRefreshTrigger,
  setShowSaveAsTemplate,
  setTemplateListRefreshTrigger,
  setValidationCollapsed,
  validateCurrentFlow,
  setValidation,
  clearCurrentFlow,
  setSelectedNode,
  setSimulationCollapsed,
  simulateCurrentFlow,
  setTestFlowDefinition,
  setTestKey,
  setShowTestChat,
  setFlowEnvironment,
  loadFlow,
  setShowDeleteConfirm,
  deleteFlow,
}) {
  const handleSave = useCallback(async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }

    try {
      const reteJson = await editor.toJSON();
      const saved = await saveFlow(reteJson, {
        ...(draftMeta || {}),
        tenantId: draftMeta?.tenantId || currentFlow?.tenantId || activeFlow?.tenantId || agent?.tenantId || 'demo-tenant',
        id: draftMeta?.id || currentFlow?.id || activeFlow?.id,
        name: draftMeta?.name || currentFlow?.name || activeFlow?.name || 'Fluxo sem nome',
        kind: currentFlow?.kind || draftFlow?.kind || activeFlow?.kind || draftMeta?.kind || 'chat',
        metadata: {
          ...(activeFlowMetadata && typeof activeFlowMetadata === 'object' ? activeFlowMetadata : {}),
          editorMode: isBpmnDiagram ? editorMode : 'engine',
          ...(isBpmnDiagram ? { diagramType: 'bpmn' } : {}),
        },
      });

      if (saved) {
        setDraftFlow(null);
        setDraftMeta(null);
        setCanvasLocked(false);
        setCanvasLockReason(null);
        setFlowListRefreshTrigger((prev) => prev + 1);
        showToast('Fluxo salvo com sucesso', 'success');
      } else {
        showToast('Erro ao salvar fluxo', 'error');
      }
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao salvar fluxo', 'error');
    }
  }, [
    activeFlow?.id,
    activeFlow?.kind,
    activeFlow?.name,
    activeFlow?.tenantId,
    activeFlowMetadata,
    agent?.tenantId,
    currentFlow?.id,
    currentFlow?.kind,
    currentFlow?.name,
    currentFlow?.tenantId,
    draftFlow?.kind,
    draftMeta,
    editorMode,
    editorRef,
    isBpmnDiagram,
    saveFlow,
    setCanvasLockReason,
    setCanvasLocked,
    setDraftFlow,
    setDraftMeta,
    setFlowListRefreshTrigger,
    showToast,
  ]);

  const handleSaveAsTemplate = useCallback(async (templateData) => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }

    try {
      const reteJson = await editor.toJSON();
      const flowDefinition = reteJsonToEngineFlow(reteJson, currentFlow || undefined);
      await saveTemplate({
        ...templateData,
        flow: flowDefinition,
      });
      showToast(`Template "${templateData.name}" salvo com sucesso!`, 'success', 3000);
      setShowSaveAsTemplate(false);
      setTemplateListRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      logger.error('Erro ao salvar template', err);
      const errorMessage = err?.body?.message || err?.message || 'Erro ao salvar template';
      showToast(errorMessage, 'error', 5000);
    }
  }, [currentFlow, editorRef, setShowSaveAsTemplate, setTemplateListRefreshTrigger, showToast]);

  const handleValidate = useCallback(async () => {
    const editor = editorRef.current?.editor?.current;
    const area = editorRef.current?.area;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }

    setValidationCollapsed(false);
    logger.info('Validação manual iniciada');

    try {
      const reteJson = await editor.toJSON();
      logger.debug('JSON do editor obtido para validação', {
        nodeCount: Object.keys(reteJson.nodes || {}).length,
      });

      const { validateFlow: validateFlowLocal } = await import('../../editor/flowValidator');
      const localValidation = validateFlowLocal(reteJson, { kind: currentFlow?.kind || 'chat' });

      if (!localValidation.valid && localValidation.errors.length > 0) {
        const formattedErrors = localValidation.errors.map((err) => ({
          code: err.code,
          message: err.message,
          messageUi: err.messageUi || err.message,
          severity: err.severity || 'error',
          nodeIds: err.nodeIds || [],
          details: err.details || {},
        }));
        applyBackendValidationErrors(editor, area, formattedErrors);

        const validationState = {
          valid: false,
          errors: formattedErrors,
          uiErrors: formattedErrors,
        };
        setValidation(validationState);

        const globalErrors = formattedErrors.filter((entry) => !entry.nodeIds || entry.nodeIds.length === 0);
        const nodeSpecificErrors = formattedErrors.filter((entry) => entry.nodeIds && entry.nodeIds.length > 0);

        logger.info('Validação local de fallback falhou', {
          errorCount: formattedErrors.length,
          globalErrorsCount: globalErrors.length,
          nodeSpecificErrorsCount: nodeSpecificErrors.length,
          globalErrorCodes: globalErrors.map((entry) => entry.code),
          formattedErrors: formattedErrors.map((entry) => ({
            code: entry.code,
            message: entry.message,
            messageUi: entry.messageUi,
            nodeIds: entry.nodeIds,
          })),
          validationState: {
            valid: validationState.valid,
            errorsCount: validationState.errors.length,
            uiErrorsCount: validationState.uiErrors.length,
          },
        });

        setValidationCollapsed(false);
        logger.debug('Estado de validação atualizado', {
          validationCollapsed: false,
          validationState: {
            valid: validationState.valid,
            errorsCount: validationState.errors.length,
            uiErrorsCount: validationState.uiErrors.length,
          },
        });
        return;
      }

      const validationResult = await validateCurrentFlow(reteJson);
      if (validationResult) {
        applyBackendValidationErrors(editor, area, validationResult.errors || []);
        logger.info('Validação do backend concluída', {
          valid: validationResult.valid,
          errorCount: validationResult.errors?.length || 0,
        });
        logger.debug('Detalhes da validação do backend', {
          validationState: {
            valid: validationResult.valid,
            errorsCount: validationResult.errors?.length || 0,
            uiErrorsCount: validationResult.uiErrors?.length || 0,
          },
        });
      } else {
        logger.warn('Validação do backend retornou null');
      }
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao validar fluxo', 'error');
    }
  }, [currentFlow?.kind, editorRef, setValidation, setValidationCollapsed, showToast, validateCurrentFlow]);

  const handleClearEditor = useCallback(async () => {
    const editorInstance = editorRef.current;
    if (!editorInstance || !editorInstance.clearEditor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }

    try {
      await editorInstance.clearEditor();
      clearCurrentFlow();
      setSelectedNode(null);
      showToast('Editor limpo com sucesso', 'success');
    } catch (err) {
      logger.error('Erro ao limpar editor', err);
      showToast('Erro ao limpar editor', 'error');
    }
  }, [clearCurrentFlow, editorRef, setSelectedNode, showToast]);

  const handleSimulate = useCallback(async () => {
    setSimulationCollapsed(false);
    await simulateCurrentFlow();
  }, [setSimulationCollapsed, simulateCurrentFlow]);

  const handleTest = useCallback(async () => {
    const editor = editorRef.current?.editor?.current;
    if (!editor) {
      showToast('Editor não está pronto', 'warning', 2000);
      return;
    }

    try {
      const reteJson = await editor.toJSON();
      const flowDefinition = reteJsonToEngineFlow(reteJson, currentFlow || undefined);
      setTestFlowDefinition(flowDefinition);
      setTestKey((prev) => prev + 1);
      setShowTestChat(true);
    } catch (err) {
      logger.error('Erro ao obter JSON do editor', err);
      showToast('Erro ao preparar teste do fluxo', 'error');
    }
  }, [currentFlow, editorRef, setShowTestChat, setTestFlowDefinition, setTestKey, showToast]);

  const handleEnvironmentChange = useCallback(async (nextEnv) => {
    if (!currentFlow?.id) return;

    const env = String(nextEnv || '').trim();
    if (!['dev', 'stage', 'prod'].includes(env)) return;

    try {
      await updateFlowEnvironment(currentFlow.id, env);
      setFlowEnvironment(env);
      await loadFlow(currentFlow.id);
      showToast(`Ambiente atualizado para "${env}"`, 'success');
    } catch (err) {
      logger.error('Erro ao atualizar environment do flow', err);
      showToast('Erro ao atualizar ambiente do fluxo', 'error');
    }
  }, [currentFlow?.id, loadFlow, setFlowEnvironment, showToast]);

  const handleDeleteClick = useCallback(() => {
    if (!currentFlow || !currentFlow.id) return;
    setShowDeleteConfirm(true);
  }, [currentFlow, setShowDeleteConfirm]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!currentFlow || !currentFlow.id) return;

    try {
      await deleteFlow(currentFlow.id);
      const editor = editorRef.current?.editor?.current;
      if (editor && typeof editor.clear === 'function') {
        editor.clear();
        logger.debug('Editor limpo após remoção do fluxo');
      }

      showToast('Fluxo removido com sucesso', 'success');
      setFlowListRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      logger.error('Erro ao remover fluxo', { error: err });
      showToast(`Erro ao remover fluxo: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    }
  }, [currentFlow, deleteFlow, editorRef, setFlowListRefreshTrigger, showToast]);

  return {
    handleSave,
    handleSaveAsTemplate,
    handleValidate,
    handleClearEditor,
    handleSimulate,
    handleTest,
    handleEnvironmentChange,
    handleDeleteClick,
    handleDeleteConfirm,
  };
}