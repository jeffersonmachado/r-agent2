'use strict';

const crypto = require('crypto');
const { emitWhatsappIvrUpdated } = require('./whatsappShared');

async function handleWhatsappIvrRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      requirePermission,
      sendJson,
      hasJsonContentType,
      parseJsonBody,
      logger,
      requireTenant,
      badRequest,
    },
  } = context;

  if (method === 'GET' && pathname === '/whatsapp/ivr') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    try {
      const whatsappIvrService = require('../../services/whatsappIvrService');
      const out = await whatsappIvrService.getNormalizedWhatsAppIvrSetting({ tenantId });
      if (!out.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: out.error || 'settings_unavailable' });
        return true;
      }
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao obter setting:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter setting' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/ivr') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const whatsappIvrService = require('../../services/whatsappIvrService');
      const out = await whatsappIvrService.saveWhatsAppIvrSetting({ tenantId, payload: body || {} });
      if (!out.ok) {
        const status = out.error === 'validation_error' ? 400 : 503;
        sendJson(res, status, {
          error: out.error || 'service_unavailable',
          message: out.error === 'validation_error' ? 'Configuracao invalida' : (out.error || 'settings_unavailable'),
          details: out.details || [],
          warnings: out.warnings || [],
        });
        return true;
      }
      await emitWhatsappIvrUpdated(tenantId, out);
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao salvar setting:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar setting' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/ivr/department') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const whatsappIvrService = require('../../services/whatsappIvrService');
      const current = await whatsappIvrService.getNormalizedWhatsAppIvrSetting({ tenantId });
      if (!current.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: current.error || 'settings_unavailable' });
        return true;
      }

      const availableDepartments = Array.isArray(current.departments) ? current.departments : [];
      const bindingDepartmentId = body && body.departmentId ? String(body.departmentId).trim() : '';
      const byId = new Map(availableDepartments.map((item) => [String(item.id), item]));
      let targetDepartment = bindingDepartmentId ? byId.get(bindingDepartmentId) : null;
      if (!targetDepartment && body?.id) targetDepartment = byId.get(String(body.id).trim()) || null;
      if (!targetDepartment && body?.name) {
        const normalizedName = String(body.name).trim().toLowerCase();
        targetDepartment = availableDepartments.find((item) => String(item.name || '').trim().toLowerCase() === normalizedName) || null;
      }
      if (!targetDepartment) {
        const departmentRefId = body?.departmentId
          ? String(body.departmentId).trim()
          : (body?.id
            ? String(body.id).trim()
            : `wivr-dept-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
        const departmentRefName = body?.name ? String(body.name).trim() : '';
        if (!departmentRefId || !departmentRefName) {
          badRequest(res, 'departmentId oficial invalido');
          return true;
        }

        const nextConfig = {
          ...current.value,
          departments: Array.isArray(current.value?.departments) ? current.value.departments.slice() : [],
        };
        const departmentIndex = nextConfig.departments.findIndex((item) => item && String(item.id || '') === departmentRefId);
        const pendingDepartment = {
          id: departmentRefId,
          name: departmentRefName,
          queue: body?.queue ? String(body.queue).trim() : (body?.defaultQueueName ? String(body.defaultQueueName).trim() : null),
          enabled: body?.enabled !== false,
        };
        if (departmentIndex >= 0) nextConfig.departments[departmentIndex] = { ...nextConfig.departments[departmentIndex], ...pendingDepartment };
        else nextConfig.departments.push(pendingDepartment);

        const out = await whatsappIvrService.saveWhatsAppIvrSetting({ tenantId, payload: nextConfig });
        if (!out.ok) {
          const status = out.error === 'validation_error' ? 400 : 503;
          sendJson(res, status, {
            error: out.error || 'service_unavailable',
            message: out.error === 'validation_error' ? 'Binding invalido' : (out.error || 'settings_unavailable'),
            details: out.details || [],
            warnings: out.warnings || [],
          });
          return true;
        }
        await emitWhatsappIvrUpdated(tenantId, out);
        sendJson(res, 200, {
          ok: true,
          binding: null,
          department: out.value?.departments?.find((item) => item && String(item.id || '') === departmentRefId) || pendingDepartment,
          value: out.value,
          warnings: out.warnings || [],
        });
        return true;
      }

      const nextConfig = {
        ...current.value,
        departmentBindings: Array.isArray(current.value?.departmentBindings) ? current.value.departmentBindings.slice() : [],
      };
      const index = nextConfig.departmentBindings.findIndex((item) => item && item.departmentId === targetDepartment.id);
      const nextBinding = {
        departmentId: targetDepartment.id,
        enabled: body?.enabled !== false,
        defaultQueueName: body?.defaultQueueName ? String(body.defaultQueueName).trim() : (body?.queue ? String(body.queue).trim() : null),
        queueStrategy: body?.queueStrategy ? String(body.queueStrategy).trim() : 'default',
        menuLabel: body?.menuLabel ? String(body.menuLabel).trim() : targetDepartment.name,
        menuDescription: body?.menuDescription ? String(body.menuDescription).trim() : '',
        menuOrder: body?.menuOrder != null ? Number(body.menuOrder) : (index >= 0 ? nextConfig.departmentBindings[index].menuOrder : (nextConfig.departmentBindings.length + 1)),
        aliases: Array.isArray(body?.aliases) ? body.aliases : [],
        businessHoursOverride: body?.businessHoursOverride || null,
      };
      if (index >= 0) nextConfig.departmentBindings[index] = { ...nextConfig.departmentBindings[index], ...nextBinding };
      else nextConfig.departmentBindings.push(nextBinding);

      const out = await whatsappIvrService.saveWhatsAppIvrSetting({ tenantId, payload: nextConfig });
      if (!out.ok) {
        const status = out.error === 'validation_error' ? 400 : 503;
        sendJson(res, status, {
          error: out.error || 'service_unavailable',
          message: out.error === 'validation_error' ? 'Binding invalido' : (out.error || 'settings_unavailable'),
          details: out.details || [],
          warnings: out.warnings || [],
        });
        return true;
      }
      await emitWhatsappIvrUpdated(tenantId, out);
      sendJson(res, 200, {
        ok: true,
        binding: out.value.departmentBindings.find((item) => item.departmentId === targetDepartment.id) || null,
        value: out.value,
        warnings: out.warnings || [],
      });
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao salvar departamento:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar departamento' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/whatsapp/ivr/rule') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    const permResult = requirePermission(req, 'config', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }
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
      const whatsappIvrService = require('../../services/whatsappIvrService');
      const current = await whatsappIvrService.getNormalizedWhatsAppIvrSetting({ tenantId });
      if (!current.ok) {
        sendJson(res, 503, { error: 'service_unavailable', message: current.error || 'settings_unavailable' });
        return true;
      }

      const hasOfficialDepartment = Array.isArray(current.departments)
        && current.departments.some((item) => item && String(item.id || '') === departmentId);

      const nextConfig = {
        ...current.value,
        rules: Array.isArray(current.value?.rules) ? current.value.rules.slice() : [],
      };

      if (!hasOfficialDepartment) {
        nextConfig.departments = Array.isArray(current.value?.departments) ? current.value.departments.slice() : [];
        const hasLegacy = nextConfig.departments.some((item) => item && String(item.id || '') === departmentId);
        if (!hasLegacy) {
          nextConfig.departments.push({
            id: departmentId,
            name: departmentId,
            queue: null,
            enabled: true,
          });
        }
      }

      const existingIndex = nextConfig.rules.findIndex((r) => r && r.id === id);
      const next = { id, keyword, departmentId, priority, enabled };
      if (existingIndex >= 0) nextConfig.rules[existingIndex] = { ...nextConfig.rules[existingIndex], ...next };
      else nextConfig.rules.push(next);

      const out = await whatsappIvrService.saveWhatsAppIvrSetting({ tenantId, payload: nextConfig });
      if (!out.ok) {
        const status = out.error === 'validation_error' ? 400 : 503;
        sendJson(res, status, {
          error: out.error || 'service_unavailable',
          message: out.error === 'validation_error' ? 'Regra invalida' : (out.error || 'settings_unavailable'),
          details: out.details || [],
          warnings: out.warnings || [],
        });
        return true;
      }
      await emitWhatsappIvrUpdated(tenantId, out);
      sendJson(res, 200, { ok: true, rule: next, value: out.value, warnings: out.warnings || [] });
    } catch (err) {
      logger.error('[WhatsAppIVR] Erro ao salvar regra:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao salvar regra' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleWhatsappIvrRoutes,
};
