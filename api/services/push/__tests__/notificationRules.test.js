'use strict';

const {
  shouldNotifyTicketMessage,
  selectRecipientUserIdsForTicket,
  consumeMessageDedup,
  clearDedupCacheForTests,
} = require('../notificationRules');

describe('push notificationRules', () => {
  beforeEach(() => {
    clearDedupCacheForTests();
  });

  test('seleciona apenas assignedTo como destinatário mínimo', () => {
    const recipients = selectRecipientUserIdsForTicket({ assignedTo: 'agent-1' });
    expect(recipients).toEqual(['agent-1']);
  });

  test('não notifica ticket fechado', () => {
    expect(shouldNotifyTicketMessage({ status: 'closed', mode: 'human' })).toBe(false);
  });

  test('notifica ticket em human/paused', () => {
    expect(shouldNotifyTicketMessage({ status: 'waiting', mode: 'human' })).toBe(true);
    expect(shouldNotifyTicketMessage({ status: 'in_progress', mode: 'paused' })).toBe(true);
  });

  test('dedup bloqueia segunda notificação para mesma externalMessageId', () => {
    const first = consumeMessageDedup({ tenantId: 't1', ticketId: 'tk1', externalMessageId: 'msg-1' });
    const second = consumeMessageDedup({ tenantId: 't1', ticketId: 'tk1', externalMessageId: 'msg-1' });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });
});
