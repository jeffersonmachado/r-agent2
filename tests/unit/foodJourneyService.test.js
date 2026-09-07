'use strict';

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  emitJourneyEvent: jest.fn(async ({ eventType }) => ({
    id: `vje-${eventType}`,
    event_type: eventType,
  })),
  listJourneyEvents: jest.fn(async () => []),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn(async () => ({ queued: true, item: { id: 'notif-1' } })),
}));

const { emitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const { enqueueNotification } = require('../../api/services/notificationService');
const {
  recordPaymentConfirmed,
  requestReview,
  sendReorderCampaign,
} = require('../../api/services/vertical/foodJourneyService');

const BASE = { tenantId: 'tenant-a', subjectId: 'sub-1', customerId: 'cust-1', orderId: 'order-1', orderNumber: 42, correlationId: 'corr-1' };

describe('foodJourneyService', () => {
  beforeEach(() => jest.clearAllMocks());
  // Restore implementations wiped by resetMocks: true in jest.config.cjs
  beforeEach(() => {
    emitJourneyEvent.mockImplementation(async ({ eventType }) => ({ id: `vje-${eventType}`, event_type: eventType }));
    enqueueNotification.mockResolvedValue({ queued: true, item: { id: 'notif-1' } });
  });

  describe('recordPaymentConfirmed', () => {
    it('emite confirmation_received com contexto de pagamento', async () => {
      await recordPaymentConfirmed({ ...BASE, amount: 59.9 });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'confirmation_received',
          payload: expect.objectContaining({ context: 'order_payment', orderId: 'order-1', paymentStatus: 'paid', amount: 59.9 }),
        }),
      );
    });

    it('usa idempotencyKey por pedido', async () => {
      await recordPaymentConfirmed(BASE);
      const call = emitJourneyEvent.mock.calls[0][0];
      expect(call.idempotencyKey).toBe('food_payment:tenant-a:order-1');
    });

    it('respeita vertical explícita no metadata (ex.: bakery reutiliza pedidos)', async () => {
      await recordPaymentConfirmed({ ...BASE, metadata: { vertical: 'bakery' } });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ vertical: 'bakery' }),
      );
    });
  });

  describe('requestReview', () => {
    it('emite review_requested pós-entrega', async () => {
      await requestReview(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'review_requested', payload: expect.objectContaining({ context: 'post_delivery', orderId: 'order-1' }) }),
      );
    });

    it('usa idempotencyKey por pedido', async () => {
      await requestReview(BASE);
      expect(emitJourneyEvent.mock.calls[0][0].idempotencyKey).toBe('food_review:tenant-a:order-1');
    });

    it('enfileira notificação whatsapp', async () => {
      await requestReview({ ...BASE, channel: 'whatsapp' });
      expect(enqueueNotification).toHaveBeenCalledWith(
        expect.objectContaining({ vertical: 'food', channel: 'whatsapp', eventType: 'review_requested' }),
      );
    });
  });

  describe('sendReorderCampaign', () => {
    it('emite return_campaign_sent com reason reorder_due', async () => {
      await sendReorderCampaign({ ...BASE, orderId: null, metadata: { campaignKey: 'ck-1' } });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'return_campaign_sent', vertical: 'food', payload: expect.objectContaining({ reason: 'reorder_due' }) }),
      );
    });

    it('usa idempotencyKey da campanha', async () => {
      await sendReorderCampaign({ ...BASE, orderId: null, metadata: { campaignKey: 'ck-1' } });
      expect(emitJourneyEvent.mock.calls[0][0].idempotencyKey).toBe('food_reorder:tenant-a:ck-1');
    });
  });

  describe('notificações', () => {
    it('não enfileira notificação para canal internal', async () => {
      await requestReview({ ...BASE, channel: 'internal' });
      expect(enqueueNotification).not.toHaveBeenCalled();
    });
  });
});
