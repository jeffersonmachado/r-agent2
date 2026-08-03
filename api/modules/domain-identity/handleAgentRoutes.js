const { handleAgentMfaRoutes } = require('./handleAgentMfaRoutes');
const { handleAgentOnboardingRoutes } = require('./handleAgentOnboardingRoutes');
const { handleAgentCrudRoutes } = require('./handleAgentCrudRoutes');

async function handleAgentRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    listAgents,
    createAgent,
    getAgent,
    updateAgent,
    deleteAgent,
    inviteUser,
    acceptInvitation,
    requestPasswordReset,
    resetPassword,
    setupMfa,
    verifyMfa,
    disableMfa,
    consumeRecoveryCode,
    isSuperAdmin,
    logAction,
    logger,
    checkRateLimit,
  } = deps;

  const handledCrud = await handleAgentCrudRoutes({
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      requirePermission,
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      listAgents,
      createAgent,
      getAgent,
      updateAgent,
      deleteAgent,
      isSuperAdmin,
      logAction,
      logger,
    },
  });
  if (handledCrud) {
    return true;
  }

  const handledOnboarding = await handleAgentOnboardingRoutes({
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      requirePermission,
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      inviteUser,
      acceptInvitation,
      requestPasswordReset,
      resetPassword,
      logAction,
      logger,
      checkRateLimit,
    },
  });
  if (handledOnboarding) {
    return true;
  }

  const handledMfa = await handleAgentMfaRoutes({
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      sendJson,
      badRequest,
      hasJsonContentType,
      parseJsonBody,
      setupMfa,
      verifyMfa,
      disableMfa,
      consumeRecoveryCode,
      logger,
    },
  });
  if (handledMfa) {
    return true;
  }

  return false;
}

module.exports = { handleAgentRoutes };
