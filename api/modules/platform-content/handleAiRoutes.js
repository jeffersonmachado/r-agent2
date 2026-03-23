'use strict';

const { handleAiChatbotOrchestratorRoutes } = require('./handleAiChatbotOrchestratorRoutes');
const { handleAiGenerateRoute } = require('./handleAiGenerateRoute');

module.exports = { handleAiRoutes };

async function handleAiRoutes({ req, res, method, pathname, deps }) {
  if (!pathname.startsWith('/ai/') && !pathname.startsWith('/api/ai/')) return false;
  if (await handleAiChatbotOrchestratorRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleAiGenerateRoute({ req, res, method, pathname, deps })) return true;
  return false;
}
