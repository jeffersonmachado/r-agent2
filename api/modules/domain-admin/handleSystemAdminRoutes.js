async function handleSystemAdminRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    clearLimitersCache,
    clearRedisRateLimitKeys,
    config,
    requireAuth,
    requirePermission,
    sendJson,
    logger,
  } = deps;

  if (method === 'POST' && pathname === '/admin/rate-limit/clear-cache') {
    try {
      clearLimitersCache();
      logger.info('[Admin] Cache de rate limiters limpo via endpoint');
      sendJson(res, 200, {
        success: true,
        message: 'Cache de rate limiters limpo com sucesso',
      });
    } catch (err) {
      logger.error('[Admin] Erro ao limpar cache de rate limiters:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao limpar cache',
      });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/admin/rate-limit/clear') {
    const nodeEnv = config.get('nodeEnv', 'development');
    if (nodeEnv !== 'development') {
      sendJson(res, 403, {
        error: 'forbidden',
        message: 'Este endpoint está disponível apenas em desenvolvimento',
      });
      return true;
    }

    try {
      const deletedCount = await clearRedisRateLimitKeys();
      logger.info('[Admin] Rate limit do Redis limpo via endpoint', { deletedCount });
      sendJson(res, 200, {
        success: true,
        message: `Rate limit limpo com sucesso. ${deletedCount} chave(s) removida(s).`,
        deletedCount,
      });
    } catch (err) {
      logger.error('[Admin] Erro ao limpar rate limit do Redis:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao limpar rate limit',
      });
    }
    return true;
  }

  if (method === 'GET' && pathname === '/system/channel-health') {
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

    try {
      const urlObj = new URL(req.url || '/', 'http://localhost');
      const windowMinutes = parseInt(urlObj.searchParams.get('windowMinutes') || '10', 10);
      const { getChannelHealth } = require('../../services/channelHealthService');
      const health = await getChannelHealth({ tenantId: req.tenantId, windowMinutes });
      const { areCredentialsValid } = require('../../services/whatsappService');

      let outboundPendingCount = 0;
      let outboundFailedCount = 0;
      let recentErrors = [];

      try {
        const { OutboundQueueItem } = require('../../db/models');
        const Model = typeof OutboundQueueItem === 'function' ? OutboundQueueItem() : OutboundQueueItem;
        const sequelize = Model.sequelize;

        const [pending] = await sequelize.query(
          `SELECT COUNT(*)::int AS c FROM outbound_queue WHERE tenant_key = :t AND status = 'pending'`,
          { replacements: { t: req.tenantId } }
        );
        outboundPendingCount = pending?.[0]?.c ?? 0;

        const [failed] = await sequelize.query(
          `SELECT COUNT(*)::int AS c FROM outbound_queue WHERE tenant_key = :t AND status = 'failed'`,
          { replacements: { t: req.tenantId } }
        );
        outboundFailedCount = failed?.[0]?.c ?? 0;

        const [errs] = await sequelize.query(
          `SELECT id, channel_type, last_error, attempts, next_attempt_at, updated_at
           FROM outbound_queue
           WHERE tenant_key = :t AND last_error IS NOT NULL
           ORDER BY updated_at DESC
           LIMIT 10`,
          { replacements: { t: req.tenantId } }
        );
        recentErrors = Array.isArray(errs) ? errs : [];
      } catch (_) {}

      sendJson(res, 200, {
        ...health,
        whatsapp: { areCredentialsValid: areCredentialsValid() },
        outbound: {
          pendingCount: outboundPendingCount,
          failedCount: outboundFailedCount,
          recentErrors,
        },
      });
    } catch (err) {
      logger.error('Erro ao obter channel-health:', err);
      sendJson(res, 500, { error: 'internal_error', message: err.message });
    }
    return true;
  }

  return false;
}

module.exports = { handleSystemAdminRoutes };
