  // -----------------------------------------------------------------------
  // CRUD de fluxos
  // -----------------------------------------------------------------------

  // GET /flows
  if (method === 'GET' && pathname === '/flows') {
    const authResult = requireAuth(req);
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const envFilter = urlObj.searchParams.get('environment');
    if (STRICT_TENANT_MODE) {
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      const tenantFlows = Array.from(flows.values()).filter(flow => flow.tenantId === tenantId);
      const filtered = envFilter
        ? tenantFlows.filter((flow) => String(flow?.metadata?.environment || '') === String(envFilter))
        : tenantFlows;
      sendJson(res, 200, filtered);
    } else {
      // DEV/compatibilidade: se autenticado, filtra por tenant do agente; caso contrário, retorna todos
      if (authResult.valid && req.tenantId) {
        const tenantFlows = Array.from(flows.values()).filter(flow => flow.tenantId === req.tenantId);
        const filtered = envFilter
          ? tenantFlows.filter((flow) => String(flow?.metadata?.environment || '') === String(envFilter))
          : tenantFlows;
        sendJson(res, 200, filtered);
      } else {
        const all = Array.from(flows.values());
        const filtered = envFilter
          ? all.filter((flow) => String(flow?.metadata?.environment || '') === String(envFilter))
          : all;
        sendJson(res, 200, filtered);
      }
    }
    return;
  }

  // GET /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial (validate, simulate) antes de processar
  if (method === 'GET' && pathname.startsWith('/flows/') && pathname !== '/flows/validate' && pathname !== '/flows/simulate') {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    let flow = flows.get(id);
    // Fallback DB: se não estiver no cache em memória, tenta buscar no PostgreSQL.
    if (!flow) {
      try {
        const { getSequelize } = require('./db/sequelize');
        const sequelize = getSequelize();
        if (sequelize) {
          const { Flow } = require('./db/models');
          const FlowModel = Flow();
          const row = await FlowModel.findByPk(id);
          if (row) {
            const data = row.data && typeof row.data === 'object' ? row.data : {};
            const flowObj = { ...data, id: row.id };
            if (row.tenant_key && !flowObj.tenantId) flowObj.tenantId = row.tenant_key;
            if (row.name && !flowObj.name) flowObj.name = row.name;
            flows.set(row.id, flowObj);
            flow = flowObj;
          }
        }
      } catch (e) {
        // best-effort: se falhar, mantém comportamento anterior (404)
      }
    }
    if (!flow) {
      sendJson(res, 404, { error: 'flow_not_found' });
      return;
    }
    
    const authResult = requireAuth(req);
    if (STRICT_TENANT_MODE) {
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      if (flow.tenantId !== tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
        return;
      }
    } else {
      // DEV/compatibilidade: valida tenant apenas se autenticado
      if (authResult.valid && req.tenantId && flow.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
        return;
      }
    }
    
    sendJson(res, 200, flow);
    return;
  }

  // POST /flows
  if (method === 'POST' && pathname === '/flows') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);

      // Validação estrutural básica
      const structureValidation = validateFlowStructure(body);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return;
      }

      const authResult = requireAuth(req);
      let tenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        tenantId = requireTenant(req, res);
        if (!tenantId) return;
        body.tenantId = tenantId; // força tenant do agente (ou X-Tenant-Id do super-admin)
      } else {
        // DEV/compatibilidade: se autenticado, força tenantId do agente; se não, exige tenantId explícito no body
        if (authResult.valid && req.tenantId) body.tenantId = req.tenantId;
        if (!body.tenantId || typeof body.tenantId !== 'string' || body.tenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return;
        }
        tenantId = String(body.tenantId).trim();
        body.tenantId = tenantId;
      }

      const flow = ensureFlowHasMeta(body, tenantId);
      if (!flow.tenantId) {
        sendJson(res, 403, { error: 'tenant_required' });
        return;
      }

      const flowKind = String(flow.kind || 'chat').trim().toLowerCase();

      // 🚫 Gate de validação OBRIGATÓRIA para fluxos gerados por IA
      // Fluxos gerados por IA DEVEM passar pelo gate antes de serem salvos
      const isAiGenerated = flow.metadata?.generatedBy === 'ai' || flow.metadata?.generated === true;
      if (isAiGenerated && flowKind !== 'voice') {
        // Safe-mode obrigatório: todo fluxo de IA nasce como draft e exige revisão humana.
        flow.metadata = {
          ...(flow.metadata && typeof flow.metadata === 'object' ? flow.metadata : {}),
          generatedBy: 'ai',
          generated: true,
          status: 'draft',
          requiresReview: true,
        };
        const { validateGeneratedPlanOrThrow } = require('../engine/ai/validateGeneratedPlan');
        try {
          validateGeneratedPlanOrThrow(flow, 'chatbot');
          logger.info('[POST /flows] Fluxo gerado por IA passou no gate de validação', {
            flowId: flow.id,
            flowName: flow.name
          });
        } catch (validationError) {
          logger.error('[POST /flows] Gate de validação bloqueou fluxo gerado por IA', {
            flowId: flow.id,
            flowName: flow.name,
            error: validationError.message
          });
          badRequest(res, `Fluxo gerado por IA não passou na validação obrigatória: ${validationError.message}`);
          return;
        }
      }

      // Validação completa usando o validador da engine
      // ✅ NOTA: A validação é executada mas não bloqueia a criação do fluxo
      // O fluxo pode ser criado mesmo com erros de validação para permitir que o usuário corrija depois
      // EXCEÇÃO: Fluxos gerados por IA já foram validados pelo gate acima
      const validationResult = flowKind === 'voice' ? validateVoiceFlow(flow) : validateFlow(flow);
      const hasValidationErrors = !validationResult.valid && validationResult.errors.length > 0;

      // Verifica se já existe um fluxo com o mesmo id
      if (flows.has(flow.id)) {
        sendJson(res, 409, {
          error: 'flow_already_exists',
          message: `Já existe um fluxo com o id "${flow.id}". Use PUT para atualizar.`,
        });
        return;
      }

      flows.set(flow.id, flow);
      persistFlowBestEffort(flow);
      
      // Dispara webhooks e WebSocket
      triggerWebhooks(flow.tenantId, 'flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para flow.created:', err);
      });

      emitEvent('flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }, { tenantId: flow.tenantId });
      
      // ✅ Retorna o fluxo criado, incluindo erros de validação se houver
      // Isso permite que o frontend exiba os erros mas não bloqueia a criação
      const response = { ...flow };
      if (hasValidationErrors) {
        response.validationWarnings = {
          valid: false,
          errors: validationResult.errors, // ✅ Já vem com messageUi do validator
        };
      }
      
      sendJson(res, 201, response);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao criar fluxo', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // PUT /flows/:id/environment
  if (method === 'PUT' && pathname.startsWith('/flows/') && pathname.endsWith('/environment')) {
    const id = decodeURIComponent(pathname.slice('/flows/'.length).replace(/\/environment$/, ''));
    if (!id) {
      badRequest(res, 'ID do fluxo é obrigatório');
      return;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }
    try {
      const body = await parseJsonBody(req);
      const env = body && body.environment ? String(body.environment).trim() : '';
      if (!env || !['dev', 'stage', 'prod'].includes(env)) {
        badRequest(res, 'Campo "environment" inválido. Use: dev|stage|prod');
        return;
      }

      const existingFlow = flows.get(id);
      if (!existingFlow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${id}" não encontrado` });
        return;
      }

      const authResult = requireAuth(req);
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        const tenantId = requireTenant(req, res);
        if (!tenantId) return;
        if (existingFlow.tenantId !== tenantId) {
          sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
          return;
        }
      } else if (authResult.valid && req.tenantId && existingFlow.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
        return;
      }

      const next = { ...existingFlow };
      next.metadata = next.metadata && typeof next.metadata === 'object' ? { ...next.metadata } : {};
      next.metadata.environment = env;
      flows.set(id, next);
      persistFlowBestEffort(next);
      sendJson(res, 200, { ok: true, flow: next });
    } catch (err) {
      logger.error('[Flows] Erro ao atualizar environment', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao atualizar environment' });
    }
    return;
  }

  // PUT /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial antes de processar
  if (method === 'PUT' && pathname.startsWith('/flows/') && pathname !== '/flows/validate' && pathname !== '/flows/simulate') {
    const id = decodeURIComponent(pathname.slice('/flows/'.length));

    // Validação básica do ID
    if (!id || id.trim() === '') {
      badRequest(res, 'ID do fluxo é obrigatório');
      return;
    }

    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await parseJsonBody(req);

      // Verifica se o fluxo existe
      const existingFlow = flows.get(id);
      if (!existingFlow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${id}" não encontrado` });
        return;
      }

      const authResult = requireAuth(req);
      let tenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return;
        }
        tenantId = requireTenant(req, res);
        if (!tenantId) return;
        if (existingFlow.tenantId !== tenantId) {
          sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
          return;
        }
        body.tenantId = tenantId; // força tenant do agente
      } else {
        // DEV/compatibilidade: valida tenant se autenticado
        if (authResult.valid && req.tenantId && existingFlow.tenantId !== req.tenantId) {
          sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
          return;
        }
        if (authResult.valid && req.tenantId) body.tenantId = req.tenantId;
        tenantId = (body.tenantId && typeof body.tenantId === 'string' && body.tenantId.trim())
          ? body.tenantId.trim()
          : (existingFlow.tenantId || null);
      }

      // Valida consistência: se body.id existe, deve corresponder ao id da URL
      if (body && typeof body === 'object' && body.id && body.id !== id) {
        badRequest(res, `O ID do fluxo no body ("${body.id}") não corresponde ao ID da URL ("${id}")`);
        return;
      }

      const merged = {
        ...existingFlow,
        ...(body && typeof body === 'object' ? body : {}),
        id, // Garante que o ID não seja alterado
      };

      const mergedKind = (merged && typeof merged === 'object' && typeof merged.kind === 'string')
        ? String(merged.kind).trim().toLowerCase()
        : (existingFlow && typeof existingFlow.kind === 'string' ? String(existingFlow.kind).trim().toLowerCase() : 'chat');

      // Validação estrutural básica
      const structureValidation = validateFlowStructure(merged);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return;
      }

      // 🚫 Gate de validação OBRIGATÓRIA para fluxos gerados por IA
      // Se o fluxo foi gerado por IA, deve passar pelo gate antes de ser atualizado
      const isAiGenerated = merged.metadata?.generatedBy === 'ai' || merged.metadata?.generated === true;
      if (isAiGenerated && mergedKind !== 'voice') {
        // Safe-mode permanece até aprovação explícita (admin/super-admin).
        const requestedApprove = body?.metadata?.approveAiGenerated === true;
        const canApprove = !!(authResult.valid && (isSuperAdmin(req.agent) || req.agent.role === 'admin'));
        const keepRequiresReview = !(requestedApprove && canApprove);

        merged.metadata = {
          ...(merged.metadata && typeof merged.metadata === 'object' ? merged.metadata : {}),
          generatedBy: 'ai',
          generated: true,
          status: keepRequiresReview ? 'draft' : 'active',
          requiresReview: keepRequiresReview,
        };
        // Não persistir flag de aprovação no fluxo
        if (merged.metadata && Object.prototype.hasOwnProperty.call(merged.metadata, 'approveAiGenerated')) {
          delete merged.metadata.approveAiGenerated;
        }

        const { validateGeneratedPlanOrThrow } = require('../engine/ai/validateGeneratedPlan');
        try {
          validateGeneratedPlanOrThrow(merged, 'chatbot');
          logger.info('[PUT /flows/:id] Fluxo gerado por IA passou no gate de validação', {
            flowId: id,
            flowName: merged.name
          });
        } catch (validationError) {
          logger.error('[PUT /flows/:id] Gate de validação bloqueou atualização de fluxo gerado por IA', {
            flowId: id,
            flowName: merged.name,
            error: validationError.message
          });
          badRequest(res, `Fluxo gerado por IA não passou na validação obrigatória: ${validationError.message}`);
          return;
        }
      }

      // Validação completa usando o validador da engine
      const validationResult = mergedKind === 'voice' ? validateVoiceFlow(merged) : validateFlow(merged);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        // ✅ Mapeia erros técnicos para mensagens amigáveis
        sendJson(res, 400, {
          error: 'validation_failed',
          message: 'O fluxo não passou na validação',
          errors: validationResult.errors, // ✅ Já vem com messageUi do validator
        });
        return;
      }

      const flow = ensureFlowHasMeta(merged, tenantId);
      if (!flow.tenantId) {
        sendJson(res, 403, { error: 'tenant_required' });
        return;
      }
      flows.set(id, flow);
      persistFlowBestEffort(flow);
      
      // Dispara webhooks e WebSocket
      triggerWebhooks(flow.tenantId, 'flow.updated', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para flow.updated:', err);
      });

      emitEvent('flow.updated', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
      }, { tenantId: flow.tenantId });
      
      sendJson(res, 200, flow);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao atualizar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao processar requisição' });
      }
    }
    return;
  }

  // DELETE /flows/:id
  // IMPORTANTE: Verificar se não é um endpoint especial antes de processar
  if (method === 'DELETE' && pathname.startsWith('/flows/')) {
    // Verificar se não é um endpoint especial
    if (pathname === '/flows/validate' || pathname === '/flows/simulate') {
      notFound(res);
      return;
    }
    const id = decodeURIComponent(pathname.slice('/flows/'.length));
    const flow = flows.get(id);
    if (!flow) {
      sendJson(res, 404, { error: 'flow_not_found' });
      return;
    }
    
    const authResult = requireAuth(req);
    if (STRICT_TENANT_MODE) {
      if (!authResult.valid) {
        sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
        return;
      }
      const tenantId = requireTenant(req, res);
      if (!tenantId) return;
      if (flow.tenantId !== tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
        return;
      }
    } else {
      // DEV/compatibilidade: valida tenant se autenticado
      if (authResult.valid && req.tenantId && flow.tenantId !== req.tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
        return;
      }
    }
    
    flows.delete(id);
    deleteFlowBestEffort(id);
    
    // Dispara webhooks e WebSocket
    triggerWebhooks(flow.tenantId, 'flow.deleted', {
      flowId: flow.id,
      flowName: flow.name,
      agentId: req.agent?.id,
    }).catch((err) => {
      logger.error('[Webhook] Erro ao disparar webhook para flow.deleted:', err);
    });

    emitEvent('flow.deleted', {
      flowId: flow.id,
      flowName: flow.name,
      agentId: req.agent?.id,
    }, { tenantId: flow.tenantId });
    
    sendJson(res, 200, { success: true, deletedId: id });
    return;
  }

  // -----------------------------------------------------------------------