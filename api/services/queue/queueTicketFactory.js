'use strict';

const { safeToString } = require('../../utils/defensiveCoercion');

function extractPhoneNumber(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  const match = sessionId.match(/^whatsapp_(.+)$/);
  return match ? match[1] : null;
}

function buildUserBootstrapMessage(lastUserMessage, now) {
  if (!lastUserMessage) return [];
  return [{
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: lastUserMessage,
    sender: 'user',
    timestamp: now,
  }];
}

function buildNewQueueTicket({ id, tenantId, sessionId, queue, lastUserMessage, context = {}, tags = [], category = null, now }) {
  return {
    id,
    tenantId,
    sessionId,
    conversationId: context.conversationId || null,
    channelType: context.channelType || (sessionId && safeToString(sessionId, '').startsWith('whatsapp_') ? 'whatsapp' : null),
    queue,
    status: 'waiting',
    mode: context.mode || 'human',
    pauseReason: context.pauseReason || null,
    takeoverAt: context.takeoverAt || null,
    returnToBotAt: context.returnToBotAt || null,
    takeoverReason: context.takeoverReason || null,
    returnReason: context.returnReason || null,
    createdAt: now,
    updatedAt: now,
    lastUserMessage: lastUserMessage || null,
    assignedTo: null,
    phoneNumber: extractPhoneNumber(sessionId),
    messages: buildUserBootstrapMessage(lastUserMessage, now),
    unreadCount: 0,
    tags: Array.isArray(tags) ? tags : [],
    category: category || null,
    context: {
      flowId: context.flowId || null,
      escalationReason: context.escalationReason || null,
      escalationAttempt: context.escalationAttempt || null,
      botHistory: context.botHistory || [],
      variables: context.variables || {},
      allowReturnToBot: context.allowReturnToBot !== false,
      safeReturnNode: context.safeReturnNode || null,
      handoverHistory: Array.isArray(context.handoverHistory) ? context.handoverHistory : [],
      ...(context.metadata || {}),
    },
  };
}

module.exports = {
  buildNewQueueTicket,
};