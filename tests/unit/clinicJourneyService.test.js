'use strict';

jest.mock('../../api/services/vertical/customerJourneyEngine', () => ({
  emitJourneyEvent: jest.fn(async ({ eventType }) => ({
    id: `vje-${eventType}`,
    event_type: eventType,
  })),
  listJourneyEvents: jest.fn(async () => []),
}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: jest.fn(async () => ({ id: 'ledger-1' })),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn(async () => ({ queued: true, item: { id: 'notif-1' } })),
}));

const { emitJourneyEvent } = require('../../api/services/vertical/customerJourneyEngine');
const { appendEventV1 } = require('../../api/services/eventLedgerService');
const { enqueueNotification } = require('../../api/services/notificationService');
const {
  sendConfirmation,
  recordConfirmationReceived,
  sendReminder24h,
  sendReminderNearTime,
  recordCheckIn,
  detectNoShow,
  offerWaitlistSlot,
  recordConsultationCompleted,
  sendFollowUp,
  sendRecall,
  sendReactivation,
} = require('../../api/services/vertical/clinicJourneyService');

const BASE = { tenantId: 'tenant-a', subjectId: 'sub-1', customerId: 'cust-1', scheduleId: 'sched-1', correlationId: 'corr-1' };

describe('clinicJourneyService', () => {
  beforeEach(() => jest.clearAllMocks());
  // Restore implementations wiped by resetMocks: true in jest.config.cjs
  beforeEach(() => {
    emitJourneyEvent.mockImplementation(async ({ eventType }) => ({ id: `vje-${eventType}`, event_type: eventType }));
    appendEventV1.mockResolvedValue({ id: 'ledger-1' });
    enqueueNotification.mockResolvedValue({ queued: true, item: { id: 'notif-1' } });
  });

  describe('sendConfirmation', () => {
    it('emite confirmation_sent com vertical clinic', async () => {
      const result = await sendConfirmation(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'confirmation_sent', vertical: 'clinic' }),
      );
      expect(result.event_type).toBe('confirmation_sent');
    });

    it('usa idempotencyKey baseada em scheduleId', async () => {
      await sendConfirmation(BASE);
      const call = emitJourneyEvent.mock.calls[0][0];
      expect(call.idempotencyKey).toContain('clinic_confirmation');
      expect(call.idempotencyKey).toContain('sched-1');
    });
  });

  describe('recordConfirmationReceived', () => {
    it('emite confirmation_received', async () => {
      await recordConfirmationReceived(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'confirmation_received', vertical: 'clinic' }),
      );
    });
  });

  describe('reminders', () => {
    it('sendReminder24h emite reminder_24h', async () => {
      await sendReminder24h(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reminder_24h', vertical: 'clinic' }),
      );
    });

    it('sendReminderNearTime emite reminder_1h', async () => {
      await sendReminderNearTime(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reminder_1h', vertical: 'clinic' }),
      );
    });
  });

  describe('recordCheckIn', () => {
    it('emite checkin_recorded (chegada do paciente)', async () => {
      await recordCheckIn(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'checkin_recorded', vertical: 'clinic', scheduleId: 'sched-1' }),
      );
    });
  });

  describe('detectNoShow', () => {
    it('emite no_show_detected e reoferta de encaixe encadeada', async () => {
      await detectNoShow(BASE);
      const types = emitJourneyEvent.mock.calls.map((c) => c[0].eventType);
      expect(types).toContain('no_show_detected');
      expect(types).toContain('rescheduling_offered');
      const reoffer = emitJourneyEvent.mock.calls.find((c) => c[0].eventType === 'rescheduling_offered');
      expect(reoffer[0].payload.trigger).toBe('no_show');
    });
  });

  describe('offerWaitlistSlot', () => {
    it('emite rescheduling_offered com trigger waitlist_slot', async () => {
      await offerWaitlistSlot(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'rescheduling_offered', payload: expect.objectContaining({ trigger: 'waitlist_slot' }) }),
      );
    });
  });

  describe('recordConsultationCompleted', () => {
    it('emite service_completed e follow-up encadeado', async () => {
      await recordConsultationCompleted(BASE);
      const types = emitJourneyEvent.mock.calls.map((c) => c[0].eventType);
      expect(types).toContain('service_completed');
      expect(types).toContain('follow_up_sent');
    });

    it('registra ClinicConsultationCompleted no event_ledger', async () => {
      await recordConsultationCompleted(BASE);
      expect(appendEventV1).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ClinicConsultationCompleted', source: 'vertical.journey.clinic' }),
      );
    });
  });

  describe('sendFollowUp', () => {
    it('emite follow_up_sent com contexto pós-consulta', async () => {
      await sendFollowUp(BASE);
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'follow_up_sent', payload: expect.objectContaining({ context: 'post_consultation' }) }),
      );
    });
  });

  describe('sendRecall', () => {
    it('emite return_campaign_sent com reason periodic_recall', async () => {
      await sendRecall({ ...BASE, scheduleId: null, metadata: { recallKey: 'recall-1' } });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'return_campaign_sent', vertical: 'clinic', payload: expect.objectContaining({ reason: 'periodic_recall' }) }),
      );
    });

    it('usa idempotencyKey de recall quando fornecida', async () => {
      await sendRecall({ ...BASE, scheduleId: null, metadata: { recallKey: 'recall-1' } });
      const call = emitJourneyEvent.mock.calls[0][0];
      expect(call.idempotencyKey).toContain('clinic_recall');
      expect(call.idempotencyKey).toContain('recall-1');
    });
  });

  describe('sendReactivation', () => {
    it('emite reactivation_sent', async () => {
      await sendReactivation({ ...BASE, scheduleId: null });
      expect(emitJourneyEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'reactivation_sent', vertical: 'clinic' }),
      );
    });
  });

  describe('notificações', () => {
    it('enfileira notificação whatsapp quando canal externo', async () => {
      await sendReminder24h({ ...BASE, channel: 'whatsapp' });
      expect(enqueueNotification).toHaveBeenCalledWith(
        expect.objectContaining({ vertical: 'clinic', channel: 'whatsapp', eventType: 'reminder_24h' }),
      );
    });

    it('não enfileira notificação para canal internal', async () => {
      await sendReminder24h({ ...BASE, channel: 'internal' });
      expect(enqueueNotification).not.toHaveBeenCalled();
    });
  });
});
