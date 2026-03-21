/**
 * Standard Mode Execution Orchestrator
 * 
 * Handles standard (non-tenant) system generation and validation flow:
 * - Optional description suggestion via RAG
 * - Rate limit checking (local and server)
 * - File processing and RAG indexing
 * - Question/FAQ auto-generation
 * - Artifact generation (flow, RPA, seed)
 * 
 * This module extracts the standard mode logic from handleExecute to keep
 * the main handler focused on routing between tenant and standard modes.
 */

import {
  logAndSetError,
} from './generateSystemOrchestratorUtils';
import {
  runStandardDescriptionSuggestionStep,
  runStandardExecutionPipelineStep,
} from './generateSystemStandardModeSteps';

/** @typedef {{setExecuting: Function, setError: Function, setResult: Function, setDescription: Function, setQuestionsList: Function, resetInitialFlowUiState: Function, setPipelineStatus: Function, setPipelineDetails: Function, updatePipelineWithDetails: Function, setRateLimitUntil: Function, setRateLimitSecondsRemaining: Function}} StandardOrchestratorActions */

/** @typedef {{pipelineExecutionIdRef: {current: string|null}, pipelineMachine: {start: Function}, pipelineSocket: {subscribe: Function}}} StandardOrchestratorPipeline */

/** @typedef {{initializeStandardExecutionState: Function, enforceLocalRateLimitBeforeExecution: Function, generatePayload: Function, verifyServerRateLimitBeforeExecution: Function, processPendingFilesPipelineStep: Function, verifyServerHealthBeforeExecution: Function, prepareExecutionQuestions: Function, generateAndValidate: Function, handleExecutionRateLimitError: Function, handleGenericExecutionFailure: Function, collectUploadedFileNames: Function, requestDescriptionSuggestion: Function, getDescriptionSuggestionMeta: Function, fetchJson: Function, checkRateLimit: Function, logger: {info?: Function, warn?: Function, error?: Function, debug?: Function}, showToast: Function, suggestQuestionsAutoList: Function, getStepMessage: Function, processPendingFilesWithPipeline: Function}} StandardOrchestratorServices */

/** @typedef {{form: {name: string, descriptionMode: string}, flags: {executionMode: string, generateFlow: boolean, generateRpa: boolean, generateSeed: boolean, bootstrap: boolean, needsDescriptionSuggestion: boolean}, state: {uploadedFiles: unknown[], pipelineDetails: Record<string, unknown>, rateLimitUntil: number|null, agent: Record<string, unknown>}, actions: StandardOrchestratorActions, pipeline: StandardOrchestratorPipeline, services: StandardOrchestratorServices}} StandardOrchestratorConfig */

/**
 * Execute the complete standard mode workflow
 * @param {StandardOrchestratorConfig} config
 */
export async function executeStandardModeOrchestration(config) {
  const { form, flags, state, actions, pipeline, services } = config;

  const { name, descriptionMode } = form;
  const {
    executionMode,
    generateFlow,
    generateRpa,
    generateSeed,
    bootstrap,
    needsDescriptionSuggestion,
  } = flags;
  const { uploadedFiles, pipelineDetails, rateLimitUntil, agent } = state;
  const {
    setExecuting,
    setError,
    setResult,
    setDescription,
    setQuestionsList,
    resetInitialFlowUiState,
    setPipelineStatus,
    setPipelineDetails,
    updatePipelineWithDetails,
    setRateLimitUntil,
    setRateLimitSecondsRemaining,
  } = actions;
  const { pipelineExecutionIdRef, pipelineMachine, pipelineSocket } = pipeline;
  const {
    initializeStandardExecutionState,
    enforceLocalRateLimitBeforeExecution,
    generatePayload,
    verifyServerRateLimitBeforeExecution,
    processPendingFilesPipelineStep,
    verifyServerHealthBeforeExecution,
    prepareExecutionQuestions,
    generateAndValidate,
    handleExecutionRateLimitError,
    handleGenericExecutionFailure,
    collectUploadedFileNames,
    requestDescriptionSuggestion,
    getDescriptionSuggestionMeta,
    fetchJson,
    checkRateLimit,
    logger,
    showToast,
    suggestQuestionsAutoList,
    getStepMessage,
    processPendingFilesWithPipeline,
  } = services;

  initializeStandardExecutionState({
    setExecuting,
    setError,
    setResult,
    pipelineExecutionIdRef,
    pipelineMachine,
    pipelineSocket,
    resetInitialFlowUiState,
    setPipelineStatus,
    setPipelineDetails,
  });
  
  const descriptionStep = await runStandardDescriptionSuggestionStep({
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
  });
  if (!descriptionStep.ok) {
    return;
  }
  
  logger.info('[Execute] Iniciando execução do pipeline', {
    name,
    bootstrap,
    executionMode,
    generateFlow,
    generateRpa,
    generateSeed,
  });

  try {
    const pipelineStep = await runStandardExecutionPipelineStep({
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
    });
    if (!pipelineStep.ok) {
      return;
    }
  } catch (err) {
    logAndSetError({
      err,
      logger,
      setError,
      source: 'StandardMode',
      defaultMessage: 'Erro ao executar geração',
    });
    
    // Handle rate limit errors
    const rateLimitHandling = handleExecutionRateLimitError({
      err,
      agent,
      bootstrap,
      executionMode,
      setRateLimitUntil,
      setRateLimitSecondsRemaining,
      setError,
      setExecuting,
      logger,
    });
    if (rateLimitHandling.blocked) {
      return;
    }

    // Handle generic execution failures
    handleGenericExecutionFailure({
      err,
      pipelineDetails,
      updatePipelineWithDetails,
      setError,
    });
  } finally {
    setExecuting(false);
  }
}
