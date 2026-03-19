'use strict';

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  emitJourneyEvent: jest.fn(async ({ eventType }) => ({
    id: `vje-${eventType}`,
    event_type: eventType,
  })),
  listJourneyEvents: jest.fn(async () => []),
}));

jest.mock('../../api/services/vertical/billingOrchestrationService', () => ({
  consumeSession: jest.fn(async () => ({ id: 'bundle-1', used_sessions: 1 })),
  getSessionBalance: jest.fn(async () => ({ remaining: 4, total: 10, used: 6 })),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'ledger-1' })),
}));

const { emitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const { consumeSession, getSessionBalance } = require('../../api/services/vertical/billingOrchestrationService');
const { appendEventV1 } = require('../../api/services/eventLedgerService');
const {
  sendConfirmation,
  recordConfirmationReceived,
  sendReminder24h,
  sendReminderNearTime,
  detectNoShow,
  recordServiceCompleted,
  sendFollowUp,
  requestReview,
  sendReactivation,
  getCustomerSessionBalance,
} = require('../../api/services/vertical/beautyJourneyService');

const BASE = { tenantId: 'tenant-a', subjectId: 'sub-1', customerId: 'cust-1', scheduleId: 'sched-1', correlationId: 'corr-1' };

describe('beautyJourneyService', () => {
  beforeEach(() => jest.clearAllMocks());
  // Restore implementations wiped by resetMocks: true in jest.config.cjs
  beforeEach(() => {
    emitJourneyEvent.mockImplementation(async ({ eventType }) => ({ id: `vje-${eventType}`, event_type: eventType }));
    consumeSession.mockResolvedValue({ id: 'bundle-1', used_sessions: 1 });
    getSessionBalance.mockResolvedValue({ remaining: 4, total: 10, used: 6 });
    appendEventV1.mockResolvedValue({ id: 'ledger-1' });
  });
  describe('sendConfirmation', () => {
    it('emite confirmation_sent via journey engine', async () => {
      const result = await sendConfirmation(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'confirmation_sent', vertical: 'beauty' }),
      );
      expect(result.event_type).toBe('confirmation_sent');
    });

    it('usa idempotencyKey baseada em scheduleId', async () => {
      await sendConfirmation(BASE);
      const call = emitJourneyEvent.mock.calls[0][0];
      expect(call.idempotencyKey).toContain('sched-1');
    });
  });

  describe('recordConfirmationReceived', () => {
    it('emite confirmation_received', async () => {
      await recordConfirmationReceived(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'confirmation_received' }),
      );
    });
  });

  describe('sendReminder24h', () => {
    it('emite reminder_24h', async () => {
      await sendReminder24h(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reminder_24h' }),
      );
    });
  });

  describe('sendReminderNearTime', () => {
    it('emite reminder_1h', async () => {
      await sendReminderNearTime(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reminder_1h' }),
      );
    });
  });

  describe('detectNoShow', () => {
    it('emite no_show_detected', async () => {
      const result = await detectNoShow(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'no_show_detected' }),
      );
    });
  });

  describe('recordServiceCompleted', () => {
    it('emite service_completed e consome sessão do bundle', async () => {
      const result = await recordServiceCompleted({ ...BASE, bundleId: 'bundle-1' });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'service_completed' }),
      );
      expect(consumeSession).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a', bundleId: 'bundle-1' }),
      );
    });

    it('emite LoyaltyPointsGranted no event_ledger', async () => {
      await recordServiceCompleted({ ...BASE, bundleId: 'bundle-1' });
      expect(appendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'LoyaltyPointsGranted' }),
      );
    });

    it('omite consumeSession quando bundleId não fornecido', async () => {
      await recordServiceCompleted({ ...BASE, bundleId: null });
      expect(consumeSession).not.toHaveBeenCalled();
    });
  });

  describe('sendFollowUp', () => {
    it('emite follow_up_sent', async () => {
      await sendFollowUp(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'follow_up_sent' }),
      );
    });
  });

  describe('requestReview', () => {
    it('emite review_requested', async () => {
      await requestReview(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'review_requested' }),
      );
    });
  });

  describe('sendReactivation', () => {
    it('emite reactivation_sent', async () => {
      await sendReactivation({ ...BASE, scheduleId: null });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reactivation_sent' }),
      );
    });
  });

  describe('getCustomerSessionBalance', () => {
    it('delega para billingOrchestrationService.getSessionBalance', async () => {
      const result = await getCustomerSessionBalance({ tenantId: 'tenant-a', vertical: 'beauty', subjectId: 'sub-1' });
      expect(getSessionBalance).toHaveBeenCalled();
      expect(result).toMatchObject({ remaining: 4 });
    });
  });
});
