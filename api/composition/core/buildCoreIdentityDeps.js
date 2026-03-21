'use strict';

const {
  login: authLogin,
  logout: authLogout,
  logoutAllSessions,
  validateToken,
  loginWithRpaToken,
  createAgent,
  listAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  inviteUser,
  acceptInvitation,
  requestPasswordReset,
  resetPassword,
} = require('../../services/authService');
const { setupMfa, verifyMfa, disableMfa, consumeRecoveryCode } = require('../../services/mfaService');
const { queryLogs, getAuditStats } = require('../../services/auditService');

function buildCoreIdentityDeps() {
  return {
    authLogin,
    loginWithRpaToken,
    validateToken,
    authLogout,
    logoutAllSessions,
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
    queryLogs,
    getAuditStats,
  };
}

module.exports = {
  buildCoreIdentityDeps,
};
