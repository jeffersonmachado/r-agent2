'use strict';

const logger = require('../../utils/logger');
const { getSequelize } = require('../../db/sequelize');
const { ChannelConversation: ChannelConversationGetter } = require('../../db/models');
const { safeToString, safeErrorMessage } = require('../../utils/defensiveCoercion');

function dbAvailable() {
  return !!getSequelize();
}

async function updateConversationForTicket(ticket, patch = {}) {
  if (!ticket || !ticket.conversationId) return;
  if (!dbAvailable()) return;

  try {
    const ConversationModel = typeof ChannelConversationGetter === 'function'
      ? ChannelConversationGetter()
      : ChannelConversationGetter;
    if (!ConversationModel) return;
    await ConversationModel.update(
      { ...patch, updated_at: new Date() },
      { where: { id: safeToString(ticket.conversationId), tenant_key: safeToString(ticket.tenantId) } },
    );
  } catch (err) {
    logger.debug('[QueueService] Falha ao atualizar channel_conversation (ignorado)', {
      ticketId: ticket.id,
      error: safeErrorMessage(err),
    });
  }
}

module.exports = {
  updateConversationForTicket,
};