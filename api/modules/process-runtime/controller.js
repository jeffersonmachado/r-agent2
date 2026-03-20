'use strict';

function decodeExecutionId(req) {
  return decodeURIComponent(String(req.params.executionId || ''));
}

function createProcessRuntimeController({ service, deps }) {
  function ensureAuth(req, res) {
    const authResult = deps.requireAuth(req);
    if (!authResult.valid) {
      deps.sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return false;
    }
    return true;
  }

  function ensurePermission(req, res, resource, action) {
    const permResult = deps.requirePermission(req, resource, action);
    if (!permResult.allowed) {
      deps.sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return false;
    }
    return true;
  }

  function ensureJson(req, res) {
    if (!deps.hasJsonContentType(req)) {
      deps.badRequest(res, 'Content-Type deve ser application/json');
      return false;
    }
    return true;
  }

  function requireTenantOrReturn(req, res) {
    return deps.requireTenant(req, res);
  }

  return {
    async listInstances(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const filters = service.parseListInstances(req.url);
        const out = await service.listProcessInstances({ tenantId, ...filters });
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao listar instâncias:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar instâncias' });
      }
    },

    async start(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'config', 'update')) return;
      if (!ensureJson(req, res)) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const payload = service.parseRuntimePayload(await deps.parseJsonBody(req));
        const out = await service.startDurableProcess({ tenantId, ...payload });
        if (!out.ok) {
          deps.sendJson(res, 400, {
            error: out.error || 'durable_start_failed',
            message: out.error || 'Não foi possível iniciar o processo',
          });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao iniciar processo:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao iniciar processo' });
      }
    },

    async analytics(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const filters = service.parseAnalytics(req.url);
        if (!filters.processId) {
          deps.badRequest(res, 'processId é obrigatório');
          return;
        }
        const out = await service.getProcessAnalytics({ tenantId, ...filters });
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao calcular analytics:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao calcular analytics' });
      }
    },

    async simulate(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'analytics', 'read')) return;
      if (!ensureJson(req, res)) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const payload = service.parseRuntimePayload(await deps.parseJsonBody(req));
        const out = await service.simulateProcessDefinition({
          tenantId,
          processId: payload.processId,
          processDefinition: payload.processDefinition,
          processVersion: payload.processVersion,
        });
        if (!out.ok) {
          deps.sendJson(res, 400, { error: out.error || 'simulation_failed', message: out.error || 'Não foi possível simular o processo' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao simular processo:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao simular processo' });
      }
    },

    async intelligence(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'analytics', 'read')) return;
      if (!ensureJson(req, res)) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const payload = service.parseRuntimePayload(await deps.parseJsonBody(req));
        const out = await service.getProcessIntelligence({
          tenantId,
          processId: payload.processId,
          processDefinition: payload.processDefinition,
          processVersion: payload.processVersion,
        });
        if (!out.ok) {
          deps.sendJson(res, 400, { error: out.error || 'intelligence_failed', message: out.error || 'Não foi possível analisar o processo' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao gerar intelligence:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao gerar intelligence' });
      }
    },

    async resumeExternal(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'config', 'update')) return;
      if (!ensureJson(req, res)) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const body = await deps.parseJsonBody(req);
        const correlationKey = body?.correlationKey ? String(body.correlationKey).trim() : '';
        if (!correlationKey) {
          deps.badRequest(res, 'correlationKey é obrigatório');
          return;
        }
        const out = await service.resumeExternalProcessEvent(correlationKey, body?.payload || {}, tenantId);
        if (!out.ok) {
          deps.sendJson(res, 404, { error: out.error || 'resume_external_failed', message: out.error || 'Instância não encontrada' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao retomar evento externo:', err);
        deps.sendJson(res, 400, { error: err.code || 'resume_external_failed', message: err.message || 'Erro ao retomar evento externo' });
      }
    },

    async getInstance(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const executionId = decodeExecutionId(req);
        if (!executionId) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'executionId obrigatório' });
          return;
        }
        const out = await service.getProcessInstance(executionId, tenantId);
        if (!out.ok) {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Instância não encontrada' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao inspecionar instância:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao inspecionar instância' });
      }
    },

    async getHistory(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'analytics', 'read')) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const executionId = decodeExecutionId(req);
        if (!executionId) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'executionId obrigatório' });
          return;
        }
        const out = await service.getProcessInstanceHistory(executionId, tenantId, service.parseHistory(req.url));
        if (!out.ok) {
          deps.sendJson(res, 404, { error: 'not_found', message: 'Instância não encontrada' });
          return;
        }
        deps.sendJson(res, 200, { ok: true, history: out.history });
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao obter histórico:', err);
        deps.sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter histórico' });
      }
    },

    async cancel(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'config', 'update')) return;
      if (!ensureJson(req, res)) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const executionId = decodeExecutionId(req);
        if (!executionId) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'executionId obrigatório' });
          return;
        }
        const body = await deps.parseJsonBody(req);
        const out = await service.cancelProcessInstance(
          executionId,
          body?.reason || 'cancelled',
          { actorId: req.agent?.id || null },
          tenantId
        );
        if (!out.ok) {
          deps.sendJson(res, 404, { error: out.error || 'cancel_failed', message: out.error || 'Instância não encontrada' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao cancelar instância:', err);
        deps.sendJson(res, 400, { error: err.code || 'cancel_failed', message: err.message || 'Erro ao cancelar instância' });
      }
    },

    async resume(req, res) {
      if (!ensureAuth(req, res) || !ensurePermission(req, res, 'config', 'update')) return;
      if (!ensureJson(req, res)) return;
      try {
        const tenantId = requireTenantOrReturn(req, res);
        if (!tenantId) return;
        const executionId = decodeExecutionId(req);
        if (!executionId) {
          deps.sendJson(res, 400, { error: 'bad_request', message: 'executionId obrigatório' });
          return;
        }
        const body = await deps.parseJsonBody(req);
        const out = await service.resumeProcessInstance(executionId, body?.payload || body || {}, tenantId);
        if (!out.ok) {
          deps.sendJson(res, 404, { error: out.error || 'resume_failed', message: out.error || 'Instância não encontrada' });
          return;
        }
        deps.sendJson(res, 200, out);
      } catch (err) {
        deps.logger.error('[ProcessRuntime] Erro ao retomar instância:', err);
        deps.sendJson(res, 400, { error: err.code || 'resume_failed', message: err.message || 'Erro ao retomar instância' });
      }
    },
  };
}

module.exports = {
  createProcessRuntimeController,
};
