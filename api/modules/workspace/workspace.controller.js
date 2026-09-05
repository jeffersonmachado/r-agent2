'use strict';

const { getClassificationForAgent } = require('../agent-os/experience-segregation');

function createWorkspaceController({ service, deps }) {
  function ensure(req, res, action = 'read') {
    const auth = deps.requireAuth(req);
    if (!auth.valid) { deps.sendJson(res, 401, { error: 'unauthorized', message: auth.error }); return null; }
    const perm = deps.requirePermission(req, 'workspace', action);
    if (!perm.allowed) { deps.sendJson(res, 403, { error: 'forbidden', message: perm.error }); return null; }
    return deps.requireTenant(req, res);
  }
  function query(req) { return req.query || Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams.entries()); }
  async function body(req, res) { if (!deps.hasJsonContentType(req)) { deps.badRequest(res, 'Content-Type deve ser application/json'); const err = new Error('response_sent'); err.responseSent = true; throw err; } return deps.parseJsonBody(req); }
  async function run(req, res, action, fn, okStatus = 200) {
    const tenantId = ensure(req, res, action); if (!tenantId) return;
    try { await fn(tenantId); } catch (err) { if (err && err.responseSent) return; deps.logger.error('[Workspace] Erro na operacao', err); deps.sendJson(res, err.message && err.message.endsWith('_required') ? 400 : 500, { error: err.message || 'internal_error', message: 'Erro na operacao do workspace' }); }
  }

  return {
    listEntities: (req, res) => run(req, res, 'read', async (tenantId) => deps.sendJson(res, 200, { ok: true, ...(await service.listEntities(tenantId, query(req))) })),
    getEntity: (req, res) => run(req, res, 'read', async (tenantId) => {
      const entity = await service.getEntity(tenantId, req.params.id);
      if (!entity) return deps.sendJson(res, 404, { error: 'not_found', message: 'Entidade nao encontrada' });
      deps.sendJson(res, 200, { ok: true, entity });
    }),
    createEntity: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, entity: await service.createEntity(tenantId, await body(req, res)) }), 201),
    linkEntity: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, link: await service.linkEntity(tenantId, await body(req, res)) }), 201),
    timeline: (req, res) => run(req, res, 'read', async (tenantId) => {
      const result = await service.getTimeline(tenantId, req.params.id, query(req), { classification: getClassificationForAgent(req.agent) });
      if (!result) return deps.sendJson(res, 404, { error: 'not_found', message: 'Entidade nao encontrada' });
      deps.sendJson(res, 200, { ok: true, ...result });
    }),
    insights: (req, res) => run(req, res, 'insight', async (tenantId) => {
      const result = await service.getInsights(tenantId, req.params.id, { classification: getClassificationForAgent(req.agent) });
      if (!result) return deps.sendJson(res, 404, { error: 'not_found', message: 'Entidade nao encontrada' });
      deps.sendJson(res, 200, { ok: true, ...result });
    }),
    autocorrections: (req, res) => run(req, res, 'insight', async (tenantId) => {
      if (getClassificationForAgent(req.agent) !== 'DEVELOPMENT') {
        return deps.sendJson(res, 403, { error: 'classification_forbidden' });
      }
      const result = await service.getAutoCorrections(tenantId, req.params.id);
      if (!result) return deps.sendJson(res, 404, { error: 'not_found', message: 'Entidade nao encontrada' });
      deps.sendJson(res, 200, { ok: true, ...result });
    }),
    actions: (req, res) => run(req, res, 'action', async (tenantId) => deps.sendJson(res, 200, { ok: true, ...(await service.getActions(tenantId, req.params.id, { classification: getClassificationForAgent(req.agent) })) })),
    createAction: (req, res) => run(req, res, 'action', async (tenantId) => deps.sendJson(res, 201, { ok: true, action: await service.createAction(tenantId, await body(req, res)) }), 201),
    executeSuggestedActions: (req, res) => run(req, res, 'action', async (tenantId) => deps.sendJson(res, 201, { ok: true, ...(await service.executeSuggestedActions(tenantId, req.params.id, { classification: getClassificationForAgent(req.agent) })) }), 201),
    listTasks: (req, res) => run(req, res, 'read', async (tenantId) => deps.sendJson(res, 200, { ok: true, ...(await service.listTasks(tenantId, query(req))) })),
    createTask: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, task: await service.createTask(tenantId, await body(req, res)) }), 201),
    listTimesheet: (req, res) => run(req, res, 'read', async (tenantId) => deps.sendJson(res, 200, { ok: true, ...(await service.listTimesheetEntries(tenantId, query(req))) })),
    createTimesheet: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, entry: await service.createTimesheetEntry(tenantId, await body(req, res), req.agent?.id || req.agent?.username || null) }), 201),
    listResources: (req, res) => run(req, res, 'read', async (tenantId) => deps.sendJson(res, 200, { ok: true, ...(await service.listResources(tenantId, query(req))) })),
    createResource: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, resource: await service.createResource(tenantId, await body(req, res)) }), 201),
    createResourceAvailability: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, availability: await service.createResourceAvailability(tenantId, await body(req, res)) }), 201),
    listResourceBookings: (req, res) => run(req, res, 'read', async (tenantId) => deps.sendJson(res, 200, { ok: true, ...(await service.listResourceBookings(tenantId, query(req))) })),
    createResourceBooking: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, booking: await service.createResourceBooking(tenantId, await body(req, res)) }), 201),
    listPayments: (req, res) => run(req, res, 'read', async (tenantId) => deps.sendJson(res, 200, { ok: true, ...(await service.listPaymentEvents(tenantId, query(req))) })),
    createPayment: (req, res) => run(req, res, 'write', async (tenantId) => deps.sendJson(res, 201, { ok: true, payment: await service.createPaymentEvent(tenantId, await body(req, res)) }), 201),
  };
}

module.exports = { createWorkspaceController };
