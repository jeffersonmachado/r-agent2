function createTenantRepository({
  getTenant,
  listTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  getTenantUsage,
  getPlanLimits,
  getTenantContext,
  updateTenantContext,
  suspendTenant,
  reactivateTenant,
  changePlan,
  tenantAIService,
}) {
  return {
    async getTenantById(tenantId) {
      return getTenant(tenantId);
    },

    async listTenants() {
      return listTenants();
    },

    async createTenant(payload) {
      return createTenant(payload);
    },

    async updateTenant(tenantId, payload) {
      return updateTenant(tenantId, payload);
    },

    async deleteTenant(tenantId) {
      return deleteTenant(tenantId);
    },

    async getUsageByTenantId(tenantId) {
      return getTenantUsage(tenantId);
    },

    getPlanLimits(plan) {
      return getPlanLimits(plan);
    },

    getContextByTenantId(tenantId) {
      return getTenantContext(tenantId);
    },

    async updateContextByTenantId(tenantId, payload, options) {
      return updateTenantContext(tenantId, payload, options);
    },

    async suspendTenant(tenantId) {
      return suspendTenant(tenantId);
    },

    async reactivateTenant(tenantId) {
      return reactivateTenant(tenantId);
    },

    async changePlan(tenantId, plan) {
      return changePlan(tenantId, plan);
    },

    getTenantAiConfig(tenantId) {
      return tenantAIService.getAIConfig(tenantId);
    },

    saveTenantAiConfig(tenantId, payload) {
      return tenantAIService.saveAIConfig(tenantId, payload);
    },

    saveTenantAiCredentials(tenantId, provider, apiKey) {
      return tenantAIService.saveAICredentials(tenantId, provider, apiKey);
    },

    getTenantAiApiKey(tenantId, provider) {
      return tenantAIService.getDecryptedAPIKey(tenantId, provider);
    },
  };
}

module.exports = {
  createTenantRepository,
};
