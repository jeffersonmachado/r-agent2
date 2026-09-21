const { validateInput, schemas } = require('../../utils/inputValidator');
const { generateTenantByAi, getTenantAiProviderStatus, validateProviderCredentials, fetchProviderBalance } = require('./aiWorkflows');
const aiProviderRegistryService = require('../../services/aiProviderRegistryService');

function createHttpError(message, httpStatus, code, payload) {
  const error = new Error(message);
  error.httpStatus = httpStatus;
  error.code = code;
  if (payload !== undefined) {
    error.payload = payload;
  }
  return error;
}

function assertRepositorySuccess(result, fallbackError) {
  if (result?.success) {
    return result;
  }

  throw createHttpError(result?.error || fallbackError, 400, 'bad_request');
}

function createTenantService({
  repository,
  validator,
  isSuperAdmin,
  logger,
  logAction,
  generateAiResponse,
  registerGeneration,
  tenantAIService,
}) {
  return {
    async createTenant({ payload, agent, requestMeta }) {
      validator.validateSuperAdminAccess({
        isSuperAdmin: isSuperAdmin(agent),
        message: 'Apenas super-admins podem criar tenants',
      });

      const sanitizedPayload = validateInput(payload, schemas.createTenant);
      const result = await repository.createTenant(sanitizedPayload);
      const created = assertRepositorySuccess(result, 'Erro ao criar tenant');

      if (logAction && agent?.id) {
        logAction({
          agentId: agent.id,
          username: agent.username,
          action: 'tenant_create',
          resource: 'tenant',
          resourceId: created.tenant.id,
          details: { tenantName: created.tenant.name },
          tenantId: requestMeta?.tenantId || null,
          ipAddress: requestMeta?.ipAddress || 'unknown',
          userAgent: requestMeta?.userAgent || 'unknown',
        });
      }

      return { tenant: created.tenant, httpStatus: 201 };
    },

    async listTenants({ agent }) {
      validator.validateSuperAdminAccess({
        isSuperAdmin: isSuperAdmin(agent),
        message: 'Apenas super-admins podem listar tenants',
      });

      const tenants = await repository.listTenants();
      return { tenants };
    },

    async getTenant({ tenantIdParam, agent }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateTenantReadAccess({ tenantId, agent, isSuperAdmin: isSuperAdmin(agent) });

      const tenant = await repository.getTenantById(tenantId);
      if (!tenant) {
        const error = new Error('Tenant não encontrado');
        error.httpStatus = 404;
        error.code = 'tenant_not_found';
        throw error;
      }

      return { tenant };
    },

    async getTenantContext({ tenantIdParam, agent }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateTenantReadAccess({ tenantId, agent, isSuperAdmin: isSuperAdmin(agent) });

      const tenant = await repository.getTenantById(tenantId);
      if (!tenant) {
        const error = new Error('Tenant não encontrado');
        error.httpStatus = 404;
        error.code = 'tenant_not_found';
        throw error;
      }

      const context = repository.getContextByTenantId(tenantId);
      if (!context) {
        const error = new Error('Contexto do tenant não encontrado');
        error.httpStatus = 404;
        error.code = 'tenant_context_not_found';
        throw error;
      }

      return { context };
    },

    async updateTenant({ tenantIdParam, payload, agent, requestMeta }) {
      validator.validateSuperAdminAccess({
        isSuperAdmin: isSuperAdmin(agent),
        message: 'Apenas super-admins podem atualizar tenants',
      });

      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      const tenant = await repository.getTenantById(tenantId);
      if (!tenant) {
        throw createHttpError('Tenant não encontrado', 404, 'tenant_not_found');
      }

      const sanitizedPayload = validateInput(payload, schemas.updateTenant);
      const updated = assertRepositorySuccess(
        await repository.updateTenant(tenantId, sanitizedPayload),
        'Erro ao atualizar tenant',
      );

      if (logAction && agent?.id) {
        logAction({
          agentId: agent.id,
          username: agent.username,
          action: 'tenant_update',
          resource: 'tenant',
          resourceId: tenantId,
          details: { updatedFields: Object.keys(sanitizedPayload) },
          tenantId: requestMeta?.tenantId || null,
          ipAddress: requestMeta?.ipAddress || 'unknown',
          userAgent: requestMeta?.userAgent || 'unknown',
        });
      }

      return { tenant: updated.tenant };
    },

    async deleteTenant({ tenantIdParam, agent }) {
      validator.validateSuperAdminAccess({
        isSuperAdmin: isSuperAdmin(agent),
        message: 'Apenas super-admins podem remover tenants',
      });

      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      const tenant = await repository.getTenantById(tenantId);
      if (!tenant) {
        throw createHttpError('Tenant não encontrado', 404, 'tenant_not_found');
      }

      assertRepositorySuccess(await repository.deleteTenant(tenantId), 'Erro ao remover tenant');
      return { success: true, message: 'Tenant removido com sucesso' };
    },

    async getTenantUsage({ tenantIdParam, agent }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateTenantUsageAccess({ tenantId, agent, isSuperAdmin: isSuperAdmin(agent) });

      const usage = await repository.getUsageByTenantId(tenantId);
      if (!usage) {
        throw createHttpError('Tenant não encontrado', 404, 'tenant_not_found');
      }

      return { usage };
    },

    async updateTenantContext({ tenantIdParam, payload, agent, requestMeta }) {
      validator.validateSuperAdminAccess({
        isSuperAdmin: isSuperAdmin(agent),
        message: 'Apenas super-admins podem atualizar contextos de tenants',
      });

      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      const tenant = await repository.getTenantById(tenantId);
      if (!tenant) {
        throw createHttpError('Tenant não encontrado', 404, 'tenant_not_found');
      }

      const sanitizedPayload = validateInput(payload, schemas.updateTenantContext);
      const result = assertRepositorySuccess(
        await repository.updateContextByTenantId(tenantId, sanitizedPayload, {
          userRole: agent.role,
          userId: agent.id,
          username: agent.username,
        }),
        'Erro ao atualizar tenant context',
      );

      if (logAction && agent?.id) {
        logAction({
          agentId: agent.id,
          username: agent.username,
          action: 'tenant_context_update',
          resource: 'tenant_context',
          resourceId: tenantId,
          details: { updatedFields: Object.keys(sanitizedPayload) },
          tenantId: requestMeta?.tenantId || null,
          ipAddress: requestMeta?.ipAddress || 'unknown',
          userAgent: requestMeta?.userAgent || 'unknown',
        });
      }

      return { context: result.context };
    },

    async getPlanUsage({ tenantIdParam, agent }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validatePlanUsageAccess({ agent, isSuperAdmin: isSuperAdmin(agent) });

      const tenant = await repository.getTenantById(tenantId);
      if (!tenant) {
        const error = new Error('Tenant não encontrado');
        error.httpStatus = 404;
        error.code = 'tenant_not_found';
        throw error;
      }

      const usage = await repository.getUsageByTenantId(tenantId);
      const limits = tenant.limits || repository.getPlanLimits(tenant.plan);

      return {
        tenantId,
        plan: tenant.plan || 'trial',
        limits,
        usage,
      };
    },

    async suspendTenant({ tenantIdParam, agent, requestMeta }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateOwnerOrAdminAccess({
        agent,
        message: 'Apenas owner ou admin podem suspender tenants',
      });
      validator.validateOwnerScope({
        tenantId,
        agent,
        message: 'Você só pode suspender seu próprio tenant',
      });

      const result = assertRepositorySuccess(await repository.suspendTenant(tenantId), 'Erro ao suspender tenant');
      if (logAction && agent?.id) {
        logAction({
          agentId: agent.id,
          username: agent.username,
          action: 'tenant_suspend',
          resource: 'tenant',
          resourceId: tenantId,
          tenantId,
          ipAddress: requestMeta?.ipAddress || 'unknown',
          userAgent: requestMeta?.userAgent || 'unknown',
        });
      }

      return { tenant: result.tenant };
    },

    async reactivateTenant({ tenantIdParam, agent, requestMeta }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateOwnerOrAdminAccess({
        agent,
        message: 'Apenas owner ou admin podem reativar tenants',
      });

      const result = assertRepositorySuccess(await repository.reactivateTenant(tenantId), 'Erro ao reativar tenant');
      if (logAction && agent?.id) {
        logAction({
          agentId: agent.id,
          username: agent.username,
          action: 'tenant_reactivate',
          resource: 'tenant',
          resourceId: tenantId,
          tenantId,
          ipAddress: requestMeta?.ipAddress || 'unknown',
          userAgent: requestMeta?.userAgent || 'unknown',
        });
      }

      return { tenant: result.tenant };
    },

    async changePlan({ tenantIdParam, payload, agent, requestMeta }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateOwnerOrAdminAccess({
        agent,
        message: 'Apenas owner ou admin podem mudar plano',
      });

      if (!payload?.plan) {
        throw createHttpError('Campo "plan" é obrigatório', 400, 'bad_request');
      }

      const result = assertRepositorySuccess(await repository.changePlan(tenantId, payload.plan), 'Erro ao mudar plano');
      if (logAction && agent?.id) {
        logAction({
          agentId: agent.id,
          username: agent.username,
          action: 'tenant_change_plan',
          resource: 'tenant',
          resourceId: tenantId,
          tenantId,
          details: { newPlan: payload.plan },
          ipAddress: requestMeta?.ipAddress || 'unknown',
          userAgent: requestMeta?.userAgent || 'unknown',
        });
      }

      return { tenant: result.tenant };
    },

    async generateByAi({ payload, agent, headers }) {
      validator.validateSuperAdminAccess({
        isSuperAdmin: isSuperAdmin(agent),
        message: 'Apenas super-admins podem gerar tenants por IA',
      });

      if (!payload?.description || typeof payload.description !== 'string' || payload.description.trim().length === 0) {
        throw createHttpError('Descrição é obrigatória', 400, 'bad_request');
      }

      return generateTenantByAi({
        description: payload.description,
        create: payload.create === true,
        agent,
        headers,
        logger,
        generateAiResponse,
        registerGeneration,
        createTenant: repository.createTenant,
      });
    },

    async getAiProviderStatus({ tenantIdParam, agent }) {
      const tenantId = tenantIdParam;
      validator.validateTenantReadAccess({
        tenantId,
        agent,
        isSuperAdmin: isSuperAdmin(agent),
      });

      return getTenantAiProviderStatus({
        tenantId,
        tenantAIService,
      });
    },

    async getAiConfig({ tenantIdParam, agent }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateTenantReadAccess({
        tenantId,
        agent,
        isSuperAdmin: isSuperAdmin(agent),
      });

      const tenantAiConfig = await repository.getTenantAiConfig(tenantId);
      if (tenantAiConfig === null) {
        throw createHttpError('Tenant não encontrado', 404, 'not_found');
      }

      return { tenantId, ...tenantAiConfig };
    },

    async updateCurrentTenantAiConfig({ payload, agent, canUpdateConfig }) {
      const tenantId = validator.resolveAuthenticatedTenantId(agent);
      if (!canUpdateConfig && !isSuperAdmin(agent)) {
        throw createHttpError('Permissão insuficiente para alterar configurações de IA', 403, 'forbidden');
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw createHttpError('Configuração deve ser um objeto JSON válido', 400, 'bad_request');
      }

      return repository.saveTenantAiConfig(tenantId, payload);
    },

    async saveCurrentTenantAiCredentials({ payload, agent, canUpdateConfig }) {
      const tenantId = validator.resolveAuthenticatedTenantId(agent);
      if (!canUpdateConfig && !isSuperAdmin(agent)) {
        throw createHttpError('Permissão insuficiente para alterar credenciais de IA', 403, 'forbidden');
      }

      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw createHttpError('Body deve ser um objeto JSON válido', 400, 'invalid_request');
      }

      const provider = typeof payload.provider === 'string' ? payload.provider.trim().toLowerCase() : null;
      const apiKey = payload.apiKey;

      if (!provider || typeof provider !== 'string') {
        throw createHttpError('Provider é obrigatório', 400, 'invalid_request');
      }

      const supported = await aiProviderRegistryService.isSupportedProvider(provider);
      if (!supported) {
        const ids = await aiProviderRegistryService.getProviderIds();
        throw createHttpError(`Provider inválido. Suportados: ${ids.join(', ')}`, 400, 'invalid_request');
      }

      if (!apiKey || typeof apiKey !== 'string') {
        throw createHttpError('API key é obrigatória', 400, 'invalid_request');
      }

      await repository.saveTenantAiCredentials(tenantId, provider, apiKey);
      return { success: true, message: 'Credenciais salvas com sucesso' };
    },

    async testTenantAiCredentials({ tenantIdParam, payload, agent, headers, emitEvent }) {
      const tenantId = validator.resolvePlanUsageTenantId({ tenantIdParam, agent });
      validator.validateTenantReadAccess({
        tenantId,
        agent,
        isSuperAdmin: isSuperAdmin(agent),
      });

      const providerOverride = payload && typeof payload.provider === 'string'
        ? payload.provider.trim().toLowerCase()
        : null;

      const aiCfg = await repository.getTenantAiConfig(tenantId);
      if (aiCfg === null) {
        throw createHttpError('Tenant não encontrado', 404, 'not_found');
      }

      const configuredPrimary = aiCfg?.primary || aiCfg?.provider || null;
      const providerToTest = providerOverride || configuredPrimary;
      if (!providerToTest) {
        return {
          success: true,
          valid: false,
          provider: null,
          tenantId,
          error: 'Provider primário não configurado para o tenant',
        };
      }

      const apiKey = await repository.getTenantAiApiKey(tenantId, providerToTest);
      if (!apiKey || !String(apiKey).trim()) {
        return {
          success: true,
          valid: false,
          provider: providerToTest,
          tenantId,
          error: `Credencial não configurada para o provider ${providerToTest}`,
        };
      }

      const validation = await validateProviderCredentials(providerToTest, apiKey);
      const isValid = validation.valid;
      const error = validation.error;
      // Saldo real só é buscado quando a chave é válida e o provider expõe uma API de billing
      // consultável com a mesma chave (hoje só DeepSeek) — best-effort, nunca lança.
      const balance = isValid ? await fetchProviderBalance(providerToTest, apiKey) : null;

      // Registra o resultado na credencial JÁ SALVA — nunca a apaga quando o teste falha (ex.:
      // sem saldo). É essa persistência que faz o badge de status sobreviver a um reload da
      // página e a um restart do processo, em vez de depender só do estado efêmero da tela.
      await tenantAIService.recordCredentialTestResult(tenantId, providerToTest, {
        status: validation.status || (isValid ? 'valid' : 'error'),
        lastError: error || null,
        balance,
      });

      try {
        const executionIdHeader = (headers && (headers['x-execution-id'] || headers['x-pipeline-execution-id'])) || null;
        const executionId = (typeof executionIdHeader === 'string' && executionIdHeader.trim())
          ? executionIdHeader.trim()
          : null;
        const isValidExecutionId = !!(executionId && executionId.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(executionId));
        if (isValidExecutionId && isValid === true && emitEvent) {
          emitEvent('pipeline.status', {
            executionId,
            status: 'running',
            stages: { providerValidated: true },
            metadata: { message: 'Provider de IA validado', source: '/tenants/current/ai-credentials/test', provider: providerToTest },
          }, { tenantId });
        }
      } catch {}

      return {
        success: true,
        valid: isValid === true,
        provider: providerToTest,
        tenantId,
        error: error || null,
        status: validation.status || null,
        balance,
      };
    },
  };
}

module.exports = {
  createTenantService,
};
