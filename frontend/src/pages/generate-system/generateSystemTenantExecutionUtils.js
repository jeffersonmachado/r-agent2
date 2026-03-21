import {
  appendScrapedTextChunks,
  executeWebScrapingBatch,
  getValidHttpUrls,
} from './generateSystemWebScrapingUtils';
import {
  collectUploadedFileNames,
  persistDryRunEphemeralContext,
  requestDescriptionSuggestion,
  requestInitialFlowGeneration,
} from './generateSystemExecutionCoreUtils';

/** @typedef {{uploadedFiles: Array<{status?: string, name?: string, id?: string, extractedContent?: string}>, ephemeralChunks: Array<{sourceType?: string, sourceId?: string, text?: string}>, minLength?: number, maxChunks?: number, maxTextLength?: number}} ReuseSuccessfulUploadedFilesParams */

/**
 * @param {ReuseSuccessfulUploadedFilesParams} params
 * @returns {void}
 */
export function reuseSuccessfulUploadedFilesAsEvidence({
  uploadedFiles,
  ephemeralChunks,
  minLength = 20,
  maxChunks = 30,
  maxTextLength = 5000,
}) {
  try {
    const seen = new Set((Array.isArray(ephemeralChunks) ? ephemeralChunks : []).map((chunk) => `${chunk?.sourceType || 'unknown'}|${chunk?.sourceId || ''}`));
    const existingFileChunks = (Array.isArray(uploadedFiles) ? uploadedFiles : [])
      .filter((file) => file && file.status === 'success')
      .map((file) => ({
        sourceType: 'uploaded_file',
        sourceId: (typeof file?.name === 'string' && file.name.trim()) ? file.name.trim() : (file?.id || 'arquivo'),
        text: (typeof file?.extractedContent === 'string' ? file.extractedContent : '').trim(),
      }))
      .filter((chunk) => chunk.text && chunk.text.length >= minLength)
      .slice(0, maxChunks);

    for (const chunk of existingFileChunks) {
      const key = `${chunk.sourceType}|${chunk.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ephemeralChunks.push({ ...chunk, text: chunk.text.slice(0, maxTextLength) });
    }
  } catch {
    // ignora (apenas melhoria de qualidade; não pode quebrar a execução)
  }
}

/** @typedef {{fetchJson: Function, logger: {info?: Function, warn?: Function, error?: Function}, validatedTenantId: string, pipelineExecutionId: string, dryRunExecutionId: string|null, scrapingTargets: string[], useWebScraping: boolean, updatePipelineWithDetails: Function, ephemeralChunks: unknown[], persistDryRunEphemeralContextFn?: Function, name: string, descriptionMode: string, uploadedFiles: Array<{name?: string}>, setDescription: Function, setInitialFlow: Function, setError: Function, setExecuting: Function}} PrepareTenantDryRunDescriptionParams */

/** @typedef {{ok: boolean, webScrapingDone: boolean, finalDescription?: string}} PrepareTenantDryRunDescriptionResult */

/**
 * @param {PrepareTenantDryRunDescriptionParams} params
 * @returns {Promise<PrepareTenantDryRunDescriptionResult>}
 */
export async function prepareTenantDryRunDescription({
  fetchJson,
  logger,
  validatedTenantId,
  pipelineExecutionId,
  dryRunExecutionId,
  scrapingTargets,
  useWebScraping,
  updatePipelineWithDetails,
  ephemeralChunks,
  persistDryRunEphemeralContextFn = persistDryRunEphemeralContext,
  name,
  descriptionMode,
  uploadedFiles,
  setDescription,
  setInitialFlow,
  setError,
  setExecuting,
}) {
  let webScrapingDone = false;

  try {
    const validUrls = getValidHttpUrls(scrapingTargets);

    if (useWebScraping && validUrls.length > 0) {
      webScrapingDone = true;
      updatePipelineWithDetails({
        webScraping: {
          status: 'in_progress',
          progress: 0,
          message: `Processando web scraping (dry-run) de ${validUrls.length} URL(s)...`,
          urlsTotal: validUrls.length,
        },
      }, 'webScrapingStarted');

      try {
        const {
          results,
          successCount,
          failedCount,
          durationMs,
        } = await executeWebScrapingBatch({
          fetchJson,
          urls: validUrls,
          headers: validatedTenantId ? { 'X-Tenant-Id': validatedTenantId } : undefined,
          payload: {
            executionId: pipelineExecutionId,
            dryRun: true,
            autoIndex: false,
            source: 'web_scraping',
            category: 'general',
          },
          timeoutMs: 60000,
        });

        appendScrapedTextChunks({ targetChunks: ephemeralChunks, results });

        if (successCount === 0) {
          const hasOtherEvidence = Array.isArray(ephemeralChunks)
            && ephemeralChunks.some((chunk) => chunk && typeof chunk.text === 'string' && chunk.text.trim().length >= 20);

          if (hasOtherEvidence) {
            updatePipelineWithDetails({
              webScraping: {
                status: 'warning',
                progress: 100,
                message: 'Nenhuma URL foi raspada com sucesso. Continuando com evidências dos arquivos (dry-run).',
                timestamp: new Date().toISOString(),
                urlsTotal: validUrls.length,
                successCount,
                failedCount,
                durationMs,
              },
            }, 'webScrapingCompleted');
          } else {
            setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
            updatePipelineWithDetails({
              webScraping: {
                status: 'error',
                progress: 0,
                message: 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.',
                timestamp: new Date().toISOString(),
                urlsTotal: validUrls.length,
                successCount,
                failedCount,
                durationMs,
              },
            }, 'webScrapingCompleted');
            setExecuting(false);
            return { ok: false, webScrapingDone };
          }
        }

        updatePipelineWithDetails({
          webScraping: {
            status: 'completed',
            progress: 100,
            message: `Web scraping (dry-run) concluído: ${successCount}/${validUrls.length} URL(s) processada(s)`,
            timestamp: new Date().toISOString(),
            urlsTotal: validUrls.length,
            successCount,
            failedCount,
            durationMs,
          },
        }, 'webScrapingCompleted');
      } catch (scrapingError) {
        logger.warn('[TenantMode] Web scraping dry-run falhou', scrapingError);
        const hasOtherEvidence = Array.isArray(ephemeralChunks)
          && ephemeralChunks.some((chunk) => chunk && typeof chunk.text === 'string' && chunk.text.trim().length >= 20);

        if (hasOtherEvidence) {
          updatePipelineWithDetails({
            webScraping: {
              status: 'warning',
              progress: 100,
              message: 'Web scraping falhou. Continuando com evidências dos arquivos (dry-run).',
              timestamp: new Date().toISOString(),
              urlsTotal: validUrls.length,
              successCount: 0,
              failedCount: validUrls.length,
              error: scrapingError?.message || 'erro',
            },
          }, 'webScrapingCompleted');
        } else {
          updatePipelineWithDetails({
            webScraping: {
              status: 'error',
              progress: 0,
              message: 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.',
              timestamp: new Date().toISOString(),
              urlsTotal: validUrls.length,
              successCount: 0,
              failedCount: validUrls.length,
              error: scrapingError?.message || 'erro',
            },
          }, 'webScrapingCompleted');
          setError('Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.');
          setExecuting(false);
          return { ok: false, webScrapingDone };
        }
      }
    }

    updatePipelineWithDetails({
      descriptionSuggested: {
        status: 'in_progress',
        progress: 0,
        message: 'Sugerindo descrição do tenant com IA usando conteúdo indexado...',
      },
    }, 'description-suggestion');

    if (dryRunExecutionId) {
      try {
        await persistDryRunEphemeralContextFn({
          fetchJson,
          logger,
          tenantId: validatedTenantId,
          executionId: dryRunExecutionId,
          ephemeralChunks,
        });
      } catch (error) {
        logger.error('[TenantMode] Falha ao persistir contexto efêmero (Redis). Interrompendo geração.', error);
        throw error;
      }
    }

    const uploadedFileNames = collectUploadedFileNames(uploadedFiles);
    const suggestionResponse = await requestDescriptionSuggestion({
      fetchJson,
      name,
      tenantId: validatedTenantId,
      executionId: pipelineExecutionId,
      descriptionMode,
      fileNames: uploadedFileNames,
      urls: validUrls,
      dryRun: true,
    });

    if (!suggestionResponse?.suggestion) {
      const errorMessage = 'A IA não retornou uma descrição sugerida. Não é possível continuar sem descrição.';
      logger.error('[TenantMode] Descrição não sugerida', { suggestionResponse });
      setError(errorMessage);
      setExecuting(false);
      return { ok: false, webScrapingDone };
    }

    const finalDescription = suggestionResponse.suggestion.trim();
    setDescription(finalDescription);

    if (suggestionResponse?.initialFlow && typeof suggestionResponse.initialFlow === 'object') {
      setInitialFlow(suggestionResponse.initialFlow);
    }

    logger.info('[TenantMode] Descrição sugerida e aplicada', {
      suggestedLength: finalDescription.length,
    });

    return {
      ok: true,
      webScrapingDone,
      finalDescription,
    };
  } catch (suggestionError) {
    logger.error('[TenantMode] Erro ao sugerir descrição', suggestionError);
    const message = suggestionError?.body?.message || suggestionError?.message || 'Erro ao sugerir descrição. Não é possível continuar sem descrição.';
    updatePipelineWithDetails({
      descriptionSuggested: { status: 'error', progress: 0, message, timestamp: new Date().toISOString() },
    }, 'description-suggestion-error');
    setError(message);
    setExecuting(false);
    return { ok: false, webScrapingDone };
  }
}

/**
 * @param {{name: string, description: string, executionMode: string}} params
 * @returns {string|null}
 */
export function validateTenantExecutionInput({ name, description, executionMode }) {
  const trimmedName = String(name || '').trim();
  const trimmedDescription = String(description || '').trim();

  if (!trimmedName || trimmedName.length < 3) {
    return 'Por favor, preencha o nome do tenant (mínimo 3 caracteres)';
  }

  if (executionMode === 'real') {
    if (!trimmedDescription || trimmedDescription.length < 10) {
      return 'Por favor, preencha a descrição do tenant (mínimo 10 caracteres) - obrigatória no modo execução real';
    }
    return null;
  }

  if (trimmedDescription && trimmedDescription.length < 10) {
    return 'A descrição do tenant deve ter pelo menos 10 caracteres';
  }

  return null;
}

/** @typedef {{ensureWebSocketAuthenticated: Function, logger: {warn?: Function}, wsState: {connected?: boolean, authenticated?: boolean}, agent: {tenantId?: string}, targetTenantIdRef: {current: string|null}, fetchJson: Function, pipelineExecutionId: string}} ValidateTenantPipelinePrereqsParams */

/**
 * @param {ValidateTenantPipelinePrereqsParams} params
 * @returns {Promise<string>}
 */
export async function validateTenantPipelinePrereqs({
  ensureWebSocketAuthenticated,
  logger,
  wsState,
  agent,
  targetTenantIdRef,
  fetchJson,
  pipelineExecutionId,
}) {
  const wsOk = await ensureWebSocketAuthenticated(6000);
  if (!wsOk) {
    logger.warn('[WebSocket] WS não autenticou a tempo; o pipeline visível pode não atualizar', {
      executionId: pipelineExecutionId,
      connected: wsState?.connected,
      authenticated: wsState?.authenticated,
    });
  }

  const tenantId = agent?.tenantId;
  if (!tenantId) {
    throw new Error('Tenant não identificado. Faça login novamente e tente novamente.');
  }

  targetTenantIdRef.current = null;

  await fetchJson('/system/pipeline/validate-prereqs', {
    method: 'POST',
    body: JSON.stringify({ executionId: pipelineExecutionId, useRag: true }),
    timeoutMs: 15000,
  });

  return tenantId;
}

/** @typedef {{executionMode: string, validatedTenantId: string|null, agent: {tenantId?: string}, createdTenant: {tenant?: {id?: string}}, targetTenantIdRef: {current: string|null}, uploadedFilesRef: {current: Array<Record<string, unknown>>}, uploadDocument: Function, updateUploadedFile: Function, pipelineExecutionIdRef: {current: string|null}, logger: {warn?: Function}, useWebScraping: boolean, scrapingTargets: string[], getValidHttpUrls: Function, persistWebScrapingOnTargetTenant: Function, fetchJson: Function}} PersistTenantTargetContentParams */

/**
 * @param {PersistTenantTargetContentParams} params
 * @returns {Promise<void>}
 */
export async function persistTenantTargetContentBestEffort({
  executionMode,
  validatedTenantId,
  agent,
  createdTenant,
  targetTenantIdRef,
  uploadedFilesRef,
  uploadDocument,
  updateUploadedFile,
  pipelineExecutionIdRef,
  logger,
  useWebScraping,
  scrapingTargets,
  getValidHttpUrls: getValidUrlsOverride,
  persistWebScrapingOnTargetTenant,
  fetchJson,
}) {
  if (executionMode === 'dry-run') return;

  const contextTenantId = validatedTenantId || agent?.tenantId || null;
  const tenantTargetId = createdTenant?.tenant?.id || null;
  if (!contextTenantId || !tenantTargetId) return;

  targetTenantIdRef.current = tenantTargetId;

  try {
    const filesSnapshot = Array.isArray(uploadedFilesRef.current) ? uploadedFilesRef.current : [];
    const filesToPersist = filesSnapshot
      .filter((file) => file && file.status === 'success')
      .filter((file) => !file.documentId);

    for (const file of filesToPersist) {
      try {
        const response = await uploadDocument(file.file, {
          executionId: pipelineExecutionIdRef.current,
          tenantId: contextTenantId,
          persistTenantId: tenantTargetId,
          headers: { 'X-Tenant-Id': contextTenantId },
          category: file.category,
          tags: [file.category, 'generate-system'],
          metadata: {
            uploadedFrom: 'generate-system',
            originalFileName: file.name,
            fileName: file.name,
            fileSize: file.size,
            extractedContent: (typeof file.extractedContent === 'string' ? file.extractedContent : null),
            deferredPersist: true,
            deferredPersistReason: file.deferredPersistReason || 'tenant_mode_pre_creation',
          },
          autoIndex: true,
        });

        updateUploadedFile(file.id, {
          documentId: response?.document?.id || response?.id || null,
          isDuplicate: !!(response?.isDuplicate),
          deferredPersist: false,
          persistedTenantId: tenantTargetId,
        });
      } catch (error) {
        logger.warn('[TenantMode] Falha ao persistir arquivo no tenant alvo', {
          fileName: file?.name,
          tenantTargetId,
          error: error?.message || String(error),
        });
      }
    }

    const validUrlsToPersist = (typeof getValidUrlsOverride === 'function' ? getValidUrlsOverride : getValidHttpUrls)(scrapingTargets);
    if (useWebScraping && validUrlsToPersist.length > 0) {
      await persistWebScrapingOnTargetTenant({
        fetchJson,
        validUrlsToPersist,
        contextTenantId,
        executionId: pipelineExecutionIdRef.current || null,
        tenantTargetId,
        timeoutMs: 60000,
      });
    }
  } catch (error) {
    logger.warn('[TenantMode] Falha ao persistir conteúdo no tenant alvo (best-effort)', {
      tenantTargetId,
      error: error?.message || String(error),
    });
  }
}

/** @typedef {{pipelineAbortRef: {current: boolean}, setInitialGraphLoading: Function, createdTenant: {tenant?: {id?: string}}, validatedTenantId: string|null, agent: {tenantId?: string}, pipelineExecutionId: string, executionMode: string, questionsList: string[], useInlineChunksForSuggestRef: {current: boolean}, ephemeralChunksRef: {current: unknown[]}, fetchJson: Function, setInitialFlowEntities: Function, setInitialFlow: Function, logger: {warn?: Function}}} StartTenantInitialFlowParams */

/**
 * @param {StartTenantInitialFlowParams} params
 * @returns {void}
 */
export function startTenantInitialFlowBestEffort({
  pipelineAbortRef,
  setInitialGraphLoading,
  createdTenant,
  validatedTenantId,
  agent,
  pipelineExecutionId,
  executionMode,
  questionsList,
  useInlineChunksForSuggestRef,
  ephemeralChunksRef,
  fetchJson,
  setInitialFlowEntities,
  setInitialFlow,
  logger,
}) {
  if (pipelineAbortRef.current) return;

  setInitialGraphLoading(true);
  (async () => {
    const tenantTargetId = createdTenant?.tenant?.id || null;
    if (!tenantTargetId) return;

    const contextTenantId = validatedTenantId || agent?.tenantId || null;
    const executionId = pipelineExecutionId;
    if (!contextTenantId || !executionId) return;

    const { flow, persisted, entities } = await requestInitialFlowGeneration({
      fetchJson,
      contextTenantId,
      executionId,
      targetTenantId: tenantTargetId,
      executionMode,
      questionsList,
      useInlineChunksForSuggest: useInlineChunksForSuggestRef.current,
      ephemeralChunks: ephemeralChunksRef.current,
      timeoutMs: 120000,
      silent: true,
    });

    if (pipelineAbortRef.current) return;

    if (entities && Array.isArray(entities.services) && entities.services.length === 0) {
      // Sem toast local: feedback visual vem do backend via WS.
    }
    if (entities && typeof entities === 'object') {
      setInitialFlowEntities(entities);
    }
    if (flow && typeof flow === 'object') {
      setInitialFlow({ ...flow, __persisted: persisted });
    }
  })().catch((graphErr) => {
    logger.warn('[TenantMode] Falha ao gerar fluxo inicial automaticamente (best-effort)', {
      error: graphErr?.message || String(graphErr),
    });
  }).finally(() => {
    setInitialGraphLoading(false);
  });
}