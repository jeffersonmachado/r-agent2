// PBX v1 Orchestrator
// Delegates /api/pbx/* core endpoints to capability-specific handlers.

const { handlePbxExtensionsProvisioningRoutes } = require('../pbx-core/extensionsProvisioningRoutes');
const { handlePbxAccessRoutes } = require('../pbx-core/accessRoutes');
const { handlePbxConfigurationRoutes } = require('../pbx-core/configurationRoutes');
const { handlePbxQueuesRoutes } = require('../pbx-core/queuesRoutes');
const { handlePbxDialplanRoutes } = require('../pbx-core/dialplanRoutes');
const { handlePbxSystemRoutes } = require('../pbx-core/systemRoutes');

async function handlePbxCoreRoutes(ctx) {
  const { pathname } = ctx;

  if (!pathname.startsWith('/api/pbx')) {
    return false;
  }

  if (await handlePbxExtensionsProvisioningRoutes(ctx)) return true;
  if (await handlePbxAccessRoutes(ctx)) return true;
  if (await handlePbxConfigurationRoutes(ctx)) return true;
  if (await handlePbxQueuesRoutes(ctx)) return true;
  if (await handlePbxDialplanRoutes(ctx)) return true;
  if (await handlePbxSystemRoutes(ctx)) return true;

  return false;
}

module.exports = { handlePbxCoreRoutes };
