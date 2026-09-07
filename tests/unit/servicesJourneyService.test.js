'use strict';

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  emitJourneyEvent: jest.fn(async ({ eventType }) => ({
    id: `vje-${eventType}`,
    event_type: eventType,
  })),
  listJourneyEvents: jest.fn(async () => ({ items: [], total: 0 })),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'ledger-1' })),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn(async () => ({ queued: true, item: { id: 'notif-1' } })),
}));

jest.mock('../../api/services/billingService', () => ({
  createCharge: jest.fn(async () => ({ id: 'tx-1', status: 'pending' })),
}));

const { emitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const { appendEventV1 } = require('../../api/services/eventLedgerService');
const { enqueueNotification } = require('../../api/services/notificationService');
const billingService = require('../../api/services/billingService');
const {
  sendQuote,
  recordQuoteApproved,
  recordQuoteDeclined,
  expireQuote,
  sendQuoteFollowUp,
  recordServiceScheduled,
  recordServiceDelivered,
  sendReactivation,
} = require('../../api/services/vertical/servicesJourneyService');

const BASE = { tenantId: 'tenant-a', subjectId: 'sub-1', customerId: 'cust-1', quoteId: 'quote-1', correlationId: 'corr-1' };

describe('servicesJourneyService', () => {
  beforeEach(() => jest.clearAllMocks());
  // Restore implementations wiped by resetMocks: true in jest.config.cjs
  beforeEach(() => {
    emitJourneyEvent.mockImplementation(async ({ eventType }) => ({ id: `vje-${eventType}`, event_type: eventType }));
    appendEventV1.mockResolvedValue({ id: 'ledger-1' });
    enqueueNotification.mockResolvedValue({ queued: true, item: { id: 'notif-1' } });
    billingService.createCharge.mockResolvedValue({ id: 'tx-1', status: 'pending' });
  });

  describe('sendQuote', () => {
    it('emite quote_sent com dados do orçamento', async () => {
      await sendQuote({ ...BASE, amount: 1500, items: [{ name: 'Instalação', qty: 1 }], validDays: 10 });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'quote_sent',
          vertical: 'services',
          payload: expect.objectContaining({ quoteId: 'quote-1', amount: 1500, validDays: 10 }),
        }),
      );
    });

    it('usa idempotencyKey por quoteId', async () => {
      await sendQuote(BASE);
      expect(emitJourneyEvent.mock.calls[0][0].idempotencyKey).toBe('services_quote:tenant-a:quote-1');
    });
  });

  describe('recordQuoteApproved', () => {
    it('emite quote_approved e charge_issued com cobrança real', async () => {
      await recordQuoteApproved({ ...BASE, amount: 1500, dueDate: '2026-09-20' });
      const types = emitJourneyEvent.mock.calls.map((c) => c[0].eventType);
      expect(types).toContain('quote_approved');
      expect(types).toContain('charge_issued');
      expect(billingService.createCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-a',
          vertical: 'services',
          type: 'one_time',
          amount: 1500,
          idempotencyKey: 'services_charge:tenant-a:quote-1',
        }),
      );
    });

    it('não emite cobrança sem amount', async () => {
      await recordQuoteApproved({ ...BASE, amount: null });
      expect(billingService.createCharge).not.toHaveBeenCalled();
    });

    it('propaga billing_db_unavailable (persistência obrigatória)', async () => {
      const err = new Error('billing_db_unavailable');
      err.code = 'billing_db_unavailable';
      billingService.createCharge.mockRejectedValue(err);
      await expect(recordQuoteApproved({ ...BASE, amount: 100 })).rejects.toMatchObject({ code: 'billing_db_unavailable' });
    });
  });

  describe('recordQuoteDeclined', () => {
    it('emite quote_declined com reason', async () => {
      await recordQuoteDeclined({ ...BASE, reason: 'preco' });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'quote_declined', payload: expect.objectContaining({ reason: 'preco' }) }),
      );
    });
  });

  describe('expireQuote', () => {
    it('emite quote_expired idempotente por quote', async () => {
      await expireQuote(BASE);
      const call = emitJourneyEvent.mock.calls[0][0];
      expect(call.eventType).toBe('quote_expired');
      expect(call.idempotencyKey).toBe('services_quote_expired:tenant-a:quote-1');
    });
  });

  describe('sendQuoteFollowUp', () => {
    it('emite quote_follow_up_sent com sequência', async () => {
      await sendQuoteFollowUp({ ...BASE, sequence: 1, channel: 'whatsapp' });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'quote_follow_up_sent', payload: expect.objectContaining({ sequence: 1 }) }),
      );
      expect(enqueueNotification).toHaveBeenCalledWith(
        expect.objectContaining({ vertical: 'services', eventType: 'quote_follow_up_sent' }),
      );
    });
  });

  describe('recordServiceScheduled', () => {
    it('emite pre_service com data agendada', async () => {
      await recordServiceScheduled({ ...BASE, scheduleId: 'sched-1', scheduledAt: '2026-09-10T14:00:00Z' });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'pre_service', scheduleId: 'sched-1', payload: expect.objectContaining({ scheduled_at: '2026-09-10T14:00:00Z' }) }),
      );
    });
  });

  describe('recordServiceDelivered', () => {
    it('emite service_completed + follow_up + ledger', async () => {
      await recordServiceDelivered({ ...BASE, scheduleId: 'sched-1' });
      const types = emitJourneyEvent.mock.calls.map((c) => c[0].eventType);
      expect(types).toContain('service_completed');
      expect(types).toContain('follow_up_sent');
      expect(appendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ServicesJobDelivered', source: 'vertical.journey.services' }),
      );
    });
  });

  describe('sendReactivation', () => {
    it('emite reactivation_sent', async () => {
      await sendReactivation({ tenantId: 'tenant-a', subjectId: 'sub-1', correlationId: 'corr-9' });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reactivation_sent', vertical: 'services' }),
      );
    });
  });
});
