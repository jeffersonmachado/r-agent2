/**
 * Contrato padrão de erros da API (Error Envelope).
 *
 * Formato:
 * {
 *   success: false,
 *   error: {
 *     code: string,
 *     message: string,
 *     httpStatus: number,
 *     retryable: boolean,
 *     details: any,
 *     traceId: string,
 *     timestamp: string (ISO)
 *   }
 * }
 */

/**
 * @typedef {Object} ApiErrorPayload
 * @property {string} code
 * @property {string} message
 * @property {number} httpStatus
 * @property {boolean} retryable
 * @property {any} details
 * @property {string} traceId
 * @property {string} timestamp
 */

/**
 * @param {Object} params
 * @param {string} params.code
 * @param {string} params.message
 * @param {number} params.httpStatus
 * @param {boolean} [params.retryable=false]
 * @param {any} [params.details=null]
 * @param {import('http').IncomingMessage} [params.req]
 * @returns {{ success: false, error: ApiErrorPayload }}
 */
function buildApiError({ code, message, httpStatus, retryable = false, details = null, req }) {
  const traceId = (req && req.id) ? String(req.id) : null;
  const safeTraceId = traceId && traceId.trim() ? traceId.trim() : 'unknown';
  return {
    success: false,
    error: {
      code: code || 'INTERNAL_ERROR',
      message: message || 'Erro interno',
      httpStatus: Number.isFinite(httpStatus) ? httpStatus : 500,
      retryable: !!retryable,
      details,
      traceId: safeTraceId,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * Envia o envelope para a resposta.
 *
 * @param {import('http').ServerResponse} res
 * @param {{ success: false, error: ApiErrorPayload }} apiError
 * @param {(res: import('http').ServerResponse) => void} setCorsHeaders
 */
function sendApiError(res, apiError, setCorsHeaders) {
  const httpStatus = apiError?.error?.httpStatus || 500;
  const traceId = apiError?.error?.traceId;
  if (typeof setCorsHeaders === 'function') {
    setCorsHeaders(res);
  }
  if (traceId && traceId !== 'unknown') {
    try {
      res.setHeader('X-Request-Id', traceId);
    } catch {
      // ignora
    }
  }
  res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(apiError));
}

module.exports = {
  buildApiError,
  sendApiError,
};

