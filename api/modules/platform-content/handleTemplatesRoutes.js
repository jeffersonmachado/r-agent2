const path = require('path');
const fs = require('fs');
const { handleFlowTemplateMarketplaceRoutes } = require('./handleFlowTemplateMarketplaceRoutes');
const { resolveRuntimePath } = require('../../utils/runtimePaths');

// Templates embutidos (seeds versionados, somente leitura) ficam no frontend
// real do repositório. Templates criados em runtime são escritos FORA do
// repo, em RUNTIME_ROOT/templates — nunca dentro do worktree.
function builtinTemplatesDir() {
  return path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'templates');
}

function runtimeTemplatesDir() {
  return resolveRuntimePath('templates');
}

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

  // /flow-templates/* → handleFlowTemplateMarketplaceRoutes
  if (pathname.startsWith('/flow-templates')) {
    return handleFlowTemplateMarketplaceRoutes({ req, res, method, pathname, deps });
  }

  // GET /templates - Lista todos os templates disponíveis
  if (method === 'GET' && pathname === '/templates') {
    try {
      // Built-ins versionados + overrides de runtime (runtime vence por id).
      const templates = new Map();

      const collectFrom = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const file of fs.readdirSync(dir)) {
          if (!file.endsWith('.json')) continue;
          try {
            const template = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            // Valida estrutura básica do template
            if (template && template.id && template.name && template.flow) {
              templates.set(template.id, {
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
      };

      collectFrom(builtinTemplatesDir());
      collectFrom(runtimeTemplatesDir());

      sendJson(res, 200, [...templates.values()]);
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

      // Runtime tem precedência sobre o built-in versionado.
      const runtimeFile = path.join(runtimeTemplatesDir(), `${templateId}.json`);
      const builtinFile = path.join(builtinTemplatesDir(), `${templateId}.json`);
      const templateFile = fs.existsSync(runtimeFile) ? runtimeFile : builtinFile;

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
      // Escrita sempre em RUNTIME_ROOT — nunca dentro do repositório.
      const templatesDir = runtimeTemplatesDir();
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
      // DELETE só alcança arquivos de runtime — built-ins versionados do
      // repositório são intocáveis via API (respondem 404 aqui).
      const templateFile = path.join(runtimeTemplatesDir(), `${sanitizedId}.json`);

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
