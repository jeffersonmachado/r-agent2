/**
 * Helper central para emissão de etapas do pipeline.
 * Backend é a única fonte da verdade para feedback visual (toasts) via WS.
 *
 * Payload emitido:
 * - executionId
 * - stage
 * - status: info | success | warning | error | running
 * - message
 * - meta (opcional)
 * - ts (epoch ms)
 */

function emitPipelineStage(ws, executionId, payload) {
  if (!ws || typeof ws.to !== 'function') return;
  const execId = (executionId && String(executionId).trim()) ? String(executionId).trim() : null;
  if (!execId) return;

  const stage = (payload?.stage && String(payload.stage).trim()) ? String(payload.stage).trim() : 'unknown';
  const status = (payload?.status && String(payload.status).trim())
    ? String(payload.status).trim()
    : 'info';
  const message = (payload?.message && String(payload.message).trim())
    ? String(payload.message).trim()
    : '';
  const meta = (payload && Object.prototype.hasOwnProperty.call(payload, 'meta')) ? payload.meta : null;

  ws.to(execId).emit('generation.stage', {
    executionId: execId,
    stage,
    status, // info | success | warning | error | running
    message,
    meta: meta || null,
    ts: Date.now(),
  });
}

module.exports = { emitPipelineStage };

