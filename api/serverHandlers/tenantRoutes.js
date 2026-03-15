async function handleTenantRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    isSuperAdmin,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
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
    generateAiResponse,
    registerGeneration,
  } = deps;

  if (!pathname.startsWith('/tenants') && pathname !== '/tenants') {
    return false;
  }

  // POST /tenants - Cria novo tenant (requer autenticação admin)
  if (method === 'POST' && pathname === '/tenants') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Apenas super-admin pode criar tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem criar tenants' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);

      // Valida entrada usando schema
      const { validateInput, schemas } = require('../utils/inputValidator');
      try {
        validateInput(body, schemas.createTenant);
      } catch (validationError) {
        badRequest(res, validationError.message || 'Dados inválidos');
        return true;
      }

      const result = createTenant(body);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'tenant_create',
        resource: 'tenant',
        resourceId: result.tenant.id,
        details: { tenantName: result.tenant.name },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // POST /tenants/generate-by-ai - Gera tenant por IA
  if (method === 'POST' && pathname === '/tenants/generate-by-ai') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Apenas super-admin pode gerar tenants por IA
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem gerar tenants por IA' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { description, create = false } = body;

      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        badRequest(res, 'Descrição é obrigatória');
        return true;
      }

      // Usa tenant 'system' para geração por IA
      const systemTenantId = 'system';

      // Prompt para gerar dados do tenant
      const prompt = `Você é um assistente especializado em criar perfis de tenants para uma plataforma SaaS de automação com IA.

Com base na seguinte descrição, gere um JSON válido com os dados do tenant:

Descrição: ${description}

Gere um JSON com a seguinte estrutura:
{
  "name": "Nome do Tenant",
  "site": "https://exemplo.com",
  "ramo_atividade": "Descrição detalhada do ramo de atividade (2-3 frases)",
  "objetivo": "Objetivo estratégico do tenant com a plataforma (2-3 frases)"
}

Regras:
- O nome deve ser claro e profissional
- O site deve ser uma URL válida (use https://exemplo.com se não houver site específico)
- O ramo_atividade deve descrever o segmento de negócio de forma detalhada
- O objetivo deve explicar como o tenant pretende usar a plataforma

Retorne APENAS o JSON, sem markdown, sem explicações adicionais.`;

      logger.info('[Tenants] Gerando tenant por IA', { description: description.substring(0, 100) });

      const aiResult = await generateAiResponse(prompt, systemTenantId, {});
      const aiText = aiResult.text || '';

      // Tenta extrair JSON da resposta da IA
      let tenantData;
      try {
        // Remove markdown code blocks se existirem
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          tenantData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('JSON não encontrado na resposta');
        }
      } catch (parseError) {
        logger.error('[Tenants] Erro ao parsear resposta da IA', {
          aiText,
          error: parseError.message,
        });
        sendJson(res, 500, {
          error: 'Erro ao processar resposta da IA',
          details: 'A IA não retornou um JSON válido. Tente novamente com uma descrição mais detalhada.',
        });
        return true;
      }

      // Valida dados gerados
      if (!tenantData.name || !tenantData.ramo_atividade || !tenantData.objetivo) {
        sendJson(res, 500, {
          error: 'Dados incompletos',
          details: 'A IA não gerou todos os campos necessários. Tente novamente.',
        });
        return true;
      }

      // Garante que o site existe
      if (!tenantData.site) {
        tenantData.site = 'https://exemplo.com';
      }

      // ----------------------------
      // Safe-mode + contrato + semântica (obrigatório)
      // ----------------------------
      const { buildAiEnvelope, validateAiEnvelopeOrThrow } = require('../../engine/ai/aiEnvelope');
      const fs = require('fs');
      const path = require('path');
      const contractsDir = path.join(__dirname, '..', '..', 'contracts');
      const tenantContractPath = path.join(contractsDir, 'tenant.contract.json');
      const tenantContract = JSON.parse(fs.readFileSync(tenantContractPath, 'utf8'));
      const { slugifyTenantKey, createTenantAiDraft } = require('../services/tenantAiDraft');

      async function ensureUniqueTenantKey(baseKey) {
        const { getSequelize } = require('../db/sequelize');
        const sequelize = getSequelize();
        if (!sequelize) return baseKey;
        const { Tenant } = require('../db/models');
        const TenantModel = Tenant();
        let key = baseKey;
        for (let i = 0; i < 10; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          const existing = await TenantModel.findOne({ where: { tenant_key: key } });
          if (!existing) return key;
          key = `${baseKey}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 50);
        }
        return null;
      }

      const baseTenantKey = slugifyTenantKey(tenantData.name);
      const uniqueTenantKey = await ensureUniqueTenantKey(baseTenantKey);
      if (!uniqueTenantKey) {
        sendJson(res, 409, { error: 'tenant_key_conflict', message: 'Não foi possível gerar tenant_key único' });
        return true;
      }

      const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim())
        ? String(req.headers['x-request-id']).trim()
        : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const draftRes = createTenantAiDraft(tenantData, {
        tenantContractPath: 'contracts/tenant.contract.json',
        tenant_key: uniqueTenantKey,
      });

      const tenantDraft = draftRes.tenantDraft;

      const aiMeta = {
        provider: { name: null, model: null, temperature: null },
        input: {
          prompt_summary: 'tenants.generate-by-ai',
          user_goal: description,
          context: { tenantId: 'system' },
        },
        audit: {
          request_id: requestId,
          seed: null,
          tenant_id: 'system',
          user_id: req.agent?.id || req.agent?.username || null,
        },
        rawModelOutput: aiText,
      };

      const envelope = validateAiEnvelopeOrThrow(buildAiEnvelope('tenant', tenantDraft, {
        valid: draftRes.valid === true,
        errors: draftRes.errors || [],
        warnings: draftRes.warnings || [],
        qualityScore: draftRes.qualityScore ?? (draftRes.valid ? 100 : 0),
        riskFlags: draftRes.riskFlags || [],
      }, aiMeta));

      if (!draftRes.valid) {
        // Persistência/auditoria best-effort (falha)
        try {
          const { appendGeneration } = require('../../qa/aiGenerationStore');
          appendGeneration({
            envelope,
            valid: false,
            domain: 'tenant',
            requestId,
          });
        } catch (e) {
          // best-effort
        }
        try {
          const { logFailure } = require('../../engine/ai/aiTelemetry');
          logFailure({
            domain: 'tenant',
            requestId,
            promptUsed: 'tenants.generate-by-ai',
            stage: 'TENANT_DRAFT_INVALID',
            errors: draftRes.errors || [],
          });
        } catch (_) {}

        // Auditoria (DB) best-effort
        try {
          await registerGeneration({
            tenantId: 'system',
            payload: { description, createRequested: !!create },
            context: { sources: [] },
            artifacts: { tenantKey: tenantDraft?.tenant_key || null },
            contract: { version: tenantContract?.version || '1.0.0', hash: null },
            envelope,
            error: { type: 'TENANT_DRAFT_INVALID', errors: draftRes.errors || [] },
          });
        } catch (_) {}

        sendJson(res, 400, { envelope, error: { code: 'tenant_ai_validation_failed', message: 'Tenant gerado não passou por contrato/semântica/safe-mode', details: draftRes.errors } });
        return true;
      }

      logger.info('[Tenants] Tenant gerado por IA com sucesso', {
        name: tenantDraft.name,
        site: tenantDraft.site,
        tenant_key: tenantDraft.tenant_key,
        createRequested: !!create,
      });

      // Persistência/auditoria best-effort do envelope completo
      let aiAuditId = null;
      try {
        const { appendGeneration } = require('../../qa/aiGenerationStore');
        aiAuditId = appendGeneration({ envelope, valid: true, domain: 'tenant', requestId });
      } catch (e) {
        // best-effort
      }

      try {
        const { logSuccess } = require('../../engine/ai/aiTelemetry');
        logSuccess({
          domain: 'tenant',
          requestId,
          promptUsed: 'tenants.generate-by-ai',
          qualityScore: envelope?.validation?.qualityScore ?? null,
          riskFlags: envelope?.validation?.riskFlags || [],
        });
      } catch (_) {}

      // Auditoria (DB) best-effort
      let auditGenerationId = null;
      try {
        auditGenerationId = await registerGeneration({
          tenantId: 'system',
          payload: { description, createRequested: !!create },
          context: { sources: [] },
          artifacts: { tenantKey: tenantDraft?.tenant_key || null },
          contract: { version: tenantContract?.version || '1.0.0', hash: null },
          envelope,
        });
      } catch (_) {
        // best-effort
      }

      // Se solicitado, cria o tenant em etapas (base -> context). NUNCA ativa automaticamente.
      let createdTenant = null;
      if (create === true) {
        const createResult = await createTenant({
          tenant_key: tenantDraft.tenant_key,
          name: tenantDraft.name,
          site: tenantDraft.site,
          ramo_atividade: tenantDraft.ramo_atividade,
          objetivo: tenantDraft.objetivo,
          plan: tenantDraft.plan,
          status: tenantDraft.status,
          limits: tenantDraft.limits,
          settings: tenantDraft.settings,
          branding: tenantDraft.branding,
          _aiSafeMode: true,
        });
        if (!createResult.success) {
          sendJson(res, 500, {
            error: 'tenant_create_failed',
            message: createResult.error || 'Erro ao criar tenant (safe-mode)',
            tenantDraft,
            envelope,
            auditId: aiAuditId,
          });
          return true;
        }
        createdTenant = createResult.tenant;
      }

      sendJson(res, 200, {
        generated: true,
        auditId: aiAuditId,
        auditGenerationId,
        envelope,
        tenantDraft,
        tenant: tenantDraft, // compatibilidade
        created: !!createdTenant,
        createdTenant,
      });
    } catch (err) {
      logger.error('[Tenants] Erro ao gerar tenant por IA:', err);
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        sendJson(res, 500, {
          error: 'internal_error',
          message: err.message || 'Erro ao gerar tenant por IA',
        });
      }
    }
    return true;
  }

  // GET /tenants - Lista tenants
  if (method === 'GET' && pathname === '/tenants') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Apenas super-admin pode listar todos os tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem listar tenants' });
      return true;
    }

    try {
      const tenantsList = await listTenants();
      sendJson(res, 200, { tenants: tenantsList });
    } catch (err) {
      logger.error('Erro ao listar tenants:', err);
      sendJson(res, 500, { error: 'Erro ao listar tenants', message: err.message });
    }
    return true;
  }

  // GET /tenants/:id/context - Obtém contexto do tenant (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/context')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/context', ''));

    // Verifica se o tenant existe primeiro
    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return true;
      }
    } catch (err) {
      logger.error('Erro ao verificar tenant:', err);
      sendJson(res, 500, { error: 'Erro ao verificar tenant', message: err.message });
      return true;
    }

    // Super-admin pode ver qualquer contexto
    // Admin pode ver qualquer contexto
    // Outros só podem ver seu próprio contexto
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver o contexto do seu próprio tenant' });
      return true;
    }

    const context = getTenantContext(tenantId);
    if (!context) {
      sendJson(res, 404, { error: 'tenant_context_not_found' });
      return true;
    }

    sendJson(res, 200, { context });
    return true;
  }

  // GET /tenants/:id/usage - Obtém métricas de uso do tenant (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/usage')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/usage', ''));

    // Owner pode ver métricas do seu tenant, admin pode ver qualquer tenant
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem ver métricas' });
      return true;
    }

    // Super-admin pode ver métricas de qualquer tenant
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role === 'owner' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver métricas do seu próprio tenant' });
      return true;
    }

    try {
      const usage = await getTenantUsage(tenantId);
      if (!usage) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return true;
      }

      sendJson(res, 200, { usage });
    } catch (err) {
      logger.error('Erro ao obter métricas de uso:', err);
      sendJson(res, 500, { error: 'Erro ao obter métricas de uso', message: err.message });
    }
    return true;
  }

  // GET /tenants/:id/plan-usage - Retorna plano + limites efetivos + uso (deve vir ANTES da rota genérica /tenants/:id)
  // Também suporta /tenants/current/plan-usage para o tenant do agente autenticado.
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/plan-usage')) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return true;
      }

      let tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/plan-usage', ''));
      if (tenantId === 'current') {
        tenantId = authResult.agent?.tenantId;
      }
      if (!tenantId || tenantId === 'current') {
        sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente ou inválido' });
        return true;
      }

      // Apenas owner/admin (ou super-admin) podem ver limites/uso do plano
      const agent = authResult.agent || req.agent;
      const isSuperAdminUser = isSuperAdmin(agent);
      if (!isSuperAdminUser && agent?.role !== 'owner' && agent?.role !== 'admin') {
        sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem ver plano/uso' });
        return true;
      }

      const { getPlanLimits } = require('../services/planLimitsService');

      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return true;
      }

      const usage = await getTenantUsage(tenantId);
      const limits = tenant.limits || getPlanLimits(tenant.plan);

      sendJson(res, 200, {
        tenantId,
        plan: tenant.plan || 'trial',
        limits,
        usage,
      });
    } catch (err) {
      logger.error('Erro ao obter plano/uso do tenant:', err);
      sendJson(res, 500, { error: 'Erro ao obter plano/uso', message: err.message });
    }
    return true;
  }

  // GET /tenants/:id/ai-provider-status - Verifica se tenant tem provider de IA válido (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/ai-provider-status')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/ai-provider-status', ''));

    // Verifica se o usuário tem permissão para ver o status do tenant
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver o status de provider de IA do seu próprio tenant' });
      return true;
    }

    try {
      const { getAiProviderForTenant } = require('../../engine/aiProviderManager');
      const { getAIConfig, getDecryptedAPIKey } = require('../services/tenantAIService');

      // Busca configuração de IA do tenant no banco de dados
      const tenantAiConfig = await getAIConfig(tenantId);

      // Configuração específica é obrigatória - se não tiver, retorna false
      if (!tenantAiConfig || !tenantAiConfig.primary || !tenantAiConfig.configured) {
        logger.warn('Tenant não tem configuração específica de provider de IA (obrigatória)', {
          tenantId,
          hasTenantConfig: !!tenantAiConfig,
          hasPrimary: !!tenantAiConfig?.primary,
          configured: tenantAiConfig?.configured,
        });

        sendJson(res, 200, {
          hasValidProvider: false,
          tenantId,
        });
        return true;
      }

      // Obtém o provider específico do tenant
      const provider = getAiProviderForTenant(tenantId);

      // Verifica se o provider é válido
      const hasValidProvider = provider !== null &&
                              typeof provider === 'object' &&
                              typeof provider.generate === 'function';

      // Se o provider não estiver registrado, testa o token do provider configurado
      let finalIsValid = hasValidProvider;

      if (!hasValidProvider && tenantAiConfig.primary) {
        const primaryProvider = tenantAiConfig.primary;
        // Busca API key do banco de dados (criptografada)
        const apiKey = await getDecryptedAPIKey(tenantId, primaryProvider);

        if (apiKey && apiKey.trim()) {
          logger.debug('Provider não registrado, testando token do provider configurado', {
            tenantId,
            primaryProvider,
            hasApiKey: !!apiKey,
          });

          // Testa o token do provider primário configurado
          try {
            if (primaryProvider === 'openai') {
              const response = await fetch('https://api.openai.com/v1/models', {
                method: 'GET',
                headers: {
                  'Authorization': `Bearer ${apiKey.trim()}`,
                },
                signal: AbortSignal.timeout(10000),
              });

              if (response.ok) {
                const data = await response.json().catch(() => null);
                finalIsValid = !!(data && Array.isArray(data.data));
                logger.info('Token OpenAI testado com sucesso', {
                  tenantId,
                  isValid: finalIsValid,
                  hasData: !!data,
                  isArray: Array.isArray(data?.data),
                });
              } else {
                const errorData = await response.json().catch(() => ({}));
                logger.warn('Token OpenAI inválido', {
                  tenantId,
                  status: response.status,
                  error: errorData.error?.message || response.statusText,
                });
                finalIsValid = false;
              }
            } else if (primaryProvider === 'anthropic') {
              const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'x-api-key': apiKey.trim(),
                  'anthropic-version': '2023-06-01',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'claude-3-haiku-20240307',
                  max_tokens: 10,
                  messages: [{ role: 'user', content: 'test' }],
                }),
                signal: AbortSignal.timeout(10000),
              });

              if (response.ok) {
                const data = await response.json().catch(() => null);
                finalIsValid = !!(data && data.content);
                logger.info('Token Anthropic testado com sucesso', {
                  tenantId,
                  isValid: finalIsValid,
                  hasData: !!data,
                  hasContent: !!data?.content,
                });
              } else {
                const errorData = await response.json().catch(() => ({}));
                logger.warn('Token Anthropic inválido', {
                  tenantId,
                  status: response.status,
                  error: errorData.error?.message || response.statusText,
                });
                finalIsValid = false;
              }
            }
          } catch (err) {
            logger.warn('Erro ao testar token do provider', {
              tenantId,
              provider: primaryProvider,
              error: err.message,
            });
            finalIsValid = false;
          }
        } else {
          logger.warn('API key não encontrada para o provider configurado', {
            tenantId,
            primaryProvider,
          });
          finalIsValid = false;
        }
      }

      logger.debug('Verificando provider de IA para tenant', {
        tenantId,
        hasValidProvider,
        finalIsValid,
        primaryProvider: tenantAiConfig?.primary,
      });

      if (!finalIsValid) {
        logger.warn('Provider de IA não válido para tenant', {
          tenantId,
          hasTenantConfig: !!tenantAiConfig,
          tenantPrimaryProvider: tenantAiConfig?.primary,
          tenantSecondaryProvider: tenantAiConfig?.secondary,
        });
      }

      logger.info('Status final de provider de IA do tenant', {
        tenantId,
        hasValidProvider: finalIsValid,
        providerRegistrado: hasValidProvider,
        providerTestado: !hasValidProvider && tenantAiConfig?.primary,
      });

      const responseData = {
        hasValidProvider: finalIsValid,
        tenantId,
      };

      logger.debug('Enviando resposta ao cliente', responseData);

      sendJson(res, 200, responseData);
    } catch (err) {
      logger.error('Erro ao verificar status de provider de IA do tenant:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao verificar status de provider de IA' });
    }
    return true;
  }

  // GET /tenants/:id/ai-config - Obtém configuração de IA do tenant (deve vir ANTES da rota genérica /tenants/:id)
  // NOTA: Esta rota também cobre /tenants/current/ai-config por compatibilidade.
  if (method === 'GET' && pathname.startsWith('/tenants/') && pathname.endsWith('/ai-config')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    let tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/ai-config', ''));
    // Compatibilidade: /tenants/current/ai-config deve resolver para o tenant do agente autenticado.
    if (tenantId === 'current') {
      tenantId = authResult.agent?.tenantId;
    }
    if (!tenantId) {
      sendJson(res, 400, { error: 'bad_request', message: 'tenantId ausente ou inválido' });
      return true;
    }

    // Verifica se o usuário tem permissão para ver a config de IA do tenant
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver a configuração de IA do seu próprio tenant' });
      return true;
    }

    try {
      // Busca configuração de IA do tenant no banco de dados
      const { getAIConfig } = require('../services/tenantAIService');
      const tenantAiConfig = await getAIConfig(tenantId);

      // Se tenant não existir, 404
      if (tenantAiConfig === null) {
        sendJson(res, 404, { error: 'not_found', message: 'Tenant não encontrado' });
        return true;
      }

      // Retorna configuração completa (sem segredos) para o frontend reidratar campos (model, temperature, max_tokens, etc).
      sendJson(res, 200, { tenantId, ...tenantAiConfig });
    } catch (err) {
      logger.error('Erro ao obter configuração de IA do tenant:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter configuração de IA do tenant' });
    }
    return true;
  }

  // GET /tenants/:id - Obtém tenant específico
  if (method === 'GET' && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length));

    // Verifica se é super-admin (role super_admin OU owner do tenant system original)
    // IMPORTANTE: Usa req.agent.tenantId (tenantId original do agente), não req.tenantId (que pode ter sido alterado)
    const isSuperAdminUser = isSuperAdmin(req.agent);

    // Super-admin pode ver qualquer tenant
    // Admin pode ver qualquer tenant
    // Outros só podem ver seu próprio tenant (baseado no tenantId original do agente)
    if (!isSuperAdminUser && req.agent.role !== 'admin' && req.agent.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode ver seu próprio tenant' });
      return true;
    }

    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return true;
      }

      sendJson(res, 200, { tenant });
    } catch (err) {
      logger.error('[Server] Erro ao obter tenant:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  // PUT /tenants/:id/context - Atualiza contexto do tenant (deve vir ANTES da rota genérica /tenants/:id)
  if (method === 'PUT' && pathname.startsWith('/tenants/') && pathname.endsWith('/context')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Apenas OWNER ou ADMIN podem atualizar contextos (proteção contra prompt injection)
    // Apenas super-admin pode atualizar contextos de tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem atualizar contextos de tenants' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/context', ''));

    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return true;
      }
      const body = await parseJsonBody(req);

      // Valida entrada usando schema
      const { validateInput, schemas } = require('../utils/inputValidator');
      try {
        validateInput(body, schemas.updateTenantContext);
      } catch (validationError) {
        badRequest(res, validationError.message || 'Dados inválidos');
        return true;
      }

      // Passa informações do usuário para auditoria e validação
      const result = await updateTenantContext(tenantId, body, {
        userRole: req.agent.role,
        userId: req.agent.id,
        username: req.agent.username,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'tenant_context_update',
        resource: 'tenant_context',
        resourceId: tenantId,
        details: { updatedFields: Object.keys(body) },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { context: result.context });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar tenant context:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // PUT /tenants/:id - Atualiza tenant
  // Exclui rotas específicas que devem ser tratadas antes (ai-config, ai-credentials, etc)
  if (method === 'PUT' && pathname.startsWith('/tenants/') &&
      !pathname.endsWith('/ai-config') && !pathname.endsWith('/ai-credentials')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Apenas super-admin pode atualizar tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem atualizar tenants' });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length));
    const tenant = getTenant(tenantId);

    if (!tenant) {
      sendJson(res, 404, { error: 'tenant_not_found' });
      return true;
    }

    try {
      const body = await parseJsonBody(req);

      // Valida entrada usando schema
      const { validateInput, schemas } = require('../utils/inputValidator');
      try {
        validateInput(body, schemas.updateTenant);
      } catch (validationError) {
        badRequest(res, validationError.message || 'Dados inválidos');
        return true;
      }

      const result = await updateTenant(tenantId, body);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      // Registra ação de auditoria
      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'tenant_update',
        resource: 'tenant',
        resourceId: tenantId,
        details: { updatedFields: Object.keys(body) },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // DELETE /tenants/:id - Remove tenant
  if (method === 'DELETE' && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    // Apenas super-admins podem remover tenants
    const isSuperAdminUser = isSuperAdmin(req.agent);
    if (!isSuperAdminUser) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas super-admins podem remover tenants' });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length));

    try {
      const tenant = await getTenant(tenantId);
      if (!tenant) {
        sendJson(res, 404, { error: 'tenant_not_found' });
        return true;
      }

      const result = await deleteTenant(tenantId);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Tenant removido com sucesso' });
    } catch (err) {
      logger.error('Erro ao remover tenant:', err);
      sendJson(res, 500, { error: 'Erro ao remover tenant', message: err.message });
    }
    return true;
  }

  // POST /tenants/:id/suspend - Suspende tenant (requer autenticação admin/owner)
  if (method === 'POST' && pathname.includes('/suspend') && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/suspend', ''));

    // Apenas owner ou admin podem suspender
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem suspender tenants' });
      return true;
    }

    // Owner só pode suspender seu próprio tenant
    if (req.agent.role === 'owner' && req.tenantId !== tenantId) {
      sendJson(res, 403, { error: 'forbidden', message: 'Você só pode suspender seu próprio tenant' });
      return true;
    }

    const result = await suspendTenant(tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: tenantId,
      action: 'tenant_suspend',
      resource: 'tenant',
      resourceId: tenantId,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { tenant: result.tenant });
    return true;
  }

  // POST /tenants/:id/reactivate - Reativa tenant (requer autenticação admin/owner)
  if (method === 'POST' && pathname.includes('/reactivate') && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/reactivate', ''));

    // Apenas owner ou admin podem reativar
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem reativar tenants' });
      return true;
    }

    const result = await reactivateTenant(tenantId);
    if (!result.success) {
      sendJson(res, 400, { error: result.error });
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      tenantId: tenantId,
      action: 'tenant_reactivate',
      resource: 'tenant',
      resourceId: tenantId,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { tenant: result.tenant });
    return true;
  }

  // POST /tenants/:id/change-plan - Muda plano do tenant (requer autenticação admin/owner)
  if (method === 'POST' && pathname.includes('/change-plan') && pathname.startsWith('/tenants/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const tenantId = decodeURIComponent(pathname.slice('/tenants/'.length).replace('/change-plan', ''));

    // Apenas owner ou admin podem mudar plano
    if (req.agent.role !== 'owner' && req.agent.role !== 'admin') {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas owner ou admin podem mudar plano' });
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body.plan) {
        badRequest(res, 'Campo "plan" é obrigatório');
        return true;
      }

      const result = await changePlan(tenantId, body.plan);
      if (!result.success) {
        sendJson(res, 400, { error: result.error });
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        tenantId: tenantId,
        action: 'tenant_change_plan',
        resource: 'tenant',
        resourceId: tenantId,
        details: { newPlan: body.plan },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, { tenant: result.tenant });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao mudar plano do tenant:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleTenantRoutes };
