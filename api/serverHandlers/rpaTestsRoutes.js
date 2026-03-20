const { handleRpaRecordingsRoutes } = require('./rpa-tests/rpaRecordingsRoutes');
const { handleRpaExecutionRoutes } = require('./rpa-tests/rpaExecutionRoutes');
const { handleRpaReplayRoutes } = require('./rpa-tests/rpaReplayRoutes');

async function handleRpaTestsRoutes(ctx) {
  const { pathname } = ctx;

  const isRpaRoute = pathname.startsWith('/rpa/') || pathname.startsWith('/tests/rpa/');
  if (!isRpaRoute) {
    return false;
  }

  if (await handleRpaRecordingsRoutes(ctx)) return true;
  if (await handleRpaExecutionRoutes(ctx)) return true;
  if (await handleRpaReplayRoutes(ctx)) return true;

  return false;
}

module.exports = { handleRpaTestsRoutes };
