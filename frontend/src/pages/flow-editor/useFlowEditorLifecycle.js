import { useCallback } from 'react';
import logger from '../../utils/logger';
import { createFlow } from '../../api/flows';
import { engineFlowToReteJson } from '../../engine-mapper/engineMapper';
import { applyBackendValidationErrors } from '../../editor/validation/runFlowValidation';

export function useFlowEditorLifecycle({
  isBpmnDiagram,
  showToast,
  currentFlow,
  draftFlow,
  setCurrentFlowKind,
  setDraftFlow,
  setValidationCollapsed,
  validation,
  editorRef,
  setCanvasLocked,
  setCanvasLockReason,
  setDraftMeta,
  loadFlow,
  validateCurrentFlow,
  setValidation,
  clearCurrentFlow,
  setShowFlowGenerator,
  agent,
  setFlowListRefreshTrigger,
  setSelectedNode,
  setGeneratedFlowModalData,
  setShowGeneratedFlowModal,
  setShowTemplateSelector,
  summarizeValidationBySeverity,
  hasBlockingValidationErrors,
}) {
  const handleFlowKindChange = useCallback((nextKind) => {
    if (isBpmnDiagram) {
      showToast('Fluxos BPMN usam o tipo BPMN na interface e não alternam para Chat/Voz.', 'info', 2600);
      return;
    }
    const normalized = String(nextKind || 'chat').trim().toLowerCase() === 'voice' ? 'voice' : 'chat';
    if (currentFlow && currentFlow.id) {
      setCurrentFlowKind(normalized);
    }
    if (draftFlow && draftFlow.id) {
      setDraftFlow((prev) => (prev && typeof prev === 'object' ? { ...prev, kind: normalized } : prev));
    }
  }, [currentFlow, draftFlow, isBpmnDiagram, setCurrentFlowKind, setDraftFlow, showToast]);

  const handleFlowSelected = useCallback(async (flow) => {
    if (flow && flow.id) {
      setCanvasLocked(false);
      setCanvasLockReason(null);
      setDraftFlow(null);
      setDraftMeta(null);
      await loadFlow(flow.id);

      setTimeout(async () => {
        const editor = editorRef.current?.editor?.current;
        const area = editorRef.current?.area;
        if (editor && area) {
          try {
            const reteJson = await editor.toJSON();
            logger.info('Executando validação automática após carregar fluxo', {
              nodeCount: Object.keys(reteJson.nodes || {}).length,
            });

            const { validateFlow: validateFlowLocal } = await import('../../editor/flowValidator');
            const localValidation = validateFlowLocal(reteJson, { kind: flow?.kind || 'chat' });

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
              logger.info('Validação local de fallback falhou após carregar fluxo', {
                errorCount: formattedErrors.length,
                hasGlobalErrors: globalErrors.length > 0,
                globalErrorCodes: globalErrors.map((entry) => entry.code),
                errorCodes: formattedErrors.map((entry) => entry.code),
              });
              logger.debug('Detalhes da validação local', {
                formattedErrors: formattedErrors.map((entry) => ({
                  code: entry.code,
                  message: entry.message,
                  messageUi: entry.messageUi,
                  nodeIds: entry.nodeIds,
                })),
              });
              return;
            }

            const validationResult = await validateCurrentFlow(reteJson);
            if (validationResult) {
              applyBackendValidationErrors(editor, area, validationResult.errors || []);
              logger.info('Validação do backend concluída após carregar fluxo', {
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
              logger.warn('Validação retornou null após carregar fluxo');
            }
          } catch (validationErr) {
            logger.error('Erro ao validar fluxo após carregar', { error: validationErr });
          }
        } else {
          logger.warn('Editor ou area não disponível para validação automática', {
            hasEditor: !!editor,
            hasArea: !!area,
          });
        }
      }, 500);
    }
  }, [editorRef, loadFlow, setCanvasLockReason, setCanvasLocked, setDraftFlow, setDraftMeta, setValidation, validateCurrentFlow]);

  const handleFlowGenerated = useCallback(async (flow, meta = null) => {
    logger.info('Fluxo gerado', { flowId: flow?.id, flowName: flow?.name });
    setShowFlowGenerator(false);
    clearCurrentFlow();

    try {
      const aiGen = flow?.metadata?.aiGeneration || null;
      const usedFallback = aiGen && typeof aiGen.usedFallback === 'boolean' ? aiGen.usedFallback : false;
      if (usedFallback) {
        const reason = typeof aiGen.fallbackReason === 'string' ? aiGen.fallbackReason : null;
        const msg = typeof aiGen.fallbackUserMessage === 'string'
          ? aiGen.fallbackUserMessage
          : 'Fluxo gerado via fallback (versão simplificada). Revise antes de salvar.';
        showToast(reason ? `${msg} (${reason})` : msg, 'warning', 5500);
      }
    } catch {
      // best-effort
    }

    const generationWarnings =
      meta?.validationWarnings ||
      meta?.generationResult?.validationWarnings ||
      null;

    const hasGenerationWarnings =
      !!generationWarnings &&
      generationWarnings.valid === false &&
      Array.isArray(generationWarnings.errors) &&
      generationWarnings.errors.length > 0;

    if (hasGenerationWarnings) {
      const counts = summarizeValidationBySeverity(generationWarnings);
      showToast(
        `Fluxo gerado com avisos de validação (erros: ${counts.error}, warnings: ${counts.warning}, info: ${counts.info}). Verifique o painel de validação.`,
        counts.error > 0 ? 'warning' : 'info',
        counts.error > 0 ? 5000 : 3500,
      );

      setValidation({
        valid: false,
        errors: generationWarnings.errors,
        uiErrors: generationWarnings.errors,
      });
      if (counts.error > 0) setValidationCollapsed(false);
    }

    try {
      if (hasGenerationWarnings) {
        const editor = editorRef.current;
        if (!editor || !editor.loadFromJson) {
          showToast('Editor não está pronto para carregar o fluxo gerado', 'warning', 2500);
          return;
        }

        try {
          const reteJson = engineFlowToReteJson(flow);
          await editor.loadFromJson(reteJson);
          setSelectedNode(null);

          setDraftFlow(flow);
          setDraftMeta({
            id: flow?.id,
            name: flow?.name,
            tenantId: flow?.tenantId || agent?.tenantId || 'demo-tenant',
          });

          let uiErrorsToApply = Array.isArray(generationWarnings.errors) ? generationWarnings.errors : [];
          try {
            const { validateFlow: validateFlowLocal } = await import('../../editor/flowValidator');
            const localValidation = validateFlowLocal(reteJson, { kind: flow?.kind || 'chat' });
            const formattedLocalErrors = (localValidation?.errors || []).map((err) => ({
              code: err.code,
              message: err.message,
              messageUi: err.messageUi || err.message,
              severity: err.severity || 'error',
              nodeIds: err.nodeIds || [],
              details: err.details || {},
            }));

            if (formattedLocalErrors.length > 0) {
              uiErrorsToApply = formattedLocalErrors;
              setValidation({
                valid: false,
                errors: formattedLocalErrors,
                uiErrors: formattedLocalErrors,
              });
              if (hasBlockingValidationErrors({ errors: formattedLocalErrors })) {
                setValidationCollapsed(false);
              }
            }
          } catch (localErr) {
            logger.warn('Falha ao rodar validação local pós-loadFromJson (best-effort)', { error: localErr });
          }

          applyBackendValidationErrors(editor.editor?.current, editor.area, uiErrorsToApply);
          setCanvasLocked(false);
          setCanvasLockReason(null);
          showToast('Fluxo gerado com avisos. Revise o painel de validação.', 'warning', 3500);

          setGeneratedFlowModalData({
            mode: 'draft',
            flow,
            validationWarnings: generationWarnings,
          });
          setShowGeneratedFlowModal(true);
          return;
        } catch (loadErr) {
          logger.error('Erro ao carregar fluxo gerado como rascunho', loadErr);
          showToast('Erro ao carregar o fluxo gerado no canvas', 'error', 4000);
          return;
        }
      }

      const generationResult = meta?.generationResult || null;
      const subflowsToSave = Array.isArray(generationResult?.subflows)
        ? generationResult.subflows
        : null;

      if (Array.isArray(subflowsToSave) && subflowsToSave.length > 0) {
        for (const subflow of subflowsToSave) {
          if (!subflow || typeof subflow !== 'object') continue;
          // eslint-disable-next-line no-await-in-loop
          await createFlow(subflow);
        }
      }

      const savedFlow = await createFlow(flow);
      logger.info('Fluxo gerado salvo no backend', { savedFlowId: savedFlow?.id });
      setFlowListRefreshTrigger((prev) => prev + 1);
      setDraftFlow(null);
      setDraftMeta(null);

      if (savedFlow && savedFlow.id) {
        const hasValidationWarnings = savedFlow.validationWarnings &&
          savedFlow.validationWarnings.errors &&
          savedFlow.validationWarnings.errors.length > 0;

        if (hasValidationWarnings) {
          const counts = summarizeValidationBySeverity(savedFlow.validationWarnings);
          if (!hasGenerationWarnings) {
            showToast(
              `Fluxo gerado com avisos de validação (erros: ${counts.error}, warnings: ${counts.warning}, info: ${counts.info}). Verifique o painel de validação.`,
              counts.error > 0 ? 'warning' : 'info',
              counts.error > 0 ? 5000 : 3500,
            );
          }
        } else {
          showToast('Fluxo gerado com sucesso', 'success', 2000);
        }

        await loadFlow(savedFlow.id);
        logger.info('Fluxo gerado carregado no editor com sucesso');

        setGeneratedFlowModalData({
          mode: 'saved',
          flow: savedFlow,
          validationWarnings: savedFlow?.validationWarnings || generationWarnings || null,
        });
        setShowGeneratedFlowModal(true);

        setCanvasLocked(false);
        setCanvasLockReason(null);

        setTimeout(async () => {
          const editor = editorRef.current?.editor?.current;
          const area = editorRef.current?.area;
          if (editor && area) {
            try {
              if (hasValidationWarnings) {
                applyBackendValidationErrors(editor, area, savedFlow.validationWarnings.errors);
                setValidation({
                  valid: false,
                  errors: savedFlow.validationWarnings.errors,
                  uiErrors: savedFlow.validationWarnings.errors,
                });
                if (hasBlockingValidationErrors(savedFlow.validationWarnings)) {
                  setValidationCollapsed(false);
                }
                logger.info('Erros de validação aplicados após gerar fluxo', {
                  errorCount: savedFlow.validationWarnings.errors.length,
                });
              } else {
                const reteJson = await editor.toJSON();
                const validationResult = await validateCurrentFlow(reteJson);
                if (validationResult) {
                  applyBackendValidationErrors(editor, area, validationResult.errors || []);
                  if (!validationResult.valid && validationResult.errors && validationResult.errors.length > 0) {
                    if (hasBlockingValidationErrors({ errors: validationResult.errors })) {
                      setValidationCollapsed(false);
                    }
                  }
                }
              }
            } catch (validationErr) {
              logger.error('Erro ao validar fluxo gerado', { error: validationErr });
            }
          }
        }, 500);
      }
    } catch (err) {
      const isBadRequest = err && typeof err === 'object' && err.status === 400;
      const msg = String(err?.body?.message || err?.message || '');
      const looksLikeValidation =
        msg.includes('não passou na validação obrigatória') ||
        msg.includes('Plano gerado por IA é inválido') ||
        msg.includes('ROUTER_RULE_MISSING_CONDITION') ||
        msg.includes('NODE_DISCONNECTED');

      if (isBadRequest && looksLikeValidation) {
        logger.warn('Backend recusou salvar fluxo gerado; carregando como rascunho para revisão', {
          status: err.status,
          message: msg.slice(0, 500),
        });

        const editor = editorRef.current;
        if (editor && editor.loadFromJson) {
          try {
            const reteJson = engineFlowToReteJson(flow);
            await editor.loadFromJson(reteJson);
            setSelectedNode(null);

            setDraftFlow(flow);
            setDraftMeta({
              id: flow?.id,
              name: flow?.name,
              tenantId: flow?.tenantId || agent?.tenantId || 'demo-tenant',
            });

            try {
              const validationResult = await validateCurrentFlow(reteJson);
              if (validationResult) {
                applyBackendValidationErrors(
                  editor.editor?.current,
                  editor.area,
                  validationResult.errors || [],
                );
                if (!validationResult.valid && Array.isArray(validationResult.errors) && validationResult.errors.length > 0) {
                  setValidationCollapsed(false);
                }
              }
            } catch (validationErr) {
              logger.debug('Falha best-effort ao validar rascunho após 400', { error: validationErr });
            }

            setCanvasLocked(false);
            setCanvasLockReason(null);
            showToast('Fluxo carregado como rascunho (não foi salvo). Revise e clique em Salvar.', 'warning', 5000);

            setGeneratedFlowModalData({
              mode: 'draft',
              flow,
              validationWarnings: null,
            });
            setShowGeneratedFlowModal(true);
            return;
          } catch (loadErr) {
            logger.error('Erro ao carregar rascunho após 400', loadErr);
          }
        }
      }

      logger.error('Erro ao salvar fluxo gerado', err);
      showToast(`Erro ao salvar fluxo gerado: ${err.message || 'Erro desconhecido'}`, 'error', 5000);
    }
  }, [
    agent?.tenantId,
    clearCurrentFlow,
    editorRef,
    hasBlockingValidationErrors,
    loadFlow,
    setCanvasLockReason,
    setCanvasLocked,
    setDraftFlow,
    setDraftMeta,
    setFlowListRefreshTrigger,
    setGeneratedFlowModalData,
    setSelectedNode,
    setShowFlowGenerator,
    setShowGeneratedFlowModal,
    setValidation,
    setValidationCollapsed,
    showToast,
    summarizeValidationBySeverity,
    validateCurrentFlow,
  ]);

  const handleTemplateSelected = useCallback(async (flow) => {
    logger.info('Template selecionado', { templateId: flow?.id, templateName: flow?.name });
    setShowTemplateSelector(false);
    setCanvasLocked(false);
    setCanvasLockReason(null);
    setDraftFlow(null);
    setDraftMeta(null);
    clearCurrentFlow();

    try {
      const savedFlow = await createFlow(flow);
      logger.info('Fluxo salvo no backend', { savedFlowId: savedFlow?.id });
      setFlowListRefreshTrigger((prev) => prev + 1);

      if (savedFlow && savedFlow.id) {
        const hasValidationWarnings = savedFlow.validationWarnings &&
          savedFlow.validationWarnings.errors &&
          savedFlow.validationWarnings.errors.length > 0;

        if (hasValidationWarnings) {
          const counts = summarizeValidationBySeverity(savedFlow.validationWarnings);
          showToast(
            `Fluxo criado com avisos de validação (erros: ${counts.error}, warnings: ${counts.warning}, info: ${counts.info}). Verifique o painel de validação.`,
            counts.error > 0 ? 'warning' : 'info',
            counts.error > 0 ? 5000 : 3500,
          );
        } else {
          showToast('Fluxo criado com sucesso', 'success', 2000);
        }

        await loadFlow(savedFlow.id);
        logger.info('Fluxo carregado no editor com sucesso');

        setTimeout(async () => {
          const editor = editorRef.current?.editor?.current;
          const area = editorRef.current?.area;
          if (editor && area) {
            try {
              if (hasValidationWarnings) {
                applyBackendValidationErrors(editor, area, savedFlow.validationWarnings.errors);
                setValidation({
                  valid: false,
                  errors: savedFlow.validationWarnings.errors,
                  uiErrors: savedFlow.validationWarnings.errors,
                });
                setValidationCollapsed(false);

                logger.info('Erros de validação aplicados após criar fluxo', {
                  errorCount: savedFlow.validationWarnings.errors.length,
                });
                logger.debug('Detalhes dos erros de validação', {
                  errors: savedFlow.validationWarnings.errors.map((entry) => ({
                    code: entry.code,
                    message: entry.message,
                    nodeIds: entry.nodeIds,
                  })),
                });
              } else {
                const reteJson = await editor.toJSON();
                const validationResult = await validateCurrentFlow(reteJson);
                if (validationResult) {
                  applyBackendValidationErrors(editor, area, validationResult.errors || []);
                  if (!validationResult.valid && validationResult.errors && validationResult.errors.length > 0) {
                    setValidationCollapsed(false);
                  }
                  logger.info('Validação do backend concluída após criar novo fluxo', {
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
                }
              }
            } catch (validationErr) {
              logger.error('Erro ao validar fluxo após criar', { error: validationErr });
            }
          }
        }, 500);
      } else {
        logger.warn('Fluxo criado mas sem ID válido', { savedFlow });
        showToast('Erro: fluxo criado mas sem ID válido', 'error', 5000);
      }
    } catch (err) {
      logger.error('Erro ao criar fluxo do template', err);

      let errorMessage = 'Erro ao criar fluxo do template. Verifique os logs.';
      if (err && typeof err === 'object') {
        if (err.body && typeof err.body === 'object') {
          if (err.body.error === 'validation_failed' && err.body.errors && Array.isArray(err.body.errors)) {
            const errorCount = err.body.errors.length;
            errorMessage = `O fluxo não passou na validação (${errorCount} erro${errorCount > 1 ? 's' : ''} encontrado${errorCount > 1 ? 's' : ''}). Verifique os erros no painel de validação.`;
          } else if (err.body.message) {
            errorMessage = err.body.message;
          } else if (err.body.error) {
            errorMessage = `Erro: ${err.body.error}`;
          }
        } else if (err.message) {
          errorMessage = err.message;
        }
      }

      showToast(errorMessage, 'error', 5000);
    }
  }, [
    clearCurrentFlow,
    editorRef,
    loadFlow,
    setCanvasLockReason,
    setCanvasLocked,
    setDraftFlow,
    setDraftMeta,
    setFlowListRefreshTrigger,
    setShowTemplateSelector,
    setValidation,
    setValidationCollapsed,
    showToast,
    summarizeValidationBySeverity,
    validateCurrentFlow,
  ]);

  return {
    handleFlowKindChange,
    handleFlowSelected,
    handleFlowGenerated,
    handleTemplateSelected,
  };
}