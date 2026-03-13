function ensureConfigPermission(req, res, deps, action) {
  const { requireAuth, requirePermission, sendJson } = deps;
  const authResult = requireAuth(req);
  if (!authResult.valid) {
    sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

async function handleNodeMarketplaceRoute(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, logger } = deps;

  if (method === 'GET' && pathname === '/api/node-marketplace/catalog') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    try {
      const service = require('../services/nodeMarketplaceService');
      const items = service.listNodeCatalog({ tenantId: req.tenantId });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[NodeMarketplace] Erro ao listar catálogo:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar catálogo' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/node-marketplace/published') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    try {
      const service = require('../services/nodeMarketplaceService');
      const items = service.listPublishedNodes({ tenantId: req.tenantId });
      sendJson(res, 200, { ok: true, items });
    } catch (err) {
      logger.error('[NodeMarketplace] Erro ao listar publicados:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar publicados' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/node-marketplace/sdk/schema') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    try {
      const service = require('../services/nodeMarketplaceService');
      const schema = service.getNodeSchema();
      sendJson(res, 200, { ok: true, schema });
    } catch (err) {
      logger.error('[NodeMarketplace] Erro ao obter schema SDK:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter schema SDK' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/node-marketplace/publish') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const node = body && body.node ? body.node : body;
      const service = require('../services/nodeMarketplaceService');
      const out = service.publishNode({
        tenantId: req.tenantId,
        node,
        actorId: req.agent?.id || null,
      });
      if (!out.ok) {
        sendJson(res, 400, { ok: false, error: out.error || 'publish_failed' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[NodeMarketplace] Erro ao publicar node:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao publicar node' });
    }
    return true;
  }

  if (method === 'DELETE' && pathname.match(/^\/api\/node-marketplace\/publish\/[^\/]+$/)) {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    try {
      const nodeId = pathname.split('/').pop();
      const service = require('../services/nodeMarketplaceService');
      const out = service.revokeNode({ tenantId: req.tenantId, nodeId });
      if (!out.ok) {
        sendJson(res, 404, { ok: false, error: out.error || 'not_found' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[NodeMarketplace] Erro ao revogar node:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao revogar node' });
    }
    return true;
  }

  return false;
}

async function handleTenantSettingsRoute(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const { sendJson, badRequest, hasJsonContentType, parseJsonBody, requireTenant, logger } = deps;

  if (!pathname.startsWith('/api/tenant-settings/')) {
    return false;
  }

  if (method !== 'GET' && method !== 'POST') {
    return false;
  }

  if (!ensureConfigPermission(req, res, deps, method === 'GET' ? 'read' : 'update')) return true;

  const tenantId = requireTenant(req, res);
  if (!tenantId) return true;

  if (method === 'POST' && !hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const key = decodeURIComponent(pathname.slice('/api/tenant-settings/'.length));
    const allowedKeys = new Set(['sso', 'scim', 'phone-masking']);
    if (!allowedKeys.has(String(key))) {
      sendJson(res, 400, { error: 'bad_request', message: 'Chave inválida. Use: sso|scim|phone-masking' });
      return true;
    }

    const service = require('../services/tenantSettingsService');
    if (method === 'GET') {
      const out = await service.getSetting({ tenantId, key });
      if (String(key) === 'phone-masking' && !out.ok) {
        sendJson(res, 200, { ok: true, key, value: { enabled: false }, fallback: true });
        return true;
      }
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, key, value: out.value });
      return true;
    }

    const body = await parseJsonBody(req);
    const out = await service.upsertSetting({ tenantId, key, value: body?.value || {} });
    if (!out.ok) {
      sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
      return true;
    }
    sendJson(res, 200, { ok: true, key, value: out.value });
  } catch (err) {
    const key = decodeURIComponent(pathname.slice('/api/tenant-settings/'.length));
    if (method === 'GET' && String(key) === 'phone-masking') {
      sendJson(res, 200, { ok: true, key, value: { enabled: false }, fallback: true });
      return true;
    }
    logger.error(`[TenantSettings] Erro ao ${method === 'GET' ? 'obter' : 'salvar'} setting:`, err);
    sendJson(res, 500, { error: 'internal_error', message: `Erro ao ${method === 'GET' ? 'obter' : 'salvar'} setting` });
  }

  return true;
}

async function handleBackupRoute(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    requireTenant,
    logger,
    logAction,
    flows,
  } = deps;

  if (pathname !== '/api/backup/export' && pathname !== '/api/backup/import') {
    return false;
  }

  if ((method === 'GET' && pathname !== '/api/backup/export') || (method === 'POST' && pathname !== '/api/backup/import')) {
    return false;
  }

  if (!ensureConfigPermission(req, res, deps, method === 'GET' ? 'read' : 'update')) return true;

  const tenantId = requireTenant(req, res);
  if (!tenantId) return true;

  if (method === 'POST' && !hasJsonContentType(req)) {
    badRequest(res, 'Content-Type deve ser application/json');
    return true;
  }

  try {
    const { Flow, TenantSetting } = require('../db/models');
    const FlowModel = Flow();
    const TenantSettingModel = TenantSetting();

    if (method === 'GET') {
      const flowRows = await FlowModel.findAll({ where: { tenant_key: tenantId } });
      const flowsPayload = flowRows.map((row) => {
        const data = row.data && typeof row.data === 'object' ? row.data : {};
        return { ...data, id: row.id, tenantId };
      });
      const settingsRows = await TenantSettingModel.findAll({ where: { tenant_id: String(tenantId) } });
      const settings = settingsRows.map((row) => {
        const json = row.toJSON ? row.toJSON() : row;
        return { key: json.key, value: json.value || {} };
      });
      sendJson(res, 200, {
        ok: true,
        tenantId,
        exportedAt: new Date().toISOString(),
        flows: flowsPayload,
        settings,
      });
      return true;
    }

    const body = await parseJsonBody(req);
    const flowsInput = Array.isArray(body?.flows) ? body.flows : [];
    const settingsInput = Array.isArray(body?.settings) ? body.settings : [];
    const overwrite = body?.overwrite === true;
    let flowImported = 0;
    let flowSkipped = 0;
    let settingImported = 0;

    for (const flowInput of flowsInput) {
      if (!flowInput || !flowInput.id) {
        flowSkipped += 1;
        continue;
      }
      const nextFlow = { ...flowInput, tenantId };
      const existing = await FlowModel.findByPk(String(flowInput.id));
      if (existing && !overwrite) {
        flowSkipped += 1;
        continue;
      }
      const now = new Date();
      if (existing) {
        await existing.update({ tenant_key: tenantId, name: nextFlow.name || null, data: nextFlow, updated_at: now });
      } else {
        await FlowModel.create({ id: String(flowInput.id), tenant_key: tenantId, name: nextFlow.name || null, data: nextFlow, created_at: now, updated_at: now });
      }
      flows.set(String(flowInput.id), nextFlow);
      flowImported += 1;
    }

    for (const settingInput of settingsInput) {
      if (!settingInput || !settingInput.key) continue;
      const key = String(settingInput.key);
      const value = settingInput.value && typeof settingInput.value === 'object' ? settingInput.value : {};
      const existing = await TenantSettingModel.findOne({ where: { tenant_id: String(tenantId), key } });
      if (existing) {
        await existing.update({ value });
      } else {
        await TenantSettingModel.create({ tenant_id: String(tenantId), key, value });
      }
      settingImported += 1;
    }

    try {
      logAction({
        agentId: req.agent?.id || null,
        username: req.agent?.username || null,
        tenantId,
        action: 'backup_import',
        resource: 'tenant_backup',
        resourceId: tenantId,
        details: { flowImported, flowSkipped, settingImported, overwrite },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });
    } catch (_) {}

    sendJson(res, 200, { ok: true, flowImported, flowSkipped, settingImported, overwrite });
  } catch (err) {
    logger.error(`[Backup] Erro ao ${method === 'GET' ? 'exportar' : 'importar'} backup:`, err);
    sendJson(res, 500, { error: 'internal_error', message: `Erro ao ${method === 'GET' ? 'exportar' : 'importar'} backup` });
  }

  return true;
}

async function handleConfigAdminRoutes(ctx) {
  if (await handleNodeMarketplaceRoute(ctx)) return true;
  if (await handleTenantSettingsRoute(ctx)) return true;
  if (await handleBackupRoute(ctx)) return true;
  return false;
}

module.exports = {
  handleConfigAdminRoutes,
};