/** @typedef {{includePrereqSteps?: boolean}} PipelineResetStateParams */

/**
 * @param {PipelineResetStateParams} [params]
 * @returns {{resetStatus: Object, resetDetails: Object}}
 */
export function buildPipelineResetState({ includePrereqSteps = false } = {}) {
  const resetStatus = {
    webScraping: false,
    descriptionSuggested: false,
    filesInferred: false,
    payloadValid: false,
    contractValid: false,
    contextBuilt: false,
    aiExecuted: false,
    flowGenerated: false,
    seedGenerated: false,
    rpaGenerated: false,
    rpaExecuted: false,
    approved: false,
  };

  const resetDetails = {
    webScraping: { status: 'pending', timestamp: null, message: null, progress: 0 },
    descriptionSuggested: { status: 'pending', timestamp: null, message: null, progress: 0, meta: null },
    filesInferred: { status: 'pending', timestamp: null, message: null, progress: 0 },
    payloadValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
    aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
  };

  if (includePrereqSteps) {
    resetStatus.providerValidated = false;
    resetStatus.ragValidated = false;
    resetDetails.providerValidated = { status: 'pending', timestamp: null, message: null, progress: 0 };
    resetDetails.ragValidated = { status: 'pending', timestamp: null, message: null, progress: 0 };
  }

  return { resetStatus, resetDetails };
}

/** @typedef {{fetchJson: Function, logger: {info?: Function, warn?: Function, error?: Function}, source: string, setError: Function, updatePipelineWithDetails: Function, showToast?: Function, notifyToast?: boolean}} VerifyServerHealthParams */

/**
 * @param {VerifyServerHealthParams} params
 * @returns {Promise<boolean>}
 */
