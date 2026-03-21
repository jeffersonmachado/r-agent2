/**
 * Tenant Mode Application Orchestrator
 * 
 * Handles the complete tenant creation and artifact generation flow:
 * - Validation and initialization
 * - File processing and web scraping
 * - Tenant AI generation (dry-run or real)
 * - RAG persistence in target tenant
 * - Artifact generation (flow, RPA, seed)
 * 
 * This module extracts the tenant mode logic from handleExecute to keep
 * the main handler clean and focused on routing logic.
 */

import {
  extractErrorMessage,
  getPendingUploadedFiles,
  logAndSetError,
  buildTenantAiDescription,
  formatAiErrorMessage,
  summarizeUploadedFileStatuses,
} from './generateSystemOrchestratorUtils';
import {
  prepareTenantDescriptionAndEvidence,
  runTenantPostDescriptionWebScraping,
  resolveCreatedTenantFromAiResult,
} from './generateSystemTenantModeSteps';

/** @typedef {{setExecuting: Function, setError: Function, setResult: Function, setDescription: Function, setQuestionsList: Function, setInitialFlow: Function, setInitialFlowEntities: Function, setInitialGraphLoading: Function, resetInitialFlowUiState: Function, setPipelineStatus: Function, setPipelineDetails: Function, updatePipelineWithDetails: Function}} TenantOrchestratorActions */

/** @typedef {{pipelineAbortRef: {current: boolean}, wsStateRef: {current: Record<string, unknown>}, pipelineExecutionIdRef: {current: string|null}, targetTenantIdRef: {current: string|null}, ephemeralChunksRef: {current: unknown[]}, useInlineChunksForSuggestRef: {current: boolean}, uploadedFilesRef: {current: unknown[]}, pipelineMachine: {start: Function}, pipelineSocket: {subscribe: Function}}} TenantOrchestratorPipeline */

/** @typedef {{ensureWebSocketAuthenticated: Function, validateTenantExecutionInput: Function, initializeTenantExecutionState: Function, ensurePipelineExecution: Function, validateTenantPipelinePrereqs: Function, processPendingFilesPipelineStep: Function, reuseSuccessfulUploadedFilesAsEvidence: Function, prepareTenantDryRunDescription: Function, getValidHttpUrls: Function, executeTenantPostDescriptionScraping: Function, appendScrapedTextChunks: Function, persistDryRunEphemeralContext: Function, persistTenantTargetContentBestEffort: Function, startTenantInitialFlowBestEffort: Function, resetArtifactGenerationPipelineSteps: Function, prepareExecutionQuestions: Function, verifyServerHealthBeforeExecution: Function, generatePayload: Function, generateAndValidate: Function, persistWebScrapingOnTargetTenant: Function, processPendingFilesWithPipeline: Function, processPendingFilesInBackground: Function, navigate: Function, tenantsApi: Record<string, unknown>, fetchJson: Function, uploadDocument: Function, updateUploadedFile: Function, logger: {info?: Function, warn?: Function, error?: Function}, showToast: Function, suggestQuestionsAutoList: Function}} TenantOrchestratorServices */

/** @typedef {{form: {name: string, description: string, descriptionMode: string}, flags: {executionMode: string, generateFlow: boolean, generateRpa: boolean, generateSeed: boolean, useWebScraping: boolean}, state: {uploadedFiles: unknown[], scrapingTargets: string[], questionsList: string[], agent: {tenantId?: string}}, actions: TenantOrchestratorActions, pipeline: TenantOrchestratorPipeline, services: TenantOrchestratorServices}} TenantOrchestratorConfig */

/**
 * Execute the complete tenant mode workflow
 * @param {TenantOrchestratorConfig} config
 */
