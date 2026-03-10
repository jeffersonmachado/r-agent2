'use strict';

const { getUrl, buildOperationalPipelineService } = require('./shared');

async function handleOperationalPlaybookRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      requireAuth,
      requirePermission,
      isSuperAdmin,
      sendJson,
      hasJsonContentType,
      parseJsonBody,
      logger,
    },
  } = context;

  if (method === 'POST' && pathname === '/api/operational/playbooks/run') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const superAdmin = isSuperAdmin(req.agent);
    if (!superAdmin) {
      const permResult = requirePermission(req, 'tickets', 'update');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error || 'Sem permissão para executar playbook operacional' });
        return true;
      }
    }

    try {
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const playbookId = String(body?.playbookId || '').trim();
      const tenantId = superAdmin
        ? (String(body?.tenantId || '').trim() || req.tenantId || req.agent?.tenantId || null)
        : (req.tenantId || null);

      if (!playbookId) {
        sendJson(res, 400, { ok: false, error: 'playbook_id_required' });
        return true;
      }

      if (!tenantId) {
        sendJson(res, 400, { ok: false, error: 'tenant_required' });
        return true;
      }

      const pipeline = buildOperationalPipelineService();
      const out = await pipeline.startPlaybook(playbookId, {
        tenantId,
        contactId: body?.contactId,
        signalId: body?.signalId || null,
        recommendationId: body?.recommendationId || null,
        operatorId: req.agent?.id || req.agent?.username || null,
        accountId: body?.accountId || null,
        phoneNumber: body?.phoneNumber || null,
        teamId: body?.teamId || null,
        conversationId: body?.conversationId || null,
        ticketId: body?.ticketId || null,
        metadata: body?.metadata || {},
      });

      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('Erro ao executar playbook (/api/operational/playbooks/run):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/admin/playbooks') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar playbooks operacionais' });
      return true;
    }

    try {
      const url = getUrl(req);
      const tenantId = String(url.searchParams.get('tenantId') || '').trim();
      const contactId = String(url.searchParams.get('contactId') || '').trim();
      const signalType = String(url.searchParams.get('signalType') || '').trim();
      const limit = Number(url.searchParams.get('limit') || 12);
      const { operationalPlaybookEngine } = require('../../core/operational-playbooks');

      if (tenantId && contactId) {
        const out = await operationalPlaybookEngine.listSuggestedPlaybooksForContact({ tenantId, contactId, limit });
        sendJson(res, out.ok ? 200 : 400, out);
        return true;
      }

      const out = operationalPlaybookEngine.listPlaybooks({ signalType: signalType || null });
      sendJson(res, 200, out);
    } catch (err) {
      logger.error('Erro ao listar playbooks operacionais (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'GET' && pathname.match(/^\/api\/admin\/playbooks\/[^/]+$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!isSuperAdmin(req.agent)) {
      sendJson(res, 403, { error: 'forbidden', message: 'Apenas Super Admin pode acessar playbooks operacionais' });
      return true;
    }

    try {
      const playbookId = decodeURIComponent(pathname.slice('/api/admin/playbooks/'.length));
      const { operationalPlaybookEngine } = require('../../core/operational-playbooks');
      const listOut = operationalPlaybookEngine.listPlaybooks();
      const item = (listOut.items || []).find((playbook) => String(playbook.id) === String(playbookId));
      if (!item) {
        sendJson(res, 404, { ok: false, error: 'playbook_not_found' });
        return true;
      }
      const stepsOut = operationalPlaybookEngine.getPlaybookSteps(playbookId);
      sendJson(res, 200, {
        ok: true,
        item,
        steps: stepsOut.items || [],
      });
    } catch (err) {
      logger.error('Erro ao carregar playbook operacional (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/playbooks\/[^/]+\/execute$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const superAdmin = isSuperAdmin(req.agent);
    if (!superAdmin) {
      const permResult = requirePermission(req, 'tickets', 'update');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error || 'Sem permissão para executar playbook operacional' });
        return true;
      }
    }

    try {
      const playbookId = decodeURIComponent(pathname.slice('/api/admin/playbooks/'.length, -'/execute'.length));
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const tenantId = superAdmin
        ? (body?.tenantId || null)
        : (req.tenantId || body?.tenantId || null);

      if (!superAdmin && String(tenantId || '') !== String(req.tenantId || '')) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenant_mismatch' });
        return true;
      }

      const pipeline = buildOperationalPipelineService();
      const out = await pipeline.startPlaybook(playbookId, {
        tenantId,
        contactId: body?.contactId,
        signalId: body?.signalId,
        recommendationId: body?.recommendationId,
        operatorId: req.agent?.id || req.agent?.username || null,
        accountId: body?.accountId || null,
        phoneNumber: body?.phoneNumber || null,
        teamId: body?.teamId || null,
        conversationId: body?.conversationId || null,
        ticketId: body?.ticketId || null,
        metadata: body?.metadata || {},
      });

      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('Erro ao executar playbook operacional (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  if (method === 'POST' && pathname.match(/^\/api\/admin\/playbooks\/[^/]+\/step$/)) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const superAdmin = isSuperAdmin(req.agent);
    if (!superAdmin) {
      const permResult = requirePermission(req, 'tickets', 'update');
      if (!permResult.allowed) {
        sendJson(res, 403, { error: 'forbidden', message: permResult.error || 'Sem permissão para avançar playbook operacional' });
        return true;
      }
    }

    try {
      const playbookId = decodeURIComponent(pathname.slice('/api/admin/playbooks/'.length, -'/step'.length));
      const body = hasJsonContentType(req) ? await parseJsonBody(req).catch(() => ({})) : {};
      const tenantId = superAdmin
        ? (body?.tenantId || null)
        : (req.tenantId || body?.tenantId || null);

      if (!superAdmin && String(tenantId || '') !== String(req.tenantId || '')) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenant_mismatch' });
        return true;
      }

      const { operationalPlaybookEngine } = require('../../core/operational-playbooks');
      const out = await operationalPlaybookEngine.executePlaybookStep(playbookId, {
        tenantId,
        executionId: body?.executionId,
        stepId: body?.stepId || null,
        action: body?.action || 'next',
        context: {
          ...((body?.context && typeof body.context === 'object') ? body.context : {}),
          operatorId: req.agent?.id || req.agent?.username || null,
        },
      });
      sendJson(res, out.ok ? 200 : 400, out);
    } catch (err) {
      logger.error('Erro ao avançar playbook operacional (admin):', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleOperationalPlaybookRoutes,
};
