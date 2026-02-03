function extractExecutionId(body) {
  const raw = body?.executionId;
  const executionId = (raw && String(raw).trim()) ? String(raw).trim() : null;
  return executionId;
}

function isValidExecutionId(executionId) {
  if (!executionId || typeof executionId !== 'string') return false;
  const id = executionId.trim();
  return !!(id && id.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(id));
}

/**
 * Middleware-like helper (para o router manual do server.js).
 * Retorna executionId válido ou envia 400 e retorna null.
 */
function requireExecutionId(body, res, badRequest) {
  const executionId = extractExecutionId(body);
  if (!executionId) {
    badRequest(res, 'executionId é obrigatório');
    return null;
  }
  if (!isValidExecutionId(executionId)) {
    badRequest(res, 'executionId inválido');
    return null;
  }
  return executionId;
}

module.exports = {
  extractExecutionId,
  isValidExecutionId,
  requireExecutionId,
};

