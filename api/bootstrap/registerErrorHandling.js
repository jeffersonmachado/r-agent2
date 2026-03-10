'use strict';

function buildRequestErrorBoundary({
  requestHandler,
  logger,
  buildApiError,
  sendApiError,
  setCorsHeaders,
  sendJson,
}) {
  if (typeof requestHandler !== 'function') {
    throw new Error('requestHandler is required');
  }

  return (req, res) => {
    requestHandler(req, res).catch((err) => {
      logger.error('Erro inesperado ao processar requisição', err);
      try {
        sendApiError(res, buildApiError({
          code: 'INTERNAL_ERROR',
          message: 'Erro interno',
          httpStatus: 500,
          retryable: false,
          details: { message: err?.message },
          req,
        }), setCorsHeaders);
      } catch (_) {
        sendJson(res, 500, { error: 'internal_error' });
      }
    });
  };
}

module.exports = {
  buildRequestErrorBoundary,
};
