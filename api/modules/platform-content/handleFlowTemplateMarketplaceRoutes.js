'use strict';

/**
 * Flow-template marketplace routes.
 * GET    /flow-templates           – list templates (global + tenant)
 * GET    /flow-templates/:id       – get full template
 * POST   /flow-templates           – create tenant template
 * POST   /flow-templates/:id/install – instantiate template as a live flow
 * DELETE /flow-templates/:id       – remove tenant template
 */

async function handleFlowTemplateMarketplaceRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    crypto,
    flowTemplateMarketplaceService,
    validateFlowStructure,
    validateFlow,
    validateVoiceFlow,
    ensureFlowHasMeta,
    persistFlowBestEffort,
    flows,
    triggerWebhooks,
    emitEvent,
  } = deps;

  if (!pathname.startsWith('/flow-templates')) return false;

  // GET /flow-templates
  if (method === 'GET' && pathname === '/flow-templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const tag = urlObj.searchParams.get('tag') || undefined;
      const q = urlObj.searchParams.get('q') || urlObj.searchParams.get('search') || undefined;
      const scope = urlObj.searchParams.get('scope') || 'all';
      const activeOnly = urlObj.searchParams.get('activeOnly');

      const templates = flowTemplateMarketplaceService.listTemplates({
        tenantId: req.tenantId,
        tag,
        q,
        scope,
        activeOnly: activeOnly === null ? true : activeOnly !== 'false',
      });

      sendJson(res, 200, { templates });
    } catch (err) {
      logger.error('Erro ao listar flow-templates', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // GET /flow-templates/:id
  if (method === 'GET' && pathname.startsWith('/flow-templates/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/flow-templates/'.length));
      if (!id || id.trim() === '') {
        badRequest(res, 'ID do template é obrigatório');
        return true;
      }

      const tpl = flowTemplateMarketplaceService.getTemplate({ tenantId: req.tenantId, id });
      if (!tpl) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }

      sendJson(res, 200, tpl);
    } catch (err) {
      logger.error('Erro ao obter flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // POST /flow-templates – create tenant template
  if (method === 'POST' && pathname === '/flow-templates') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { id, name, description, icon, tags, flow } = body || {};

      const result = await flowTemplateMarketplaceService.createTemplate({
        tenantId: req.tenantId,
        id: id ? String(id) : null,
        name,
        description,
        icon,
        tags,
        flow,
        createdBy: req.agent?.id || null,
      });

      if (!result.success) {
        sendJson(res, 400, { error: result.error, details: result.details });
        return true;
      }

      sendJson(res, 201, { template: result.template });
    } catch (err) {
      logger.error('Erro ao criar flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // POST /flow-templates/:id/install – instantiate as live flow
  if (method === 'POST' && pathname.startsWith('/flow-templates/') && pathname.endsWith('/install')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const templateId = decodeURIComponent(pathname.slice('/flow-templates/'.length, -'/install'.length));
      const tpl = flowTemplateMarketplaceService.getTemplate({ tenantId: req.tenantId, id: templateId });
      if (!tpl) {
        sendJson(res, 404, { error: 'not_found' });
        return true;
      }

      const body = await parseJsonBody(req);
      const customId = body?.id ? String(body.id) : null;
      const customName = body?.name ? String(body.name) : null;

      const random = crypto.randomBytes(6).toString('hex');
      const flowId = customId || `${tpl.id}-${Date.now()}-${random}`;
      const flowName = customName || `${tpl.name} (instalado)`;

      const raw = {
        ...(tpl.flow || {}),
        id: flowId,
        name: flowName,
        tenantId: req.tenantId,
        metadata: {
          ...(tpl.flow?.metadata || {}),
          createdFromTemplate: tpl.id,
          createdAt: new Date().toISOString(),
          createdBy: req.agent?.id || null,
        },
      };

      const structureValidation = validateFlowStructure(raw);
      if (!structureValidation.valid) {
        badRequest(res, structureValidation.error || 'Estrutura do fluxo inválida');
        return true;
      }

      if (flows.has(raw.id)) {
        sendJson(res, 409, {
          error: 'flow_already_exists',
          message: `Já existe um fluxo com o id "${raw.id}".`,
        });
        return true;
      }

      const flow = ensureFlowHasMeta(raw, req.tenantId);

      const flowKind = String(flow.kind || 'chat').trim().toLowerCase();
      const validationResult = flowKind === 'voice' ? validateVoiceFlow(flow) : validateFlow(flow);
      const hasValidationErrors = !validationResult.valid && validationResult.errors.length > 0;

      flows.set(flow.id, flow);
      persistFlowBestEffort(flow);

      const tenantId = req.tenantId || flow.tenantId;
      triggerWebhooks(tenantId, 'flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
        templateId: tpl.id,
      }).catch((err) => {
        logger.error('[Webhook] Erro ao disparar webhook para flow.created:', err);
      });

      emitEvent('flow.created', {
        flowId: flow.id,
        flowName: flow.name,
        agentId: req.agent?.id,
        templateId: tpl.id,
      }, { tenantId });

      const response = { ...flow };
      if (hasValidationErrors) {
        response.validationWarnings = {
          valid: false,
          errors: validationResult.errors,
        };
      }

      sendJson(res, 201, response);
    } catch (err) {
      logger.error('Erro ao instalar flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // DELETE /flow-templates/:id
  if (method === 'DELETE' && pathname.startsWith('/flow-templates/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'flows', 'create');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/flow-templates/'.length));
      const result = await flowTemplateMarketplaceService.deleteTemplate({ tenantId: req.tenantId, id });
      if (!result.success) {
        sendJson(res, result.error === 'not_found' ? 404 : 403, { error: result.error });
        return true;
      }
      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao remover flow-template', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}

module.exports = { handleFlowTemplateMarketplaceRoutes };
