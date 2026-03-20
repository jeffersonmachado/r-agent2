/**
 * Flow Execution Orchestrator
 * Delegates to capability-specific handlers:
 * - Flow Validation (flowValidationRoutes.js)
 * - Flow Generation (flowGenerationRoutes.js)
 * - RPA Test Generation (rpaTestGenerationRoutes.js)
 * - Flow Execution (flowExecutionRoutes.js)
 */

const { handleFlowValidationRoutes } = require('./flow-execution/flowValidationRoutes');
const { handleFlowGenerationRoutes } = require('./flow-execution/flowGenerationRoutes');
const { handleRpaTestGenerationRoutes } = require('./flow-execution/rpaTestGenerationRoutes');
const { handleFlowExecutionRoutes: handleFlowExecution } = require('./flow-execution/flowExecutionRoutes');

async function handleFlowExecutionRoutes(ctx) {
  const { pathname } = ctx;

  if (!pathname.startsWith('/flows') && pathname !== '/rpa-tests' && !pathname.startsWith('/replay/')) {
    return false;
  }

  // Delegate to specific handlers by capability
  if (await handleFlowValidationRoutes(ctx)) return true;
  if (await handleFlowGenerationRoutes(ctx)) return true;
  if (await handleRpaTestGenerationRoutes(ctx)) return true;
  if (await handleFlowExecution(ctx)) return true;

  return false;
}

module.exports = { handleFlowExecutionRoutes };
