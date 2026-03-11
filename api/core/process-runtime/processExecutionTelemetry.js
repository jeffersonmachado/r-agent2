'use strict';

function buildExecutionTelemetry({
  processId,
  processVersion,
  sessionId,
  nodeId,
  startedAt,
  endedAt,
  status,
  error,
  fallbackTriggered,
  handoffTriggered,
  timeoutTriggered,
} = {}) {
  const start = startedAt || new Date().toISOString();
  const end = endedAt || new Date().toISOString();
  const durationMs = Math.max(0, new Date(end).getTime() - new Date(start).getTime());

  return {
    processId: processId || null,
    processVersion: typeof processVersion === 'number' ? processVersion : null,
    sessionId: sessionId || null,
    nodeId: nodeId || null,
    startedAt: start,
    endedAt: end,
    durationMs,
    status: status || 'unknown',
    error: error || null,
    fallbackTriggered: Boolean(fallbackTriggered),
    handoffTriggered: Boolean(handoffTriggered),
    timeoutTriggered: Boolean(timeoutTriggered),
  };
}

module.exports = {
  buildExecutionTelemetry,
};
