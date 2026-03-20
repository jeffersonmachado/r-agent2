const { handleConfigCoreRoutes } = require('./config/configCoreRoutes');
const { handleConfigContractsRoutes } = require('./config/contractsRoutes');
const { handleConfigTenantAiRoutes } = require('./config/tenantAiRoutes');
const { handleConfigValidationRoutes } = require('./config/configValidationRoutes');

async function handleConfigRoutes(ctx) {
  const { pathname } = ctx;

  const isConfigRoute =
    pathname === '/config' ||
    pathname === '/server/process-manager' ||
    pathname === '/server/restart' ||
    pathname === '/contracts/rag/question-generation.rules.json' ||
    pathname === '/api/data/rag_question_generation_rules.json' ||
    pathname === '/tenants/current/ai-config' ||
    pathname === '/tenants/current/ai-credentials' ||
    pathname === '/config/validate-provider-token' ||
    pathname === '/config/validate-redis' ||
    /^\/tenants\/([^\/]+)\/ai-credentials\/test$/.test(pathname);

  if (!isConfigRoute) {
    return false;
  }

  if (await handleConfigContractsRoutes(ctx)) return true;
  if (await handleConfigTenantAiRoutes(ctx)) return true;
  if (await handleConfigValidationRoutes(ctx)) return true;
  if (await handleConfigCoreRoutes(ctx)) return true;

  return false;
}

module.exports = { handleConfigRoutes };
