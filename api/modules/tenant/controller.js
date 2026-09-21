function createTenantController({ requireAuth, requirePermission, service, emitEvent }) {
  function isDatabaseUnavailableError(err) {
    const text = String(err?.message || err || '').toLowerCase();
    return (
      text.includes('postgresql não está disponível')
      || text.includes('connectionmanager.getconnection was called after the connection manager was closed')
      || text.includes('connection manager was closed')
      || text.includes('connection terminated unexpectedly')
    );
  }

  function buildRequestMeta(req) {
    return {
      tenantId: req.tenantId || null,
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };
  }

  function handleError(err, res, next) {
    if (err.httpStatus) {
      res.status(err.httpStatus).json(err.payload || {
        error: err.code || 'internal_error',
        message: err.message,
      });
      return true;
    }

    if (isDatabaseUnavailableError(err)) {
      res.status(503).json({
        error: 'database_unavailable',
        message: 'Banco de dados indisponível temporariamente. Tente novamente em instantes.',
      });
      return true;
    }

    return next(err);
  }

  async function createTenant(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.createTenant({
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        requestMeta: buildRequestMeta(req),
      });

      res.status(payload.httpStatus || 201).json({ tenant: payload.tenant });
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function listTenants(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.listTenants({
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function getTenant(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.getTenant({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function getTenantContext(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.getTenantContext({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function updateTenant(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.updateTenant({
        tenantIdParam: req.params.tenantId,
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        requestMeta: buildRequestMeta(req),
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function deleteTenant(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.deleteTenant({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function getTenantUsage(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.getTenantUsage({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function updateTenantContext(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.updateTenantContext({
        tenantIdParam: req.params.tenantId,
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        requestMeta: buildRequestMeta(req),
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function getPlanUsage(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.getPlanUsage({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function suspendTenant(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.suspendTenant({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
        requestMeta: buildRequestMeta(req),
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function reactivateTenant(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.reactivateTenant({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
        requestMeta: buildRequestMeta(req),
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function changePlan(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.changePlan({
        tenantIdParam: req.params.tenantId,
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        requestMeta: buildRequestMeta(req),
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function generateByAi(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.generateByAi({
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        headers: req.headers || {},
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function getAiProviderStatus(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.getAiProviderStatus({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function getAiConfig(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.getAiConfig({
        tenantIdParam: req.params.tenantId,
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function updateCurrentTenantAiConfig(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const permResult = requirePermission(req, 'config', 'update');
      const payload = await service.updateCurrentTenantAiConfig({
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        canUpdateConfig: !!permResult?.allowed,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function saveCurrentTenantAiCredentials(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const permResult = requirePermission(req, 'config', 'update');
      const payload = await service.saveCurrentTenantAiCredentials({
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        canUpdateConfig: !!permResult?.allowed,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function saveTenantAiCredentials(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.saveTenantAiCredentials({
        tenantIdParam: req.params.tenantId,
        payload: req.body || {},
        agent: authResult.agent || req.agent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  async function testTenantAiCredentials(req, res, next) {
    try {
      const authResult = requireAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: 'unauthorized', message: authResult.error });
        return;
      }

      const payload = await service.testTenantAiCredentials({
        tenantIdParam: req.params.tenantId,
        payload: req.body || {},
        agent: authResult.agent || req.agent,
        headers: req.headers || {},
        emitEvent,
      });

      res.status(200).json(payload);
    } catch (err) {
      handleError(err, res, next);
    }
  }

  return {
    createTenant,
    listTenants,
    getTenant,
    getTenantContext,
    updateTenant,
    deleteTenant,
    getTenantUsage,
    updateTenantContext,
    getPlanUsage,
    suspendTenant,
    reactivateTenant,
    changePlan,
    generateByAi,
    getAiProviderStatus,
    getAiConfig,
    updateCurrentTenantAiConfig,
    saveCurrentTenantAiCredentials,
    saveTenantAiCredentials,
    testTenantAiCredentials,
  };
}

module.exports = {
  createTenantController,
};
