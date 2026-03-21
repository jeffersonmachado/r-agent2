/**
 * Shared Orchestrator Utilities
 * 
 * Common error handling, validation, and pipeline messaging patterns
 * used by both tenant and standard mode orchestrators.
 * 
 * This module extracts duplicated patterns from orchestrators to reduce
 * code duplication and ensure consistency across execution paths.
 */

/**
 * @typedef {{error: Function, warn?: Function, info?: Function, debug?: Function}} LoggerLike
 */

/** @typedef {(details: Record<string, unknown>, sourceTag: string) => void} PipelineDetailsUpdater */

/** @typedef {{err: *, logger: LoggerLike, setError: (message: string) => void, source?: string, defaultMessage?: string}} LogAndSetErrorParams */

/** @typedef {{updatePipelineWithDetails: PipelineDetailsUpdater, errorMessage: string, stepName?: string}} UpdatePipelineErrorParams */

/** @typedef {{suggestionError: *, logger: LoggerLike, setError: (message: string) => void, updatePipelineWithDetails: PipelineDetailsUpdater}} HandleDescriptionSuggestionErrorParams */

/** @typedef {{scrapingError: *, logger: LoggerLike, setError: (message: string) => void, source?: string}} HandleWebScrapingErrorParams */

/**
 * @typedef {{status?: string}} TenantLike
 */

/**
 * @typedef {{tenant?: TenantLike, createdTenant?: TenantLike, existingTenant?: TenantLike}} TenantGenerationResult
 */

/** @typedef {{success?: boolean, warnings?: unknown[], rpaPassed?: boolean}} ExecutionResponse */

/**
 * @typedef {{status?: string}} UploadedFileLike
 */

/**
 * Extract error message from various error object formats
 * @param {*} err
 * @param {string} [defaultMessage='Erro desconhecido']
 * @returns {string}
 */
export function extractErrorMessage(err, defaultMessage = 'Erro desconhecido') {
  if (typeof err === 'string') {
    return err;
  }

  const body = err?.body;
  if (body) {
    const message =
      body?.error?.message ||
      body?.message ||
      body?.details ||
      body?.error;
    
    if (message) {
      return message;
    }
  }

  if (err?.message) {
    return err.message;
  }

  if (typeof err === 'object') {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }

  return defaultMessage;
}

/**
 * Extract error code from response structure
 * @param {*} err
 * @returns {string|null}
 */
function extractErrorCode(err) {
  return err?.body?.error?.code || err?.body?.code || err?.code || null;
}

/**
 * Log and set error consistently across orchestrators
 * @param {LogAndSetErrorParams} params
 * @param {*} params.err
 * @param {LoggerLike} params.logger
 * @param {(message: string) => void} params.setError
 * @param {string} [params.source='Orchestrator']
 * @param {string} [params.defaultMessage='Erro durante execução']
 * @returns {string}
 */
export function logAndSetError({
  err,
  logger,
  setError,
  source = 'Orchestrator',
  defaultMessage = 'Erro durante execução',
}) {
  logger.error(`[${source}] ${defaultMessage}`, err);
  
  const message = extractErrorMessage(err, defaultMessage);
  
  // Ensure string type
  const finalMessage = typeof message === 'string' ? message : String(message);
  
  setError(finalMessage);
  return finalMessage;
}

/**
 * Update pipeline with error status
 * @param {UpdatePipelineErrorParams} params
 * @param {PipelineDetailsUpdater} params.updatePipelineWithDetails
 * @param {string} params.errorMessage
 * @param {string} [params.stepName='execution']
 * @returns {void}
 */
function updatePipelineError({
  updatePipelineWithDetails,
  errorMessage,
  stepName = 'execution',
}) {
  updatePipelineWithDetails(
    {
      [stepName]: {
        status: 'error',
        progress: 0,
        message: errorMessage,
        timestamp: new Date().toISOString(),
      },
    },
    stepName
  );
}

/**
 * Format AI error message with friendly user text
 * @param {string} errorMessage
 * @returns {string}
 */
export function formatAiErrorMessage(errorMessage) {
  if (!errorMessage || typeof errorMessage !== 'string') {
    return 'Erro na execução de IA';
  }

  // Common friendly message mappings
  const mappings = {
    'Nenhum provider de IA configurado':
      'Provider de IA não configurado. Configure um provider de IA no sistema antes de usar esta funcionalidade.',
    'Provider de IA não disponível':
      'Nenhum provider de IA está disponível. Verifique a configuração de IA no sistema.',
  };

  for (const [pattern, friendly] of Object.entries(mappings)) {
    if (errorMessage.includes(pattern)) {
      return friendly;
    }
  }

  return errorMessage;
}

/**
 * Handle description suggestion errors consistently
 * @param {HandleDescriptionSuggestionErrorParams} params
 * @param {*} params.suggestionError
 * @param {LoggerLike} params.logger
 * @param {(message: string) => void} params.setError
 * @param {PipelineDetailsUpdater} params.updatePipelineWithDetails
 * @returns {{blocked: boolean, code: string|null, message: string}}
 */
