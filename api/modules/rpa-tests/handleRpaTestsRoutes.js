const { handleRpaRecordingsRoutes } = require('./handleRpaRecordingsRoutes');
const { handleRpaExecutionRoutes } = require('./handleRpaExecutionRoutes');

async function handleRpaTestsRoutes(ctx) {
  const { pathname } = ctx;

  const isRpaRoute = pathname.startsWith('/rpa/');
  if (!isRpaRoute) {
    return false;
  }

  if (await handleRpaRecordingsRoutes(ctx)) return true;
  if (await handleRpaExecutionRoutes(ctx)) return true;

  return false;
}

module.exports = { handleRpaTestsRoutes };
