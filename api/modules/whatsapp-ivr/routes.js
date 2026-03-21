'use strict';

const express = require('express');

function ensureConfigPermission(req, res, deps, action) {
  const authResult = deps.requireAuth(req);
  if (!authResult.valid) {
    deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
    return false;
  }

  const permResult = deps.requirePermission(req, 'config', action);
  if (!permResult.allowed) {
    deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
    return false;
  }

  return true;
}

function createWhatsAppIvrRoutes({ buildDeps }) {
  const router = express.Router();

  router.get('/whatsapp/ivr', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'read')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;

    try {
      const service = require('../../services/tenantSettingsService');
      const out = await service.getSetting({ tenantId, key: 'whatsapp_ivr' });
      if (!out.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }
      const value = out.value && typeof out.value === 'object' ? out.value : {};
      deps.sendJson(res, 200, {
        ok: true,
        value: {
          enabled: value.enabled === true,
          departments: Array.isArray(value.departments) ? value.departments : [],
          rules: Array.isArray(value.rules) ? value.rules : [],
        },
      });
    } catch (err) {
      deps.logger.error('[WhatsAppIVR] Erro ao obter setting:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter setting' });
    }
  });

  router.post('/whatsapp/ivr', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'update')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const value = {
        enabled: body && body.enabled === true,
        departments: Array.isArray(body?.departments) ? body.departments : [],
        rules: Array.isArray(body?.rules) ? body.rules : [],
      };
      const service = require('../../services/tenantSettingsService');
      const out = await service.upsertSetting({ tenantId, key: 'whatsapp_ivr', value });
      if (!out.ok) {
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }
      deps.sendJson(res, 200, { ok: true, value: out.value });
    } catch (err) {
      deps.logger.error('[WhatsAppIVR] Erro ao salvar setting:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar setting' });
    }
  });

  router.post('/whatsapp/ivr/department', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'update')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const name = body && body.name ? String(body.name).trim() : '';
      const queue = body && body.queue ? String(body.queue).trim() : '';
      if (!name || !queue) {
        deps.badRequest(res, 'name e queue são obrigatórios');
        return;
      }

      const id = body && body.id
        ? String(body.id).trim()
        : `wivr-dept-${Date.now()}-${deps.crypto.randomBytes(4).toString('hex')}`;
      const enabled = body && body.enabled !== undefined ? body.enabled === true : true;

      const service = require('../../services/tenantSettingsService');
      const current = await service.getSetting({ tenantId, key: 'whatsapp_ivr' });
      const value = current.value && typeof current.value === 'object' ? current.value : {};
      const departments = Array.isArray(value.departments) ? value.departments : [];
      const existingIndex = departments.findIndex((item) => item && item.id === id);
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
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }

      deps.sendJson(res, 200, { ok: true, department: next, value: out.value });
    } catch (err) {
      deps.logger.error('[WhatsAppIVR] Erro ao salvar departamento:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar departamento' });
    }
  });

  router.post('/whatsapp/ivr/rule', async (req, res) => {
    const deps = buildDeps(req, res);
    if (!ensureConfigPermission(req, res, deps, 'update')) return;
    const tenantId = deps.requireTenant(req, res);
    if (!tenantId) return;
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return;
    }

    try {
      const body = await deps.parseJsonBody(req);
      const keyword = body && body.keyword ? String(body.keyword).trim() : '';
      const departmentId = body && body.departmentId ? String(body.departmentId).trim() : '';
      if (!keyword || !departmentId) {
        deps.badRequest(res, 'keyword e departmentId são obrigatórios');
        return;
      }

      const id = body && body.id
        ? String(body.id).trim()
        : `wivr-rule-${Date.now()}-${deps.crypto.randomBytes(4).toString('hex')}`;
      const enabled = body && body.enabled !== undefined ? body.enabled === true : true;
      const priority = body && body.priority != null ? Number(body.priority) : 0;

      const service = require('../../services/tenantSettingsService');
      const current = await service.getSetting({ tenantId, key: 'whatsapp_ivr' });
      const value = current.value && typeof current.value === 'object' ? current.value : {};
      const rules = Array.isArray(value.rules) ? value.rules : [];
      const existingIndex = rules.findIndex((item) => item && item.id === id);
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
        deps.sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return;
      }

      deps.sendJson(res, 200, { ok: true, rule: next, value: out.value });
    } catch (err) {
      deps.logger.error('[WhatsAppIVR] Erro ao salvar regra:', err);
      deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar regra' });
    }
  });

  return router;
}

module.exports = {
  createWhatsAppIvrRoutes,
};
