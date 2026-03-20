'use strict';

/**
 * Composition root do domínio Tenant.
 *
 * Concentra toda a lógica de montagem do Express router de tenants
 * usando apenas controller/serviço/repositório modulares.
 *
 * Antes: tudo isso estava inline em api/server.js (~60 linhas).
 * Agora: server.js apenas importa e chama `createTenantExpressRouter()`.
 */

const { requireAuth, requirePermission } = require('../../middleware/auth');
const { isSuperAdmin } = require('../../services/superAdminService');
const logger = require('../../utils/logger');
const { logAction } = require('../../services/auditService');
const { generateAiResponse } = require('../../services/aiProviderService');
const { registerGeneration } = require('../../services/auditService');
const { emitEvent } = require('../../services/websocketService');
const {
  getTenant,
  listTenants,
  createTenant,
  updateTenant,
  deleteTenant,
  getTenantUsage,
  getTenantContext,
  updateTenantContext,
  suspendTenant,
  reactivateTenant,
  changePlan,
} = require('../../services/tenantService');
const { getPlanLimits } = require('../../services/planLimitsService');
const tenantAIService = require('../../services/tenantAIService');
const { createTenantRepository } = require('../../modules/tenant/repository');
const { createTenantService } = require('../../modules/tenant/service');
const tenantValidator = require('../../modules/tenant/validator');
const { createTenantController } = require('../../modules/tenant/controller');
const { createTenantRoutes } = require('../../modules/tenant/routes');

/**
 * Cria o Express router completo do domínio Tenant.
 * Usa somente rotas modulares.
 *
 * @returns {express.Router}
 */
function createTenantExpressRouter() {
  const repository = createTenantRepository({
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
  });

  const service = createTenantService({
    repository,
    validator: tenantValidator,
    isSuperAdmin,
    logger,
    logAction,
    generateAiResponse,
    registerGeneration,
    tenantAIService,
  });

  const controller = createTenantController({
    requireAuth,
    requirePermission,
    service,
    emitEvent,
  });

  return createTenantRoutes({
    controller,
  });
}

module.exports = {
  createTenantExpressRouter,
};