export async function executeTenantModeOrchestration(config) {
  const { form, flags, state, actions, pipeline, services } = config;

  const { name, description, descriptionMode } = form;
  const {
    executionMode,
    generateFlow,
    generateRpa,
    generateSeed,
    useWebScraping,
  } = flags;
  const { uploadedFiles, scrapingTargets, questionsList, agent } = state;
  const {
    setExecuting,
    setError,
    setResult,
    setDescription,
    setQuestionsList,
    setInitialFlow,
    setInitialFlowEntities,
    setInitialGraphLoading,
    resetInitialFlowUiState,
    setPipelineStatus,
    setPipelineDetails,
    updatePipelineWithDetails,
  } = actions;
  const {
    pipelineAbortRef,
    wsStateRef,
    pipelineExecutionIdRef,
    targetTenantIdRef,
    ephemeralChunksRef,
    useInlineChunksForSuggestRef,
    uploadedFilesRef,
    pipelineMachine,
    pipelineSocket,
  } = pipeline;
  const {
    ensureWebSocketAuthenticated,
    validateTenantExecutionInput,
    initializeTenantExecutionState,
    ensurePipelineExecution,
    validateTenantPipelinePrereqs,
    processPendingFilesPipelineStep,
    reuseSuccessfulUploadedFilesAsEvidence,
    prepareTenantDryRunDescription,
    getValidHttpUrls,
    executeTenantPostDescriptionScraping,
    appendScrapedTextChunks,
    persistDryRunEphemeralContext,
    persistTenantTargetContentBestEffort,
    startTenantInitialFlowBestEffort,
    resetArtifactGenerationPipelineSteps,
    prepareExecutionQuestions,
    verifyServerHealthBeforeExecution,
    generatePayload,
    generateAndValidate,
    persistWebScrapingOnTargetTenant,
    processPendingFilesWithPipeline,
    processPendingFilesInBackground,
    navigate,
    tenantsApi,
    fetchJson,
    uploadDocument,
    updateUploadedFile,
    logger,
    showToast,
    suggestQuestionsAutoList,
  } = services;

  const tenantValidationError = validateTenantExecutionInput({
    name,
    description,
    executionMode,
  });
  if (tenantValidationError) {
    setError(tenantValidationError);
    return;
  }

  initializeTenantExecutionState({
    setExecuting,
    setError,
    setResult,
    pipelineAbortRef,
    resetInitialFlowUiState,
    setPipelineStatus,
    setPipelineDetails,
  });

  let validatedTenantId = null;
  let webScrapingDone = false;

  const pipelineExecutionId = ensurePipelineExecution({
    pipelineExecutionIdRef,
    pipelineMachine,
    pipelineSocket,
    forceNew: true,
  });

  try {
    validatedTenantId = await validateTenantPipelinePrereqs({
      ensureWebSocketAuthenticated,
      logger,
      wsState: wsStateRef.current,
      agent,
      targetTenantIdRef,
      fetchJson,
      pipelineExecutionId,
    });
  } catch (prereqErr) {
    const msg = logAndSetError({
      err: prereqErr,
      logger,
      setError,
      source: 'TenantMode',
      defaultMessage: 'Falha ao validar pré-requisitos do pipeline',
    });
    showToast?.(msg, 'error');
    setExecuting(false);
    return;
  }

  try {
    const descriptionPrep = await prepareTenantDescriptionAndEvidence({
      executionMode,
      description,
      uploadedFiles,
      processPendingFilesPipelineStep,
      processPendingFilesWithPipeline,
      setPipelineDetails,
      updatePipelineWithDetails,
      ephemeralChunksRef,
      reuseSuccessfulUploadedFilesAsEvidence,
      prepareTenantDryRunDescription,
      fetchJson,
      logger,
      validatedTenantId,
      pipelineExecutionId,
      scrapingTargets,
      useWebScraping,
      persistDryRunEphemeralContext,
      name,
      descriptionMode,
      setDescription,
      setInitialFlow,
      setError,
      setExecuting,
      useInlineChunksForSuggestRef,
    });
    if (!descriptionPrep.ok) {
      return;
    }

    let { finalDescription } = descriptionPrep;
    webScrapingDone = descriptionPrep.webScrapingDone;

    const scrapingResult = await runTenantPostDescriptionWebScraping({
      useWebScraping,
      scrapingTargets,
      webScrapingDone,
      executionMode,
      getValidHttpUrls,
      executeTenantPostDescriptionScraping,
      fetchJson,
      validatedTenantId,
      pipelineExecutionIdRef,
      logger,
      setError,
      appendScrapedTextChunks,
      ephemeralChunksRef,
      setExecuting,
    });
    if (!scrapingResult.ok) {
      return;
    }
    webScrapingDone = scrapingResult.webScrapingDone;
    
    // Generate tenant via AI using description (suggested or provided)
    updatePipelineWithDetails({ 
      aiExecuted: { status: 'in_progress', progress: 0, message: 'Executando IA para gerar tenant...' }
    }, 'tenant-generation');
    
    const firstUrl = (Array.isArray(scrapingTargets) ? scrapingTargets : []).find(u => typeof u === 'string' && u.trim().startsWith('http')) || '';
    const descriptionForTenantAi = buildTenantAiDescription(name, firstUrl, finalDescription);

    const generateResult = await tenantsApi.generateTenantByAI(descriptionForTenantAi, {
      create: executionMode === 'real',
      executionId: pipelineExecutionIdRef.current,
    });
    
    updatePipelineWithDetails({
      aiExecuted: {
        status: 'completed',
        progress: 100,
        message: 'IA executada com sucesso',
        timestamp: new Date().toISOString(),
      },
    }, 'tenant-generation');

    const createdTenant = resolveCreatedTenantFromAiResult({
      executionMode,
      generateResult,
      name,
      logger,
      updatePipelineWithDetails,
    });

      // Persist RAG content in target tenant
      await persistTenantTargetContentBestEffort({
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
        getValidHttpUrls,
        persistWebScrapingOnTargetTenant,
        fetchJson,
      });
      
      const startInitialFlowBestEffort = () => startTenantInitialFlowBestEffort({
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
      });

      // Generate artifacts if requested
      if (generateFlow || generateRpa || generateSeed) {
        resetArtifactGenerationPipelineSteps({
          setPipelineStatus,
          setPipelineDetails,
        });
        
        const payload = generatePayload();
        payload.name = name.trim();

        const tenantQuestionsReady = await prepareExecutionQuestions({
          payload,
          suggestQuestionsAutoList,
          setQuestionsList,
          logger,
          loggerMessage: '[Questions] Falha ao gerar perguntas automaticamente (tenant mode)',
          emptyMessage: 'Não foi possível gerar perguntas automaticamente. Adicione ao menos 1 pergunta.',
          fallbackErrorMessage: 'Falha ao gerar perguntas automaticamente. Adicione ao menos 1 pergunta.',
          pipelineAbortRef,
          setExecuting,
          setError,
          showToast,
          onAutoSuccess: () => {
            startInitialFlowBestEffort();
          },
          onExistingQuestions: () => {
            startInitialFlowBestEffort();
          },
          includePipelineStatus: false,
        });
        if (!tenantQuestionsReady) return;
        
        const filesByStatus = summarizeUploadedFileStatuses(uploadedFiles);
        logger.info('[TenantMode] Arquivos já processados antes da sugestão de descrição', {
          totalFiles: filesByStatus.total,
          filesByStatus: {
            pending: filesByStatus.pending,
            processing: filesByStatus.processing,
            success: filesByStatus.success,
            error: filesByStatus.error,
          },
        });
        
        if (executionMode === 'real') {
          const serverReady = await verifyServerHealthBeforeExecution({
            fetchJson,
            logger,
            source: 'TenantMode',
            setError,
            updatePipelineWithDetails,
            showToast,
            notifyToast: true,
          });
          if (!serverReady) {
            setExecuting(false);
            return;
          }
        }
        
        payload.executionId = pipelineExecutionId;
        payload.tenantPipeline = true;

        const response = await generateAndValidate(payload);
        
        try {
          const flowFromArtifacts = response?.flowDefinition || null;
          if (flowFromArtifacts && typeof flowFromArtifacts === 'object') {
            setInitialFlow(prev => (prev ? prev : flowFromArtifacts));
          }
        } catch (_) {
          // noop
        }

        setResult({
          success: true,
          tenant: createdTenant.tenant,
          generated: true,
          ...response,
        });
      } else {
        // Create tenant only, without artifacts
        const pendingFiles = getPendingUploadedFiles(uploadedFiles);
        if (pendingFiles.length > 0) {
          processPendingFilesInBackground({
            pendingFiles,
            source: 'TenantMode',
            uploadedFiles,
          });
        }
        
        setResult({
          success: true,
          tenant: createdTenant.tenant,
          generated: true,
        });
        
        setTimeout(() => {
          navigate('/tenants');
        }, 2000);
      }
  } catch (err) {
    logger.error('[TenantMode] Erro ao gerar/criar tenant', err);
    
    updatePipelineWithDetails({ 
      aiExecuted: { 
        status: 'error', 
        progress: 0, 
        message: 'Erro na execução da IA',
        timestamp: new Date().toISOString()
      }
    }, 'tenant-generation-error');
    
    const rawMessage = extractErrorMessage(err, 'Erro ao gerar tenant por IA');
    setError(formatAiErrorMessage(rawMessage));
  } finally {
    setExecuting(false);
  }
}
