'use strict';

async function handleWhatsappWebhookRoutes(context = {}) {
  const {
    req,
    res,
    method,
    pathname,
    deps: {
      sendJson,
      parseJsonBody,
      logger,
      verifyWebhook,
      channelGatewayService,
      channelNormalizationService,
      handleWhatsAppInbound,
      saveSessionEventsToFile,
      sessionEvents,
      flows,
    },
  } = context;

  if (method === 'GET' && pathname === '/webhooks/whatsapp') {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const mode = urlObj.searchParams.get('hub.mode');
    const token = urlObj.searchParams.get('hub.verify_token');
    const challenge = urlObj.searchParams.get('hub.challenge');

    if (verifyWebhook(mode, token)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge || '');
      return true;
    }

    sendJson(res, 403, { error: 'forbidden' });
    return true;
  }

  if (method === 'POST' && pathname === '/webhooks/whatsapp') {
    try {
      const body = await parseJsonBody(req);

      if (body.object === 'whatsapp_business_account') {
        const entries = body.entry || [];
        for (const entry of entries) {
          const changes = entry.changes || [];
          for (const change of changes) {
            if (change.field === 'messages') {
              const value = change.value || {};
              if (Array.isArray(value.statuses) && value.statuses.length > 0) {
                await channelGatewayService.updateStatus('whatsapp', { value }).catch(() => null);
              }
              const messages = value.messages || [];
              for (const msg of messages) {
                const normalizedArr = channelNormalizationService.normalizeWhatsAppIncoming({ message: msg, value, raw: body });
                const normalized = normalizedArr && normalizedArr[0] ? normalizedArr[0] : null;

                await handleWhatsAppInbound({
                  source: 'cloud',
                  tenantId: null,
                  payload: { message: msg, value, raw: body },
                  normalized,
                  deps: {
                    flows,
                    sessionEvents,
                    saveSessionEvents: saveSessionEventsToFile,
                  },
                });
              }
            }
          }
        }
      }

      sendJson(res, 200, { success: true });
    } catch (err) {
      logger.error('Erro no webhook WhatsApp:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Erro interno ao processar webhook',
      });
    }
    return true;
  }

  return false;
}

module.exports = {
  handleWhatsappWebhookRoutes,
};