export function handleDescriptionSuggestionError({
  suggestionError,
  logger,
  setError,
  updatePipelineWithDetails,
}) {
  const msg = extractErrorMessage(
    suggestionError,
    'Erro ao sugerir descrição.'
  );
  const code = extractErrorCode(suggestionError);

  logger.error('[Pipeline] Erro ao sugerir descrição', suggestionError);

  updatePipelineError({
    updatePipelineWithDetails,
    errorMessage: msg,
    stepName: 'description-suggestion',
  });

  setError(msg);

  // Return code for caller to decide on abort/continue
  return { blocked: code === 'NO_INDEXED_CONTEXT', code, message: msg };
}

/**
 * Handle web scraping errors consistently
 * @param {HandleWebScrapingErrorParams} params
 * @param {*} params.scrapingError
 * @param {LoggerLike} params.logger
 * @param {(message: string) => void} params.setError
 * @param {string} [params.source='TenantMode']
 * @returns {{blocked: boolean, message: string}}
 */
export function handleWebScrapingError({
  scrapingError,
  logger,
  setError,
  source = 'TenantMode',
}) {
  const msg = 'Nenhuma URL foi raspada com sucesso. Verifique os logs do scraping.';

  logger.error(`[${source}] Erro ao processar web scraping`, scrapingError);
  setError(msg);

  return { blocked: true, message: msg };
}

/**
 * Validate tenant creation response structure
 * @param {TenantGenerationResult} generateResult
 * @param {string} executionMode
 * @returns {{valid: boolean, error?: string}}
 */
export function validateTenantCreationResponse(generateResult, executionMode) {
  if (!generateResult?.tenant) {
    return { valid: false, error: 'A IA não retornou dados válidos' };
  }

  if (executionMode !== 'dry-run') {
    const tenantFromServer =
      generateResult?.createdTenant || generateResult?.existingTenant || null;

    if (!tenantFromServer) {
      return {
        valid: false,
        error:
          'Tenant não foi criado/reutilizado no modo seguro (createdTenant/existingTenant ausente).',
      };
    }

    if (tenantFromServer.status !== 'pending_review') {
      return {
        valid: false,
        error:
          'Tenant existente para este site não está em modo draft (pending_review). Não é seguro continuar.',
      };
    }
  }

  return { valid: true };
}

/**
 * Create dry-run tenant simulation
 * @param {TenantGenerationResult} generateResult
 * @param {string} name
 * @returns {{tenant: Object, dryRun: boolean}}
 */
export function createDryRunTenant(generateResult, name) {
  return {
    tenant: {
      ...(generateResult.tenant || {}),
      name: name.trim() || generateResult?.tenant?.name,
      id: `tenant-dry-run-${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    dryRun: true,
  };
}

/**
 * Create real-mode tenant result
 * @param {TenantGenerationResult} generateResult
 * @returns {{tenant: Object, dryRun: boolean, isExisting: boolean}}
 */
export function createRealTenant(generateResult) {
  const tenantFromServer =
    generateResult?.createdTenant || generateResult?.existingTenant;

  return {
    tenant: tenantFromServer,
    dryRun: false,
    isExisting: !!generateResult?.existingTenant,
  };
}

/**
 * Format partial success message (warnings or RPA failures)
 * @param {ExecutionResponse} response
 * @returns {string|null}
 */
export function formatPartialSuccessMessage(response) {
  if (!response?.success) {
    return null;
  }

  const warnings = Array.isArray(response?.warnings) ? response.warnings : [];

  if (warnings.length > 0 || response?.rpaPassed === false) {
    return warnings.length > 0
      ? `Concluído com avisos (${warnings.length}). Revisão humana recomendada.`
      : 'Concluído, mas o teste RPA não passou. Revisão humana recomendada.';
  }

  return null;
}

/**
 * Build tenant AI description from form inputs
 * @param {string} name
 * @param {string} firstUrl
 * @param {string} finalDescription
 * @returns {string}
 */
export function buildTenantAiDescription(name, firstUrl, finalDescription) {
  const siteHint = firstUrl ? `Site: ${firstUrl.trim()}\n\n` : '';

  return name.trim()
    ? `Nome: ${name.trim()}\n\n${siteHint}${finalDescription}`
    : `${siteHint}${finalDescription}`;
}

/**
 * Build uploaded file status counters for logs and messages
 * @param {UploadedFileLike[]} uploadedFiles
 * @returns {{total: number, pending: number, processing: number, success: number, error: number}}
 */
export function summarizeUploadedFileStatuses(uploadedFiles) {
  const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  return {
    total: files.length,
    pending: files.filter(f => f?.status === 'pending').length,
    processing: files.filter(f => f?.status === 'processing').length,
    success: files.filter(f => f?.status === 'success').length,
    error: files.filter(f => f?.status === 'error').length,
  };
}

/**
 * Return uploaded files currently pending processing
 * @param {UploadedFileLike[]} uploadedFiles
 * @returns {UploadedFileLike[]}
 */
export function getPendingUploadedFiles(uploadedFiles) {
  const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  return files.filter(f => f?.status === 'pending');
}
