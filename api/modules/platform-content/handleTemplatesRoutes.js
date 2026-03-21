const path = require('path');
const fs = require('fs');

module.exports = { handleTemplatesRoutes };

async function handleTemplatesRoutes({ req, res, method, pathname, deps }) {
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

  // GET /flow-templates - Lista templates (globais + do tenant)
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

  // GET /flow-templates/:id - Obtém template completo (inclui flow)
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

  // POST /flow-templates - Cria template do tenant (body inclui flow)
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

  // POST /flow-templates/:id/install - Cria um flow a partir do template e persiste
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

  // DELETE /flow-templates/:id - Remove template do tenant (não remove globais)
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

  // GET /templates - Lista todos os templates disponíveis
  if (method === 'GET' && pathname === '/templates') {
    try {
      const templatesDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'templates');

      if (!fs.existsSync(templatesDir)) {
        sendJson(res, 200, []);
        return true;
      }

      const files = fs.readdirSync(templatesDir);
      const templates = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const filePath = path.join(templatesDir, file);
            const content = fs.readFileSync(filePath, 'utf8');
            const template = JSON.parse(content);

            // Valida estrutura básica do template
            if (template && template.id && template.name && template.flow) {
              templates.push({
                id: template.id,
                name: template.name,
                description: template.description || '',
                icon: template.icon || '📋',
              });
            }
          } catch (err) {
            logger.warn(`Erro ao ler template ${file}:`, err.message);
          }
        }
      }

      sendJson(res, 200, templates);
    } catch (err) {
      logger.error('Erro ao listar templates', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar templates' });
    }
    return true;
  }

  // GET /templates/:id - Obtém um template específico completo
  if (method === 'GET' && pathname.startsWith('/templates/') && pathname !== '/templates') {
    try {
      const templateId = decodeURIComponent(pathname.replace('/templates/', '').replace(/\.json$/, ''));

      if (!templateId || templateId.trim() === '') {
        badRequest(res, 'ID do template é obrigatório');
        return true;
      }

      const templatesDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${templateId}.json`);

      if (!fs.existsSync(templateFile)) {
        sendJson(res, 404, { error: 'not_found', message: `Template "${templateId}" não encontrado` });
        return true;
      }

      const content = fs.readFileSync(templateFile, 'utf8');
      const template = JSON.parse(content);

      // Valida estrutura básica
      if (!template || !template.id || !template.name || !template.flow) {
        sendJson(res, 500, { error: 'invalid_template', message: 'Template corrompido ou inválido' });
        return true;
      }

      sendJson(res, 200, template);
    } catch (err) {
      if (err instanceof SyntaxError) {
        sendJson(res, 500, { error: 'parse_error', message: 'Erro ao parsear template JSON' });
      } else {
        logger.error('Erro ao obter template', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter template' });
      }
    }
    return true;
  }

  // POST /templates - Salva um novo template
  if (method === 'POST' && pathname === '/templates') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);

      // Valida estrutura básica
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto');
        return true;
      }

      if (!body.id || typeof body.id !== 'string' || body.id.trim() === '') {
        badRequest(res, 'Campo "id" é obrigatório e deve ser uma string não vazia');
        return true;
      }

      if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        badRequest(res, 'Campo "name" é obrigatório e deve ser uma string não vazia');
        return true;
      }

      if (!body.flow || typeof body.flow !== 'object') {
        badRequest(res, 'Campo "flow" é obrigatório e deve ser um objeto');
        return true;
      }

      // Valida o fluxo antes de salvar como template
      const kind = (body.flow && typeof body.flow === 'object' && typeof body.flow.kind === 'string')
        ? String(body.flow.kind).trim().toLowerCase()
        : 'chat';
      const validationResult = kind === 'voice' ? validateVoiceFlow(body.flow) : validateFlow(body.flow);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        sendJson(res, 400, {
          error: 'validation_failed',
          message: 'O fluxo não passou na validação',
          errors: validationResult.errors,
        });
        return true;
      }

      // Sanitiza o ID do template (usado como nome do arquivo)
      const templateId = body.id.trim().replace(/[^a-z0-9-]/g, '-').toLowerCase();
      const templatesDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${templateId}.json`);

      // Garante que o diretório existe
      if (!fs.existsSync(templatesDir)) {
        fs.mkdirSync(templatesDir, { recursive: true });
      }

      // Prepara o template
      const template = {
        id: templateId,
        name: body.name.trim(),
        description: (body.description || '').trim() || `Template: ${body.name.trim()}`,
        icon: (body.icon || '📋').trim().substring(0, 2),
        flow: body.flow,
      };

      // Salva o arquivo JSON
      fs.writeFileSync(templateFile, JSON.stringify(template, null, 2), 'utf8');

      logger.debug(`Template salvo: ${templateFile}`);

      sendJson(res, 201, {
        success: true,
        template: template,
        message: `Template "${template.name}" salvo com sucesso`,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao salvar template', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao salvar template' });
      }
    }
    return true;
  }

  // DELETE /templates/:id - Remove um template
  if (method === 'DELETE' && pathname.startsWith('/templates/')) {
    try {
      let templateId = decodeURIComponent(pathname.slice('/templates/'.length));
      // Remove .json se presente
      if (templateId.endsWith('.json')) {
        templateId = templateId.slice(0, -'.json'.length);
      }

      if (!templateId || templateId.trim() === '') {
        badRequest(res, 'ID do template é obrigatório');
        return true;
      }

      // Sanitiza o ID do template (mesmo processo usado no POST)
      const sanitizedId = templateId.trim().replace(/[^a-z0-9-]/g, '-').toLowerCase();
      const templatesDir = path.join(__dirname, '..', '..', 'frontend', 'public', 'templates');
      const templateFile = path.join(templatesDir, `${sanitizedId}.json`);

      // Verifica se o arquivo existe
      if (!fs.existsSync(templateFile)) {
        sendJson(res, 404, {
          error: 'not_found',
          message: `Template "${sanitizedId}" não encontrado`,
        });
        return true;
      }

      // Remove o arquivo
      fs.unlinkSync(templateFile);

      logger.debug(`Template removido: ${templateFile}`);

      sendJson(res, 200, {
        success: true,
        deletedId: sanitizedId,
        message: `Template "${sanitizedId}" removido com sucesso`,
      });
    } catch (err) {
      logger.error('Erro ao remover template', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro interno ao remover template',
      });
    }
    return true;
  }

  return false;
}
