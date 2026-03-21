'use strict';

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

async function handleWhatsAppIvrRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    crypto,
  } = deps;

  if (method === 'GET' && pathname === '/whatsapp/ivr') {
    if (!ensureConfigPermission(req, res, deps, 'read')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const service = require('../../services/tenantSettingsService');
      const out = await service.getSetting({ tenantId, key: 'whatsapp_ivr' });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      const value = out.value && typeof out.value === 'object' ? out.value : {};
      sendJson(res, 200, {
        ok: true,
        value: {
          enabled: value.enabled === true,
          departments: Array.isArray(value.departments) ? value.departments : [],
          rules: Array.isArray(value.rules) ? value.rules : [],
        },
      });
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao obter setting:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter setting' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/ivr') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const value = {
        enabled: body && body.enabled === true,
        departments: Array.isArray(body?.departments) ? body.departments : [],
        rules: Array.isArray(body?.rules) ? body.rules : [],
      };
      const service = require('../../services/tenantSettingsService');
      const out = await service.upsertSetting({ tenantId, key: 'whatsapp_ivr', value });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, value: out.value });
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao salvar setting:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar setting' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/ivr/department') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const name = body && body.name ? String(body.name).trim() : '';
      const queue = body && body.queue ? String(body.queue).trim() : '';
      if (!name || !queue) {
        badRequest(res, 'name e queue são obrigatórios');
        return true;
      }
      const id = body && body.id ? String(body.id).trim() : `wivr-dept-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const enabled = body && body.enabled !== undefined ? body.enabled === true : true;

      const service = require('../../services/tenantSettingsService');
      const current = await service.getSetting({ tenantId, key: 'whatsapp_ivr' });
      const value = current.value && typeof current.value === 'object' ? current.value : {};
      const departments = Array.isArray(value.departments) ? value.departments : [];
      const existingIndex = departments.findIndex((d) => d && d.id === id);
      const next = { id, name, queue, enabled };
      if (existingIndex >= 0) {
        departments[existingIndex] = { ...departments[existingIndex], ...next };
      } else {
        departments.push(next);
      }
      const out = await service.upsertSetting({
        tenantId,
        key: 'whatsapp_ivr',
        value: {
          enabled: value.enabled === true,
          departments,
          rules: Array.isArray(value.rules) ? value.rules : [],
        },
      });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, department: next, value: out.value });
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao salvar departamento:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar departamento' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/ivr/rule') {
    if (!ensureConfigPermission(req, res, deps, 'update')) return true;
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const keyword = body && body.keyword ? String(body.keyword).trim() : '';
      const departmentId = body && body.departmentId ? String(body.departmentId).trim() : '';
      if (!keyword || !departmentId) {
        badRequest(res, 'keyword e departmentId são obrigatórios');
        return true;
      }
      const id = body && body.id ? String(body.id).trim() : `wivr-rule-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
      const enabled = body && body.enabled !== undefined ? body.enabled === true : true;
      const priority = body && body.priority != null ? Number(body.priority) : 0;

      const service = require('../../services/tenantSettingsService');
      const current = await service.getSetting({ tenantId, key: 'whatsapp_ivr' });
      const value = current.value && typeof current.value === 'object' ? current.value : {};
      const rules = Array.isArray(value.rules) ? value.rules : [];
      const existingIndex = rules.findIndex((r) => r && r.id === id);
      const next = { id, keyword, departmentId, priority, enabled };
      if (existingIndex >= 0) {
        rules[existingIndex] = { ...rules[existingIndex], ...next };
      } else {
        rules.push(next);
      }
      const out = await service.upsertSetting({
        tenantId,
        key: 'whatsapp_ivr',
        value: {
          enabled: value.enabled === true,
          departments: Array.isArray(value.departments) ? value.departments : [],
          rules,
        },
      });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, { ok: true, rule: next, value: out.value });
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao salvar regra:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar regra' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleWhatsAppIvrRoutes,
};
