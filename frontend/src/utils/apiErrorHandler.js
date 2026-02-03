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
    case 'PROVIDER_QUOTA_EXCEEDED':
      return {
        message: 'Cota do provider de IA excedida. Verifique billing/plano e credenciais do tenant e tente novamente.',
        type: 'error',
        durationMs: 12000,
      };
    case 'RATE_LIMIT_EXCEEDED':
      return {
        message: 'Rate limit excedido no provider de IA. Aguarde alguns segundos e tente novamente.',
        type: 'warning',
        durationMs: 10000,
      };
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
        message: 'Falha ao indexar documento. Ver detalhes.',
        type: 'error',
        durationMs: 10000,
      };
    case 'EMBEDDING_DIM_MISMATCH':
      return {
        message: 'Configuração inválida: dimensão do embedding não confere. Verifique `EMBEDDING_DIM` e reindexe o tenant.',
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
    case 'SEMANTIC_CLEAN_FAILED':
      return {
        message: 'Falha ao limpar/normalizar o contexto (OCR/artefatos). Verifique as evidências e tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    case 'RAG_CONTEXT_FAILED':
      return {
        message: 'Falha ao recuperar contexto do RAG/Redis. Verifique se há evidências indexadas e tente novamente.',
        type: 'error',
        durationMs: 10000,
      };
    case 'QUESTION_GENERATION_FAILED':
      return {
        message: 'Falha ao gerar perguntas a partir do contexto. Verifique as evidências e tente novamente.',
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
    case 'PIPELINE_ABSTAINED':
      return {
        message: 'Evidência insuficiente para continuar (pipeline absteve). Verifique as evidências retornadas pelo RAG.',
        type: 'warning',
        durationMs: 12000,
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
  let message = toast.message || opts.defaultMessage || info.message;
  // Personaliza com detalhes do contrato quando disponível
  if (info.code === 'RATE_LIMIT_EXCEEDED') {
    const retryAfter = Number(info?.details?.retryAfter);
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      message = `Rate limit excedido no provider de IA. Tente novamente em ${retryAfter}s.`;
    }
  } else if (info.code === 'PROVIDER_QUOTA_EXCEEDED') {
    const tenantId = info?.details?.tenantId ? String(info.details.tenantId) : null;
    if (tenantId) {
      message = `Cota do provider de IA excedida para o tenant "${tenantId}". Verifique billing/plano e credenciais e tente novamente.`;
    }
  }

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

