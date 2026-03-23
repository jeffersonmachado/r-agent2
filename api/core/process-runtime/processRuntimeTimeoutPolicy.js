'use strict';

function getNodeTimeoutMs(node, compiledProcess) {
  const nodeTimeout = node?.timeoutPolicy;
  if (nodeTimeout?.enabled === true && Number(nodeTimeout.timeoutMs) > 0) {
    return Number(nodeTimeout.timeoutMs);
  }
  const processTimeout = compiledProcess?.policies?.timeout;
  if (processTimeout?.enabled === true && Number(processTimeout.timeoutMs) > 0) {
    return Number(processTimeout.timeoutMs);
  }
  return 0;
}

async function executeWithTimeout({ timeoutMs, nodeId, execute }) {
  if (!timeoutMs) {
    return execute();
  }

  let timeoutId = null;
  try {
    return await Promise.race([
      execute(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`node_timeout:${nodeId}`);
          error.code = 'NODE_TIMEOUT';
          error.timeoutMs = timeoutMs;
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

module.exports = {
  getNodeTimeoutMs,
  executeWithTimeout,
};