/**
 * Normalização e tratamento comum de erros da API (Error Envelope).
 */

/**
 * @param {any} err
 * @returns {{
 *   code: string,
 *   message: string,
 *   details: any,
 *   httpStatus?: number,
 *   traceId?: string,
 *   retryable?: boolean
 * }}
 */
export function normalizeApiError(err) {
  const code = err?.code || err?.body?.error?.code || err?.body?.error || 'UNKNOWN_ERROR';
  const message =
    err?.message ||
    err?.body?.error?.message ||
    err?.body?.message ||
    'Erro desconhecido';
  const details = err?.details ?? err?.body?.error?.details ?? err?.body?.details ?? null;
  const httpStatus = err?.httpStatus ?? err?.status ?? err?.body?.error?.httpStatus;
  const traceId = err?.traceId ?? err?.body?.error?.traceId;
  const retryable = err?.retryable ?? err?.body?.error?.retryable;

  return { code: String(code), message: String(message), details, httpStatus, traceId, retryable };
}

/**
 * @param {string} code
 * @returns {{ message: string, type: 'error' | 'warning' | 'info', durationMs: number }}
 */
export function toastForApiErrorCode(code) {
  switch (code) {
    case 'SCRAPE_FAILED':
      return {
        message: 'Falha ao raspar o site. Verifique a URL e tente novamente. Se o site for SPA, habilite o fallback Playwright.',
        type: 'error',
        durationMs: 10000,
      };
    case 'PLAYWRIGHT_FAILED':
      return {
        message: 'Não foi possível extrair conteúdo renderizado (Playwright falhou). Tentamos indexar metadados mínimos.',
        type: 'warning',
        durationMs: 9000,
      };
    case 'PDF_PARSE_FAILED':
      return {
        message: 'Falha ao extrair texto do PDF. O arquivo pode estar protegido ou ser um scan. Tentamos indexar metadados mínimos.',
        type: 'warning',
        durationMs: 9000,
      };
    case 'OCR_FAILED':
      return {
        message: 'Falha ao executar OCR na imagem. Tentamos indexar metadados mínimos.',
        type: 'warning',
        durationMs: 9000,
      };
    case 'RAG_INDEX_FAILED':
      return {
        message: 'Falha ao indexar no RAG. Tente novamente em instantes.',
        type: 'error',
        durationMs: 10000,
      };
    case 'FILE_TOO_LARGE':
      return {
        message: 'Arquivo muito grande. Reduza o tamanho e tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    case 'FILE_UPLOAD_FAILED':
      return {
        message: 'Falha ao processar upload do arquivo. Tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    case 'DESCRIPTION_FAILED':
      return {
        message: 'Falha ao gerar a descrição. Tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    case 'NO_INDEXED_CONTEXT':
      return {
        message: 'Nenhum contexto indexado disponível. Faça upload/raspagem e aguarde a indexação antes de sugerir descrição.',
        type: 'error',
        durationMs: 10000,
      };
    case 'NO_INDEXED_CONTEXT_FALLBACK':
      return {
        message: 'Extração/indexação ainda não gerou contexto suficiente. Usamos um fallback mínimo para a descrição.',
        type: 'warning',
        durationMs: 9000,
      };
    case 'PROVIDER_NOT_AVAILABLE':
      return {
        message: 'Provider de IA não disponível. Verifique as credenciais do tenant e tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    case 'PIPELINE_ABORTED':
      return {
        message: 'Pipeline abortado. Verifique os detalhes do erro e tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    case 'INTERNAL_ERROR':
      return {
        message: 'Erro interno ao processar a solicitação. Tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    default:
      return {
        message: 'Erro ao processar a solicitação.',
        type: 'error',
        durationMs: 8000,
      };
  }
}

/**
 * Handler prático para pipeline + toast.
 *
 * @param {any} err
 * @param {{
 *   showToast?: (message: string, type?: any, durationMs?: number) => void,
 *   updatePipelineWithDetails?: (statusUpdate: any, source?: string) => void,
 *   stepKey?: string,
 *   defaultMessage?: string,
 *   source?: string
 * }} opts
 */
export function handlePipelineApiError(err, opts = {}) {
  const info = normalizeApiError(err);
  const toast = toastForApiErrorCode(info.code);

  // Prioriza mensagem baseada em `code` (contrato), depois fallback do caller.
  const message = toast.message || opts.defaultMessage || info.message;

  if (typeof opts.updatePipelineWithDetails === 'function' && opts.stepKey) {
    opts.updatePipelineWithDetails({
      [opts.stepKey]: {
        status: 'error',
        progress: 0,
        message,
        timestamp: new Date().toISOString(),
        error: {
          code: info.code,
          message: info.message,
          details: info.details,
          httpStatus: info.httpStatus,
          traceId: info.traceId,
          retryable: info.retryable,
        },
      },
    }, opts.source || 'apiErrorHandler');
  }

  if (typeof opts.showToast === 'function') {
    opts.showToast(message, toast.type, toast.durationMs);
  }

  return info;
}

