import {
  createDryRunTenant,
  createRealTenant,
  handleWebScrapingError,
  summarizeUploadedFileStatuses,
  validateTenantCreationResponse,
} from './generateSystemOrchestratorUtils';

/** @typedef {{executionMode: string, description: string, uploadedFiles: unknown[], processPendingFilesPipelineStep: Function, processPendingFilesWithPipeline: Function, setPipelineDetails: Function, updatePipelineWithDetails: Function, ephemeralChunksRef: {current: unknown[]}, reuseSuccessfulUploadedFilesAsEvidence: Function, prepareTenantDryRunDescription: Function, fetchJson: Function, logger: {info?: Function, warn?: Function, error?: Function}, validatedTenantId: string|null, pipelineExecutionId: string, scrapingTargets: string[], useWebScraping: boolean, persistDryRunEphemeralContext: Function, name: string, descriptionMode: string, setDescription: Function, setInitialFlow: Function, setError: Function, setExecuting: Function, useInlineChunksForSuggestRef: {current: boolean}}} TenantDescriptionAndEvidenceParams */

/** @typedef {{ok: boolean, finalDescription?: string, webScrapingDone?: boolean}} TenantDescriptionAndEvidenceResult */

/**
 * @param {TenantDescriptionAndEvidenceParams} params
 * @returns {Promise<TenantDescriptionAndEvidenceResult>}
 */
export async function prepareTenantDescriptionAndEvidence({
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
}) {
  let finalDescription = description.trim();
  let webScrapingDone = false;

  useInlineChunksForSuggestRef.current = false;
  ephemeralChunksRef.current = [];

  const dryRunExecutionId = executionMode === 'dry-run' ? pipelineExecutionId : null;
  const ephemeralChunks = ephemeralChunksRef.current;

  const fileSummary = summarizeUploadedFileStatuses(uploadedFiles);
  const baseMessage = fileSummary.pending > 0
    ? (executionMode === 'dry-run'
        ? `${fileSummary.pending} arquivo(s) processado(s) (dry-run: não indexado(s) no RAG)`
        : `${fileSummary.pending} arquivo(s) processado(s) (pré-criação: persistência/indexação no tenant alvo ocorre após criar o tenant)`)
    : 'Nenhum arquivo pendente para inferir/indexar';

  await processPendingFilesPipelineStep({
    uploadedFiles,
    processPendingFilesWithPipeline,
    source: 'TenantMode',
    sourceTag: 'file-processing',
    setPipelineDetails,
    updatePipelineWithDetails,
    collectEvidence: true,
    evidenceChunks: ephemeralChunks,
    completionMessage: baseMessage,
    emptyMessage: 'Nenhum arquivo pendente para inferir/indexar',
    waitAfterMs: 2000,
  });

  if (executionMode === 'dry-run') {
    reuseSuccessfulUploadedFilesAsEvidence({
      uploadedFiles,
      ephemeralChunks,
    });

    if (!description.trim()) {
      const dryRunDescriptionResult = await prepareTenantDryRunDescription({
        fetchJson,
        logger,
        validatedTenantId,
        pipelineExecutionId,
        dryRunExecutionId,
        scrapingTargets,
        useWebScraping,
        updatePipelineWithDetails,
        ephemeralChunks,
        persistDryRunEphemeralContextFn: persistDryRunEphemeralContext,
        name,
        descriptionMode,
        uploadedFiles,
        setDescription,
        setInitialFlow,
        setError,
        setExecuting,
      });
      if (!dryRunDescriptionResult.ok) {
        return { ok: false };
      }

      webScrapingDone = dryRunDescriptionResult.webScrapingDone;
      finalDescription = dryRunDescriptionResult.finalDescription;
    }
  }

  return { ok: true, finalDescription, webScrapingDone };
}

/** @typedef {{useWebScraping: boolean, scrapingTargets: string[], webScrapingDone: boolean, executionMode: string, getValidHttpUrls: Function, executeTenantPostDescriptionScraping: Function, fetchJson: Function, validatedTenantId: string|null, pipelineExecutionIdRef: {current: string|null}, logger: {info?: Function, warn?: Function, error?: Function}, setError: Function, appendScrapedTextChunks: Function, ephemeralChunksRef: {current: unknown[]}, setExecuting: Function}} TenantPostDescriptionScrapingParams */

