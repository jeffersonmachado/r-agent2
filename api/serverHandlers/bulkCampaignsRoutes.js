module.exports = { handleBulkCampaignsRoutes };

async function handleBulkCampaignsRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    requireTenant,
    requirePermission,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    logAction,
    listCampaigns,
    getCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    startCampaign,
    pauseCampaign,
    resumeCampaign,
  } = deps;

  // GET /bulk-campaigns - Lista campanhas
  if (method === 'GET' && pathname === '/bulk-campaigns') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const urlObj = new URL(req.url || '/', 'http://localhost');
    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    
    const filters = {
      tenantId,
      status: urlObj.searchParams.get('status') || undefined,
      createdBy: urlObj.searchParams.get('createdBy') || undefined,
    };

    const campaigns = listCampaigns(filters);
    sendJson(res, 200, { campaigns });
    return true;
  }

  // GET /bulk-campaigns/:id - Obtém campanha específica
  if (method === 'GET' && pathname.startsWith('/bulk-campaigns/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'read');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length));
    const campaign = getCampaign(id);
    
    if (!campaign) {
      sendJson(res, 404, { error: 'campaign_not_found' });
      return true;
    }

    const tenantId = requireTenant(req, res);
    if (!tenantId) return true;
    if (campaign.tenantId !== tenantId) {
      sendJson(res, 404, { error: 'campaign_not_found' });
      return true;
    }

    sendJson(res, 200, { campaign });
    return true;
  }

  // POST /bulk-campaigns - Cria campanha
  if (method === 'POST' && pathname === '/bulk-campaigns') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'create');
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
      const tenantId = req.agent?.tenantId ? String(req.agent.tenantId).trim() : null;
      if (!tenantId) {
        sendJson(res, 403, { error: 'forbidden', message: 'tenantId é obrigatório' });
        return true;
      }
      
      const result = createCampaign({
        ...body,
        tenantId,
        createdBy: req.agent.id,
      });

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'bulk_campaign_create',
        resource: 'bulk_campaign',
        resourceId: result.campaign.id,
        details: { recipients: result.campaign.totalRecipients },
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 201, result.campaign);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao criar campanha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // PUT /bulk-campaigns/:id - Atualiza campanha
  if (method === 'PUT' && pathname.startsWith('/bulk-campaigns/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length));
      const body = await parseJsonBody(req);
      const result = updateCampaign(id, body);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      logAction({
        agentId: req.agent.id,
        username: req.agent.username,
        action: 'bulk_campaign_update',
        resource: 'bulk_campaign',
        resourceId: id,
        ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
      });

      sendJson(res, 200, result.campaign);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao atualizar campanha:', err);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    return true;
  }

  // DELETE /bulk-campaigns/:id - Remove campanha
  if (method === 'DELETE' && pathname.startsWith('/bulk-campaigns/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'delete');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length));
    const result = deleteCampaign(id);

    if (!result.success) {
      badRequest(res, result.error);
      return true;
    }

    logAction({
      agentId: req.agent.id,
      username: req.agent.username,
      action: 'bulk_campaign_delete',
      resource: 'bulk_campaign',
      resourceId: id,
      ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    });

    sendJson(res, 200, { success: true });
    return true;
  }

  // POST /bulk-campaigns/:id/start - Inicia campanha
  if (method === 'POST' && pathname.startsWith('/bulk-campaigns/') && pathname.endsWith('/start')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length, -'/start'.length));
      const result = await startCampaign(id);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao iniciar campanha:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // POST /bulk-campaigns/:id/pause - Pausa campanha
  if (method === 'POST' && pathname.startsWith('/bulk-campaigns/') && pathname.endsWith('/pause')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length, -'/pause'.length));
      const result = pauseCampaign(id);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao pausar campanha:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  // POST /bulk-campaigns/:id/resume - Retoma campanha
  if (method === 'POST' && pathname.startsWith('/bulk-campaigns/') && pathname.endsWith('/resume')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    const permResult = requirePermission(req, 'bulk_messaging', 'update');
    if (!permResult.allowed) {
      sendJson(res, 403, { error: 'forbidden', message: permResult.error });
      return true;
    }

    try {
      const id = decodeURIComponent(pathname.slice('/bulk-campaigns/'.length, -'/resume'.length));
      const result = resumeCampaign(id);

      if (!result.success) {
        badRequest(res, result.error);
        return true;
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro ao retomar campanha:', err);
      sendJson(res, 500, { error: 'internal_error' });
    }
    return true;
  }

  return false;
}
