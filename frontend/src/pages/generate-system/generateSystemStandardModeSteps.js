import {
  handleDescriptionSuggestionError,
  formatPartialSuccessMessage,
  summarizeUploadedFileStatuses,
} from './generateSystemOrchestratorUtils';

/** @typedef {{needsDescriptionSuggestion: boolean, agent: {tenantId?: string}, setError: Function, setExecuting: Function, updatePipelineWithDetails: Function, uploadedFiles: unknown[], collectUploadedFileNames: Function, requestDescriptionSuggestion: Function, fetchJson: Function, name: string, pipelineExecutionIdRef: {current: string|null}, descriptionMode: string, setDescription: Function, getDescriptionSuggestionMeta: Function, logger: {info?: Function, warn?: Function, error?: Function}}} StandardDescriptionSuggestionParams */

/** @typedef {{ok: boolean}} StandardStepResult */

/**
 * @param {StandardDescriptionSuggestionParams} params
 * @returns {Promise<StandardStepResult>}
 */
export async function runStandardDescriptionSuggestionStep({
  needsDescriptionSuggestion,
  agent,
  setError,
  setExecuting,
  updatePipelineWithDetails,
  uploadedFiles,
  collectUploadedFileNames,
  requestDescriptionSuggestion,
  fetchJson,
  name,
  pipelineExecutionIdRef,
  descriptionMode,
  setDescription,
  getDescriptionSuggestionMeta,
  logger,
}) {
  if (!needsDescriptionSuggestion) {
    return { ok: true };
  }

  if (!agent?.tenantId) {
    setError('Tenant não identificado. Faça login novamente e tente novamente.');
    setExecuting(false);
    return { ok: false };
  }

  try {
    updatePipelineWithDetails({
      descriptionSuggested: { status: 'in_progress', progress: 0, message: 'Sugerindo descrição com IA...' },
    }, 'description-suggestion');

    const uploadedFileNames = collectUploadedFileNames(uploadedFiles);

    const suggestionResponse = await requestDescriptionSuggestion({
      fetchJson,
      name,
      tenantId: agent.tenantId,
      executionId: pipelineExecutionIdRef.current,
      descriptionMode,
      fileNames: uploadedFileNames,
    });

    if (!suggestionResponse?.suggestion) {
      throw new Error('A IA não retornou uma descrição sugerida');
    }

    const suggestedDescription = suggestionResponse.suggestion.trim();
    setDescription(suggestedDescription);

    const meta = getDescriptionSuggestionMeta(suggestionResponse);
    updatePipelineWithDetails({
      descriptionSuggested: {
        status: 'completed',
        progress: 100,
        message: 'Descrição sugerida pela IA e aplicada automaticamente',
        meta,
        timestamp: new Date().toISOString(),
      },
    }, 'description-suggestion');

    logger.info('[Pipeline] Descrição sugerida e aplicada', {
      suggestedLength: suggestedDescription.length,
    });

    return { ok: true };
  } catch (suggestionError) {
    const { blocked } = handleDescriptionSuggestionError({
      suggestionError,
      logger,
      setError,
      updatePipelineWithDetails,
    });
    if (blocked) {
      setExecuting(false);
      return { ok: false };
    }
    return { ok: true };
  }
}

/** @typedef {{rateLimitUntil: number|null, bootstrap: string, executionMode: string, agent: Record<string, unknown>, setRateLimitUntil: Function, setRateLimitSecondsRemaining: Function, setError: Function, setExecuting: Function, logger: {info?: Function, warn?: Function, error?: Function, debug?: Function}, enforceLocalRateLimitBeforeExecution: Function, generatePayload: Function, verifyServerRateLimitBeforeExecution: Function, checkRateLimit: Function, processPendingFilesPipelineStep: Function, uploadedFiles: unknown[], processPendingFilesWithPipeline: Function, setPipelineDetails: Function, updatePipelineWithDetails: Function, verifyServerHealthBeforeExecution: Function, fetchJson: Function, prepareExecutionQuestions: Function, suggestQuestionsAutoList: Function, setQuestionsList: Function, getStepMessage: Function, generateAndValidate: Function, pipelineExecutionIdRef: {current: string|null}, setResult: Function, showToast: Function}} StandardExecutionPipelineParams */

/**
 * @param {StandardExecutionPipelineParams} params
 * @returns {Promise<StandardStepResult>}
 */
