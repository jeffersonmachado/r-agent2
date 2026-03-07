'use strict';

const queueService = require('../../services/queueService');

async function createQueueTicket({ tenantId, contactId, reason, kioskCode = 'default', channel = 'kiosk' }) {
  const sessionId = `${channel}_${String(kioskCode || 'default')}_${String(contactId || 'guest')}`;
  const queue = 'default';
  const ticket = queueService.createTicket({
    tenantId: String(tenantId),
    sessionId,
    queue,
    lastUserMessage: reason || 'checkin_kiosk',
    context: {
      source: 'kiosk',
      contactId: contactId ? String(contactId) : null,
      kioskCode: String(kioskCode || 'default'),
      channel,
      metadata: {
        contactId: contactId ? String(contactId) : null,
        kioskCode: String(kioskCode || 'default'),
      },
    },
    tags: ['kiosk'],
    category: 'kiosk',
  });
  return { ok: true, ticket };
}

module.exports = {
  createQueueTicket,
};
