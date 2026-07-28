'use strict';

const { scrapeUrl, scrapeUrls } = require('../../services/webScrapingService');
const {
  getAvailableEvents,
  listWebhooks,
  getWebhook,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  triggerWebhooks,
} = require('../../services/webhookService');
const { verifyWebhook } = require('../../services/whatsappService');
const { processWhatsAppMessage } = require('../../services/messageProcessor');
const {
  verifyMessengerWebhook,
  sendMessengerMessage,
  sendMessengerButtons,
} = require('../../services/messengerService');
const {
  verifyInstagramWebhook,
  sendInstagramMessage,
  sendInstagramMedia,
} = require('../../services/instagramService');
const channelNormalizationService = require('../../services/channelNormalizationService');
const channelGatewayService = require('../../services/channelGatewayService');
const {
  resolveOrCreateTicketFromIncomingMessage,
  appendTicketMessage,
} = require('../../services/conversationTicketLinkService');
const { autoAssign: autoAssignTicket } = require('../../services/assignmentService');

function buildExtendedChannelDeps(localDeps) {
  const { flows, sessionEvents, sessionTenants, saveSessionEventsToFile } = localDeps;

  return {
    scrapeUrl,
    scrapeUrls,
    getAvailableEvents,
    listWebhooks,
    getWebhook,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    triggerWebhooks,
    verifyWebhook,
    processWhatsAppMessage,
    verifyMessengerWebhook,
    sendMessengerMessage,
    sendMessengerButtons,
    verifyInstagramWebhook,
    sendInstagramMessage,
    sendInstagramMedia,
    channelNormalizationService,
    channelGatewayService,
    resolveOrCreateTicketFromIncomingMessage,
    appendTicketMessage,
    autoAssignTicket,
    flows,
    sessionEvents,
    sessionTenants,
    saveSessionEventsToFile,
  };
}

module.exports = {
  buildExtendedChannelDeps,
};