export async function verifyServerHealthBeforeExecution({
  fetchJson,
  logger,
  source,
  setError,
  updatePipelineWithDetails,
  showToast,
  notifyToast = false,
}) {
  try {
    logger.info(`[${source}] Verificando saúde do servidor antes de executar em modo real...`);
    await fetchJson('/health', {
      method: 'GET',
      timeoutMs: 5000,
    });
    logger.info(`[${source}] Servidor está disponível, aguardando 2s para garantir estabilidade...`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    logger.info(`[${source}] Prosseguindo com execução`);
    return true;
  } catch (healthError) {
    logger.error(`[${source}] Servidor não está disponível`, healthError);
    const errorMessage = 'Servidor não está respondendo. Verifique se o servidor está rodando e tente novamente.';
    setError(errorMessage);
    if (notifyToast) {
      showToast?.(errorMessage, 'error');
    }
    updatePipelineWithDetails({
      aiExecuted: {
        status: 'error',
        progress: 0,
        message: 'Servidor não está disponível',
        timestamp: new Date().toISOString(),
      },
    }, 'server-unavailable');
    return false;
  }
}

/** @typedef {{setExecuting: Function, setError: Function, setResult: Function, pipelineAbortRef: {current: boolean}, resetInitialFlowUiState: Function, setPipelineStatus: Function, setPipelineDetails: Function}} TenantExecutionStateParams */

/**
 * @param {TenantExecutionStateParams} params
 * @returns {void}
 */
export function initializeTenantExecutionState({
  setExecuting,
  setError,
  setResult,
  pipelineAbortRef,
  resetInitialFlowUiState,
  setPipelineStatus,
  setPipelineDetails,
}) {
  setExecuting(true);
  setError(null);
  setResult(null);
  pipelineAbortRef.current = false;
  resetInitialFlowUiState();

  const { resetStatus, resetDetails } = buildPipelineResetState({ includePrereqSteps: true });
  setPipelineStatus(resetStatus);
  setPipelineDetails(resetDetails);
}

/** @typedef {{setExecuting: Function, setError: Function, setResult: Function, pipelineExecutionIdRef: {current: string|null}, pipelineMachine: {start: Function}, pipelineSocket: {subscribe: Function}, resetInitialFlowUiState: Function, setPipelineStatus: Function, setPipelineDetails: Function}} StandardExecutionStateParams */

/**
 * @param {StandardExecutionStateParams} params
 * @returns {void}
 */
export function initializeStandardExecutionState({
  setExecuting,
  setError,
  setResult,
  pipelineExecutionIdRef,
  pipelineMachine,
  pipelineSocket,
  resetInitialFlowUiState,
  setPipelineStatus,
  setPipelineDetails,
}) {
  setExecuting(true);
  setError(null);
  setResult(null);

  ensurePipelineExecution({
    pipelineExecutionIdRef,
    pipelineMachine,
    pipelineSocket,
    forceNew: false,
  });

  resetInitialFlowUiState();
  const { resetStatus, resetDetails } = buildPipelineResetState();
  setPipelineStatus(resetStatus);
  setPipelineDetails(resetDetails);
}

/** @typedef {{setPipelineStatus: Function, setPipelineDetails: Function}} ResetArtifactPipelineParams */

/**
 * @param {ResetArtifactPipelineParams} params
 * @returns {void}
 */
export function resetArtifactGenerationPipelineSteps({
  setPipelineStatus,
  setPipelineDetails,
}) {
  setPipelineStatus((previous) => ({
    ...previous,
    contractValid: false,
    contextBuilt: false,
    aiExecuted: false,
    flowGenerated: false,
    seedGenerated: false,
    rpaGenerated: false,
    rpaExecuted: false,
    approved: false,
  }));

  setPipelineDetails((previous) => ({
    ...previous,
    contractValid: { status: 'pending', timestamp: null, message: null, progress: 0 },
    contextBuilt: { status: 'pending', timestamp: null, message: null, progress: 0 },
    aiExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    flowGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    seedGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaGenerated: { status: 'pending', timestamp: null, message: null, progress: 0 },
    rpaExecuted: { status: 'pending', timestamp: null, message: null, progress: 0 },
    approved: { status: 'pending', timestamp: null, message: null, progress: 0 },
  }));
}

/** @typedef {{pipelineExecutionIdRef: {current: string|null}, pipelineMachine: {start: Function}, pipelineSocket: {subscribe: Function}, forceNew?: boolean}} EnsurePipelineExecutionParams */

/**
 * @param {EnsurePipelineExecutionParams} params
 * @returns {string}
 */
export function ensurePipelineExecution({
  pipelineExecutionIdRef,
  pipelineMachine,
  pipelineSocket,
  forceNew = false,
}) {
  if (forceNew || !pipelineExecutionIdRef.current) {
    const pipelineExecutionId = `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    pipelineExecutionIdRef.current = pipelineExecutionId;
    pipelineMachine.start(pipelineExecutionId);
    pipelineSocket.subscribe(pipelineExecutionId);
  }

  return pipelineExecutionIdRef.current;
}

/**
 * @param {{name?: string}[]} uploadedFiles
 * @returns {string[]}
 */
export function collectUploadedFileNames(uploadedFiles) {
  return Array.from(new Set(
    (Array.isArray(uploadedFiles) ? uploadedFiles : [])
      .map((file) => (typeof file?.name === 'string' ? file.name.trim() : ''))
      .filter(Boolean)
  ));
}

/** @typedef {{fetchJson: Function, name: string, tenantId: string, executionId: string, descriptionMode: string, fileNames?: string[], urls?: string[], dryRun?: boolean}} RequestDescriptionSuggestionParams */

/**
 * @param {RequestDescriptionSuggestionParams} params
 * @returns {Promise<Object>}
 */
export async function requestDescriptionSuggestion({
  fetchJson,
  name,
  tenantId,
  executionId,
  descriptionMode,
  fileNames,
  urls,
  dryRun = false,
}) {
  return fetchJson('/system/suggest-description', {
    method: 'POST',
    body: JSON.stringify({
      name: String(name || '').trim(),
      tenantId,
      ...(Array.isArray(urls) && urls.length > 0 ? { urls } : {}),
      ...(Array.isArray(fileNames) && fileNames.length > 0 ? { fileNames } : {}),
      mode: descriptionMode,
      ...(dryRun ? { dryRun: true, contextMode: 'ephemeral' } : {}),
      executionId,
    }),
    timeoutMs: 60000,
  });
}

/** @typedef {{fetchJson: Function, contextTenantId: string, executionId: string, targetTenantId: string|null, executionMode: string, questionsList: string[], useInlineChunksForSuggest: boolean, ephemeralChunks: unknown[], timeoutMs?: number, silent?: boolean}} RequestInitialFlowGenerationParams */

/** @typedef {{response: Record<string, unknown>, flow: Record<string, unknown>|null, persisted: boolean, entities: Record<string, unknown>|null}} RequestInitialFlowGenerationResult */

/**
 * @param {RequestInitialFlowGenerationParams} params
 * @returns {Promise<RequestInitialFlowGenerationResult>}
 */
export async function requestInitialFlowGeneration({
  fetchJson,
  contextTenantId,
  executionId,
  targetTenantId,
  executionMode,
  questionsList,
  useInlineChunksForSuggest,
  ephemeralChunks,
  timeoutMs = 60000,
  silent = true,
}) {
  const response = await fetchJson('/system/generate-initial-flow', {
    method: 'POST',
    body: JSON.stringify({
      tenantId: contextTenantId,
      executionId,
      targetTenantId: targetTenantId || null,
      dryRun: executionMode === 'dry-run',
      persistFlow: executionMode !== 'dry-run',
      questions: Array.isArray(questionsList) ? questionsList.slice(0, 200) : [],
      ...(executionMode === 'dry-run' && useInlineChunksForSuggest
        ? {
            chunks: (Array.isArray(ephemeralChunks) ? ephemeralChunks : [])
              .slice(0, 30)
              .map((chunk) => ({ ...chunk, text: (chunk?.text || '').slice(0, 5000) })),
          }
        : {}),
    }),
    timeoutMs,
    silent,
  });

  return {
    response,
    flow: response?.initialFlow || response?.data?.initialFlow || null,
    persisted: response?.persisted === true || response?.data?.persisted === true,
    entities: response?.entities || response?.data?.entities || null,
  };
}

/** @typedef {{payload: Record<string, unknown>, suggestQuestionsAutoList: Function, setQuestionsList: Function, updatePipelineWithDetails?: Function, getStepMessage?: Function, logger?: {warn?: Function}, loggerMessage?: string, emptyMessage?: string, fallbackErrorMessage?: string, pipelineAbortRef?: {current: boolean}, setExecuting?: Function, setError?: Function, showToast?: Function, onAutoSuccess?: Function, onExistingQuestions?: Function, includePipelineStatus?: boolean}} PrepareExecutionQuestionsParams */

/**
 * @param {PrepareExecutionQuestionsParams} params
 * @returns {Promise<boolean>}
 */
export async function prepareExecutionQuestions({
  payload,
  suggestQuestionsAutoList,
  setQuestionsList,
  updatePipelineWithDetails,
  getStepMessage,
  logger,
  loggerMessage = '[Questions] Falha ao gerar perguntas automaticamente',
  emptyMessage = 'Não foi possível gerar perguntas automaticamente. Adicione ao menos 1 pergunta.',
  fallbackErrorMessage = 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.',
  pipelineAbortRef,
  setExecuting,
  setError,
  showToast,
  onAutoSuccess,
  onExistingQuestions,
  includePipelineStatus = false,
}) {
  const shouldIncludeQuestions = payload?.includeQuestions === true;
  const hasPayloadQuestions = Array.isArray(payload?.questions) && payload.questions.length > 0;
  const shouldAutoGenerate = shouldIncludeQuestions && !hasPayloadQuestions;

  if (!shouldIncludeQuestions) return true;

  if (shouldAutoGenerate) {
    try {
      if (includePipelineStatus && typeof updatePipelineWithDetails === 'function') {
        updatePipelineWithDetails({
          questionsGenerated: {
            status: 'in_progress',
            progress: 0,
            message: typeof getStepMessage === 'function'
              ? getStepMessage('questionsGenerated', 'in_progress')
              : 'Gerando perguntas automaticamente...',
            timestamp: new Date().toISOString(),
          },
        }, 'questions-auto');
      }

      const autoQuestions = await suggestQuestionsAutoList();
      if (!autoQuestions || autoQuestions.length === 0) {
        if (includePipelineStatus && typeof updatePipelineWithDetails === 'function') {
          updatePipelineWithDetails({
            questionsGenerated: {
              status: 'error',
              progress: 0,
              message: 'Não foi possível gerar perguntas automaticamente',
              timestamp: new Date().toISOString(),
            },
          }, 'questions-auto');
        }

        if (pipelineAbortRef) {
          pipelineAbortRef.current = true;
        }
        setError?.(emptyMessage);
        showToast?.(emptyMessage, 'error');
        setExecuting?.(false);
        return false;
      }

      setQuestionsList(autoQuestions);
      payload.questions = autoQuestions.slice(0, 50);

      if (includePipelineStatus && typeof updatePipelineWithDetails === 'function') {
        updatePipelineWithDetails({ questionsGenerated: true }, 'questions-auto');
      }

      if (typeof onAutoSuccess === 'function') {
        await onAutoSuccess(autoQuestions);
      }

      return true;
    } catch (error) {
      logger?.warn(loggerMessage, { error: error?.message });

      if (includePipelineStatus && typeof updatePipelineWithDetails === 'function') {
        updatePipelineWithDetails({
          questionsGenerated: {
            status: 'error',
            progress: 0,
            message: 'Falha ao gerar perguntas automaticamente',
            timestamp: new Date().toISOString(),
          },
        }, 'questions-auto');
      }

      if (pipelineAbortRef) {
        pipelineAbortRef.current = true;
      }
      const message = error?.message || fallbackErrorMessage;
      setError?.(message);
      showToast?.(message, 'error');
      setExecuting?.(false);
      return false;
    }
  }

  if (includePipelineStatus && typeof updatePipelineWithDetails === 'function') {
    updatePipelineWithDetails({ questionsGenerated: true }, 'questions-existing');
  }

  if (typeof onExistingQuestions === 'function') {
    onExistingQuestions();
  }

  return true;
}

/** @typedef {{fetchJson: Function, logger: {warn?: Function, info?: Function, error?: Function}, tenantId: string, executionId: string, ephemeralChunks: unknown[]}} PersistDryRunEphemeralContextParams */

/**
 * @param {PersistDryRunEphemeralContextParams} params
 * @returns {Promise<Object>}
 */
export async function persistDryRunEphemeralContext({
  fetchJson,
  logger,
  tenantId,
  executionId,
  ephemeralChunks,
}) {
  if (!ephemeralChunks || ephemeralChunks.length === 0) {
    logger.warn('[TenantMode] Nenhum chunk efêmero para persistir (dry-run). Isso pode causar fallback no suggest-description.', {
      tenantId,
      executionId,
    });
  } else {
    logger.info('[TenantMode] Persistindo contexto efêmero (dry-run) no backend...', {
      tenantId,
      executionId,
      chunksToSend: ephemeralChunks.length,
    });
  }

  const response = await fetchJson('/rag/ephemeral/context', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      executionId,
      chunks: ephemeralChunks,
      replace: true,
    }),
    timeoutMs: 15000,
  });

  logger.info('[TenantMode] Contexto efêmero persistido (dry-run)', {
    tenantId,
    executionId,
    stored: response?.stored ?? null,
    used: response?.used ?? null,
    key: response?.key ?? null,
    stats: response?.stats ?? null,
  });

  if (response?.used && String(response.used) !== 'redis') {
    const error = new Error('O contexto efêmero não foi persistido em Redis. A geração foi interrompida.');
    logger.error('[TenantMode] Contexto efêmero não persistido em Redis. Interrompendo geração.', {
      tenantId,
      executionId,
      used: response?.used,
    });
    throw error;
  }

  return response;
}

/** @typedef {{uploadedFiles: Array<{status?: string}>, processPendingFilesWithPipeline: Function, source: string, sourceTag: string, setPipelineDetails: Function, updatePipelineWithDetails: Function, completionMessage: string, emptyMessage?: string, collectEvidence?: boolean, evidenceChunks?: unknown[], waitAfterMs?: number, onNoPendingFiles?: Function}} ProcessPendingFilesPipelineStepParams */

/**
 * @param {ProcessPendingFilesPipelineStepParams} params
 * @returns {Promise<Array>}
 */
export async function processPendingFilesPipelineStep({
  uploadedFiles,
  processPendingFilesWithPipeline,
  source,
  sourceTag,
  setPipelineDetails,
  updatePipelineWithDetails,
  completionMessage,
  emptyMessage = 'Nenhum arquivo pendente para inferir/indexar',
  collectEvidence = false,
  evidenceChunks,
  waitAfterMs = 0,
  onNoPendingFiles,
}) {
  const pendingFiles = (Array.isArray(uploadedFiles) ? uploadedFiles : []).filter((file) => file.status === 'pending');

  if (pendingFiles.length > 0) {
    await processPendingFilesWithPipeline({
      pendingFiles,
      source,
      sourceTag,
      setPipelineDetails,
      updatePipelineWithDetails,
      collectEvidence,
      evidenceChunks,
      completionMessage,
      emptyMessage,
      waitAfterMs,
    });
  } else {
    if (typeof onNoPendingFiles === 'function') {
      onNoPendingFiles();
    }
    await processPendingFilesWithPipeline({
      pendingFiles,
      source,
      sourceTag,
      setPipelineDetails,
      updatePipelineWithDetails,
      completionMessage,
      emptyMessage,
    });
  }

  return pendingFiles;
}