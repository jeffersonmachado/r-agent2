'use strict';

const { createChannelWebhookRoutes } = require('../../modules/channel-webhook/routes');
const { pickRouteDeps } = require('../shared/pickRouteDeps');

function createChannelWebhookExpressRouter({ buildExtendedRoutingContext }) {
  return createChannelWebhookRoutes({
    buildDeps: (req, res) => {
      const ctx = buildExtendedRoutingContext(req, res);
      return pickRouteDeps(ctx, [
        'requireAuth',
        'sendJson',
        'badRequest',
        'hasJsonContentType',
        'parseJsonBody',
        'logger',
        'verifyWebhook',
        'processWhatsAppMessage',
        'verifyMessengerWebhook',
        'sendMessengerMessage',
        'sendMessengerButtons',
        'verifyInstagramWebhook',
        'sendInstagramMessage',
        'sendInstagramMedia',
        'channelNormalizationService',
        'channelGatewayService',
        'resolveOrCreateTicketFromIncomingMessage',
        'appendTicketMessage',
        'autoAssignTicket',
        'emitEvent',
        'flows',
        'sessionEvents',
        'saveSessionEventsToFile',
      ]);
    },
  });
}

module.exports = {
  createChannelWebhookExpressRouter,
};
