'use strict';

const {
  createTenant,
  updateTenant,
  listTenants,
  getTenant,
  deleteTenant,
  suspendTenant,
  reactivateTenant,
  changePlan,
  getTenantUsage,
  getTenantContext,
  updateTenantContext,
} = require('../../services/tenantService');
const {
  listAllTenants,
  getTenantMetrics,
  impersonateUser,
  blockTenant,
  unblockTenant,
  adjustTenantPlan,
} = require('../../services/superAdminService');
const {
  getOnboardingStatus,
  completeOnboardingStep,
  startOnboarding,
  createInitialTemplates,
  completeOnboarding,
} = require('../../services/onboardingService');
const { generateAndValidate } = require('../../services/generate-and-validate');

function buildCoreAdminDeps() {
  return {
    createTenant,
    getTenant,
    updateTenant,
    deleteTenant,
    listTenants,
    getTenantContext,
    updateTenantContext,
    getTenantUsage,
    suspendTenant,
    reactivateTenant,
    changePlan,
    generateAndValidate,
    listAllTenants,
    getTenantMetrics,
    impersonateUser,
    blockTenant,
    unblockTenant,
    adjustTenantPlan,
    getOnboardingStatus,
    startOnboarding,
    completeOnboardingStep,
    completeOnboarding,
    createInitialTemplates,
  };
}

module.exports = {
  buildCoreAdminDeps,
};
