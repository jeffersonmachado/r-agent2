import {
  processPendingFilesPipelineStep,
  prepareExecutionQuestions,
  verifyServerHealthBeforeExecution,
  validateTenantExecutionInput,
  initializeTenantExecutionState,
  ensurePipelineExecution,
  validateTenantPipelinePrereqs,
  reuseSuccessfulUploadedFilesAsEvidence,
  prepareTenantDryRunDescription,
  persistDryRunEphemeralContext,
  persistTenantTargetContentBestEffort,
  startTenantInitialFlowBestEffort,
  resetArtifactGenerationPipelineSteps,
  initializeStandardExecutionState,
  enforceLocalRateLimitBeforeExecution,
  verifyServerRateLimitBeforeExecution,
  handleExecutionRateLimitError,
  handleGenericExecutionFailure,
  collectUploadedFileNames,
  requestDescriptionSuggestion,
} from './generateSystemExecutionUtils';
import {
  getValidHttpUrls,
  executeTenantPostDescriptionScraping,
  appendScrapedTextChunks,
  persistWebScrapingOnTargetTenant,
} from './generateSystemWebScrapingUtils';
import { buildOrchestratorBuilderContext } from './generateSystemOrchestratorConfigBuilders';
import { getGenerateSystemDescriptionSuggestionMeta } from './generateSystemDescriptionSuggestionUtils';
import { getStepMessage } from './generateSystemPipelineUiConfig';
import { generateAndValidate, checkRateLimit } from '../../api/system';
import { fetchJson } from '../../api/client';
import logger from '../../utils/logger';
import * as tenantsApi from '../../api/tenants';
import { uploadDocument } from '../../api/ragDocuments';

/**
 * Monta o contexto completo do orquestrador a partir dos valores da página.
 * Centraliza a montagem dos grupos de serviços/estado que são passados para
 * buildOrchestratorBuilderContext, mantendo a página livre dessa lógica de cadernamento.
 */
export function useGenerateSystemOrchestratorContext({
  // form & flags
  name, description, descriptionMode, executionMode, generateFlow, generateRpa,
  generateSeed, bootstrap, useWebScraping, needsDescriptionSuggestion,
  // state
  uploadedFiles, scrapingTargets, questionsList, pipelineDetails, rateLimitUntil, agent,
  // actions
  setExecuting, setError, setResult, setDescription, setQuestionsList, setInitialFlow,
  setInitialFlowEntities, setInitialGraphLoading, resetInitialFlowUiState,
  setPipelineStatus, setPipelineDetails, updatePipelineWithDetails,
  setRateLimitUntil, setRateLimitSecondsRemaining,
  // pipeline refs & machines
  pipelineAbortRef, wsStateRef, pipelineExecutionIdRef, targetTenantIdRef,
  ephemeralChunksRef, useInlineChunksForSuggestRef, uploadedFilesRef,
  pipelineMachine, pipelineSocket,
  // computed functions
  generatePayload, processPendingFilesWithPipeline, processPendingFilesInBackground,
  updateUploadedFile, ensureWebSocketAuthenticated,
  // services
  showToast, suggestQuestionsAutoList, navigate,
}) {
  const orchestratorFormAndFlags = {
    name,
    description,
    descriptionMode,
    executionMode,
    generateFlow,
    generateRpa,
    generateSeed,
    bootstrap,
    useWebScraping,
    needsDescriptionSuggestion,
  };

  const orchestratorState = {
    uploadedFiles,
    scrapingTargets,
    questionsList,
    pipelineDetails,
    rateLimitUntil,
    agent,
  };

  const orchestratorActions = {
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
    setRateLimitUntil,
    setRateLimitSecondsRemaining,
  };

  const orchestratorPipelineRefs = {
    pipelineAbortRef,
    wsStateRef,
    pipelineExecutionIdRef,
    targetTenantIdRef,
    ephemeralChunksRef,
    useInlineChunksForSuggestRef,
    uploadedFilesRef,
    pipelineMachine,
    pipelineSocket,
  };

  const orchestratorSharedServices = {
    processPendingFilesPipelineStep,
    prepareExecutionQuestions,
    verifyServerHealthBeforeExecution,
    generatePayload,
    generateAndValidate,
    processPendingFilesWithPipeline,
    fetchJson,
    logger,
    showToast,
    suggestQuestionsAutoList,
  };

  const orchestratorTenantServices = {
    ensureWebSocketAuthenticated,
    validateTenantExecutionInput,
    initializeTenantExecutionState,
    ensurePipelineExecution,
    validateTenantPipelinePrereqs,
    reuseSuccessfulUploadedFilesAsEvidence,
    prepareTenantDryRunDescription,
    getValidHttpUrls,
    executeTenantPostDescriptionScraping,
    appendScrapedTextChunks,
    persistDryRunEphemeralContext,
    persistTenantTargetContentBestEffort,
    startTenantInitialFlowBestEffort,
    resetArtifactGenerationPipelineSteps,
    persistWebScrapingOnTargetTenant,
    processPendingFilesInBackground,
    navigate,
    tenantsApi,
    uploadDocument,
    updateUploadedFile,
  };

  const orchestratorStandardServices = {
    initializeStandardExecutionState,
    enforceLocalRateLimitBeforeExecution,
    verifyServerRateLimitBeforeExecution,
    handleExecutionRateLimitError,
    handleGenericExecutionFailure,
    collectUploadedFileNames,
    requestDescriptionSuggestion,
    getDescriptionSuggestionMeta: getGenerateSystemDescriptionSuggestionMeta,
    checkRateLimit,
    getStepMessage,
  };

  return buildOrchestratorBuilderContext({
    formAndFlags: orchestratorFormAndFlags,
    state: orchestratorState,
    actions: orchestratorActions,
    pipelineRefs: orchestratorPipelineRefs,
    sharedServices: orchestratorSharedServices,
    tenantServices: orchestratorTenantServices,
    standardServices: orchestratorStandardServices,
  });
}