/** @typedef {{ok: boolean, webScrapingDone?: boolean}} TenantPostDescriptionScrapingResult */

/**
 * @param {TenantPostDescriptionScrapingParams} params
 * @returns {Promise<TenantPostDescriptionScrapingResult>}
 */
export async function runTenantPostDescriptionWebScraping({
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
}) {
  const validUrlsForScraping = getValidHttpUrls(scrapingTargets);
  if (!(useWebScraping && validUrlsForScraping.length > 0 && !webScrapingDone)) {
    return { ok: true, webScrapingDone };
  }

  webScrapingDone = true;
  if (executionMode === 'dry-run') {
    return { ok: true, webScrapingDone };
  }

  try {
    const shouldPersistScraping = false;
    const {
      results,
      successCount,
      failedCount,
      errorSummary,
    } = await executeTenantPostDescriptionScraping({
      fetchJson,
      validatedTenantId,
      validUrlsForScraping,
      executionId: pipelineExecutionIdRef.current || null,
      shouldPersistScraping,
      timeoutMs: 60000,
    });

    logger.info('[Pipeline][webScraping] Web scraping concluído', {
      urlsTotal: validUrlsForScraping.length,
      successCount,
      failedCount,
      errorSummary,
    });

    if (successCount === 0) {
      handleWebScrapingError({
        scrapingError: new Error('Nenhuma URL raspada'),
        logger,
        setError,
        source: 'TenantMode',
      });
      console.error('[TenantMode][webScraping] Nenhuma URL raspada com sucesso. Resumo de erros:', errorSummary);
      setExecuting(false);
      return { ok: false };
    }

    try {
      if (!shouldPersistScraping) {
        appendScrapedTextChunks({ targetChunks: ephemeralChunksRef.current, results });
      }
    } catch (_) {
      // noop
    }

    if (shouldPersistScraping) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return { ok: true, webScrapingDone };
  } catch (scrapingError) {
    handleWebScrapingError({
      scrapingError,
      logger,
      setError,
      source: 'TenantMode',
    });
    console.error('[TenantMode][webScraping] Falha no scraping. URLs:', validUrlsForScraping, scrapingError);
    setExecuting(false);
    return { ok: false };
  }
}

/** @typedef {{executionMode: string, generateResult: Record<string, unknown>, name: string, logger: {info?: Function, warn?: Function, error?: Function}, updatePipelineWithDetails: Function}} TenantCreationResolutionParams */

/** @typedef {{tenant: Record<string, unknown>, dryRun: boolean}} TenantCreationResolutionResult */

/**
 * @param {TenantCreationResolutionParams} params
 * @returns {TenantCreationResolutionResult}
 */
export function resolveCreatedTenantFromAiResult({
  executionMode,
  generateResult,
  name,
  logger,
  updatePipelineWithDetails,
}) {
  if (!generateResult?.tenant) {
    throw new Error('A IA não retornou dados válidos');
  }

  if (executionMode === 'dry-run') {
    logger.info('[TenantMode] Modo dry-run: simulando criação do tenant (não será persistido)');
    const createdTenant = createDryRunTenant(generateResult, name);
    updatePipelineWithDetails({
      payloadValid: true,
      dryRun: true,
      message: 'Tenant simulado (modo dry-run - não foi persistido)',
    }, 'tenant-creation');
    return createdTenant;
  }

  const validation = validateTenantCreationResponse(generateResult, executionMode);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const tenantResult = createRealTenant(generateResult);
  const createdTenant = { tenant: tenantResult.tenant, dryRun: false };
  logger.info(
    tenantResult.isExisting ? '[TenantMode] Tenant existente reaproveitado (site duplicado)' : '[TenantMode] Tenant criado em modo seguro (pending_review)',
    { tenantId: createdTenant?.tenant?.id }
  );
  updatePipelineWithDetails({
    payloadValid: true,
    message: tenantResult.isExisting
      ? 'Tenant existente reaproveitado (site já cadastrado)'
      : 'Tenant criado em modo seguro (pendente de aprovação)',
  }, 'tenant-creation');
  return createdTenant;
}
