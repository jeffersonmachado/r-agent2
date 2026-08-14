'use strict';

const { handleAiChatbotOrchestratorRoutes } = require('./handleAiChatbotOrchestratorRoutes');
const { handleAiGenerateRoute } = require('./handleAiGenerateRoute');
const { handleAskAiRoute } = require('./handleAskAiRoute');

module.exports = { handleAiRoutes };

async function handleAiRoutes({ req, res, method, pathname, deps }) {
  if (!pathname.startsWith('/ai/') && !pathname.startsWith('/api/ai/') && pathname !== '/api/ask-ai') return false;
  if (await handleAskAiRoute({ req, res, method, pathname, deps })) return true;
  if (await handleAiChatbotOrchestratorRoutes({ req, res, method, pathname, deps })) return true;
  if (await handleAiGenerateRoute({ req, res, method, pathname, deps })) return true;
  return false;
}
