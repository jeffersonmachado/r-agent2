'use strict';

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  emitJourneyEvent: jest.fn(async ({ eventType }) => ({
    id: `vje-${eventType}`,
    event_type: eventType,
  })),
  listJourneyEvents: jest.fn(async () => ({ items: [], total: 0 })),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn(async () => ({ queued: true, item: { id: 'notif-1' } })),
}));

const { emitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const { enqueueNotification } = require('../../api/services/notificationService');
const {
  recordPurchaseCompleted,
  requestReview,
  sendRestockReminder,
  sendLoyaltyCampaign,
} = require('../../api/services/vertical/marketJourneyService');

const BASE = { tenantId: 'tenant-a', subjectId: 'sub-1', customerId: 'cust-1', correlationId: 'corr-1' };

describe('marketJourneyService', () => {
  beforeEach(() => jest.clearAllMocks());
  // Restore implementations wiped by resetMocks: true in jest.config.cjs
  beforeEach(() => {
    emitJourneyEvent.mockImplementation(async ({ eventType }) => ({ id: `vje-${eventType}`, event_type: eventType }));
    enqueueNotification.mockResolvedValue({ queued: true, item: { id: 'notif-1' } });
  });

  describe('recordPurchaseCompleted', () => {
    it('emite purchase_completed com idempotency por pedido', async () => {
      await recordPurchaseCompleted({ ...BASE, orderId: 'order-1', orderNumber: 'P-100', amount: 259.9 });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'purchase_completed',
          vertical: 'market',
          idempotencyKey: 'market_purchase:tenant-a:order-1',
          payload: expect.objectContaining({ orderId: 'order-1', amount: 259.9, computedBy: 'business_rule' }),
        }),
      );
    });

    it('não enfileira notificação em canal internal', async () => {
      await recordPurchaseCompleted({ ...BASE, orderId: 'order-2', channel: 'internal' });
      expect(enqueueNotification).not.toHaveBeenCalled();
    });
  });

  describe('requestReview', () => {
    it('emite review_requested e notifica no canal do cliente', async () => {
      await requestReview({ ...BASE, orderId: 'order-3', channel: 'whatsapp' });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'review_requested',
          idempotencyKey: 'market_review:tenant-a:order-3',
        }),
      );
      expect(enqueueNotification).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'review_requested', channel: 'whatsapp', vertical: 'market' }),
      );
    });
  });

  describe('sendRestockReminder', () => {
    it('emite restock_reminder_sent com campaignKey idempotente', async () => {
      await sendRestockReminder({ ...BASE, metadata: { campaignKey: 'cust-1:19000', daysSinceLastPurchase: 32 } });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'restock_reminder_sent',
          idempotencyKey: 'market_restock:tenant-a:cust-1:19000',
          payload: expect.objectContaining({ reason: 'restock_due', daysSinceLastPurchase: 32 }),
        }),
      );
      expect(enqueueNotification).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'restock_reminder_sent' }),
      );
    });
  });

  describe('sendLoyaltyCampaign', () => {
    it('emite loyalty_campaign_sent com reason win_back', async () => {
      await sendLoyaltyCampaign({ ...BASE, metadata: { campaignKey: 'cust-1:19010', reason: 'win_back', daysSinceLastPurchase: 75 } });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'loyalty_campaign_sent',
          idempotencyKey: 'market_loyalty:tenant-a:cust-1:19010',
          payload: expect.objectContaining({ reason: 'win_back' }),
        }),
      );
    });
  });
});