export async function runStandardExecutionPipelineStep({
  rateLimitUntil,
  bootstrap,
  executionMode,
  agent,
  setRateLimitUntil,
  setRateLimitSecondsRemaining,
  setError,
  setExecuting,
  logger,
  enforceLocalRateLimitBeforeExecution,
  generatePayload,
  verifyServerRateLimitBeforeExecution,
  checkRateLimit,
  processPendingFilesPipelineStep,
  uploadedFiles,
  processPendingFilesWithPipeline,
  setPipelineDetails,
  updatePipelineWithDetails,
  verifyServerHealthBeforeExecution,
  fetchJson,
  prepareExecutionQuestions,
  suggestQuestionsAutoList,
  setQuestionsList,
  getStepMessage,
  generateAndValidate,
  pipelineExecutionIdRef,
  setResult,
  showToast,
}) {
  const canProceedAfterLocalRateLimit = enforceLocalRateLimitBeforeExecution({
    rateLimitUntil,
    bootstrap,
    executionMode,
    agent,
    setRateLimitUntil,
    setRateLimitSecondsRemaining,
    setError,
    setExecuting,
    logger,
  });
  if (!canProceedAfterLocalRateLimit) {
    return { ok: false };
  }

  const payload = generatePayload();

  const canProceedAfterServerRateLimit = await verifyServerRateLimitBeforeExecution({
    checkRateLimit,
    payload,
    agent,
    bootstrap,
    executionMode,
    setRateLimitUntil,
    setRateLimitSecondsRemaining,
    setError,
    setExecuting,
    logger,
  });
  if (!canProceedAfterServerRateLimit) {
    return { ok: false };
  }

  logger.info('[Execute] ETAPA 0: Processando arquivos pendentes');
  const filesByStatus = summarizeUploadedFileStatuses(uploadedFiles);
  await processPendingFilesPipelineStep({
    uploadedFiles,
    processPendingFilesWithPipeline,
    source: 'Execute',
    sourceTag: 'execute',
    setPipelineDetails,
    updatePipelineWithDetails,
    completionMessage: `${filesByStatus.pending} arquivo(s) processado(s) e indexado(s) no RAG`,
    emptyMessage: 'Nenhum arquivo pendente para inferir/indexar',
    onNoPendingFiles: () => {
      logger.info('[Execute] ETAPA 0: Nenhum arquivo pendente, pulando etapa', {
        totalFiles: filesByStatus.total,
        filesByStatus: {
          pending: filesByStatus.pending,
          processing: filesByStatus.processing,
          success: filesByStatus.success,
          error: filesByStatus.error,
        },
      });
    },
  });

  logger.info('[Execute] Payload gerado', {
    payload: {
      name: payload.name,
      bootstrap: payload.bootstrap,
      executionMode: payload.executionMode,
      useRag: payload.useRag,
      useWebScraping: payload.useWebScraping,
      generate: payload.generate,
    },
  });

  updatePipelineWithDetails({ payloadValid: true }, 'execute');

  if (executionMode === 'real') {
    const serverReady = await verifyServerHealthBeforeExecution({
      fetchJson,
      logger,
      source: 'Execute',
      setError,
      updatePipelineWithDetails,
    });
    if (!serverReady) {
      setExecuting(false);
      return { ok: false };
    }
  }

  const questionsReady = await prepareExecutionQuestions({
    payload,
    suggestQuestionsAutoList,
    setQuestionsList,
    updatePipelineWithDetails,
    getStepMessage,
    logger,
    loggerMessage: '[Questions] Falha ao gerar perguntas automaticamente',
    emptyMessage: 'Não foi possível gerar perguntas automaticamente. Adicione ao menos 1 pergunta.',
    fallbackErrorMessage: 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.',
    setExecuting,
    setError,
    includePipelineStatus: true,
  });
  if (!questionsReady) {
    return { ok: false };
  }

  logger.info('[Execute] Chamando generateAndValidate');
  const pipelineExecutionId = pipelineExecutionIdRef.current;
  payload.executionId = pipelineExecutionId;
  payload.tenantPipeline = false;
  const response = await generateAndValidate(payload);

  logger.info('[Execute] generateAndValidate concluído', {
    success: response?.success,
    rpaPassed: response?.rpaPassed,
    flowGenerated: response?.flowGenerated,
    seedGenerated: response?.seedGenerated,
    rpaGenerated: response?.rpaGenerated,
    rpaExecuted: response?.rpaExecuted,
  });

  setResult(response);

  const partialSuccessMsg = formatPartialSuccessMessage(response);
  if (partialSuccessMsg) {
    showToast?.(partialSuccessMsg, 'warning', 10000);
  }

  return { ok: true };
}
