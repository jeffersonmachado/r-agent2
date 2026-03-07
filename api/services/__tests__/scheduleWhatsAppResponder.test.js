'use strict';

const mockScheduleModel = {
  findAll: jest.fn(),
};

const mockSendOutbound = jest.fn();
const mockConfirmSchedule = jest.fn();
const mockDeclineSchedule = jest.fn();
const mockCancelSchedule = jest.fn();
const mockRescheduleSchedule = jest.fn();
const mockAvailability = jest.fn();

jest.mock('../../db/models', () => ({
  OperationalSchedule: () => mockScheduleModel,
}));

jest.mock('../outboundQueueService', () => ({
  enqueueOutbound: (...args) => mockSendOutbound(...args),
}));

jest.mock('../schedulingService', () => ({
  confirmSchedule: (...args) => mockConfirmSchedule(...args),
  declineSchedule: (...args) => mockDeclineSchedule(...args),
  cancelSchedule: (...args) => mockCancelSchedule(...args),
  rescheduleSchedule: (...args) => mockRescheduleSchedule(...args),
  getAvailability: (...args) => mockAvailability(...args),
}));

jest.mock('../queueService', () => ({
  getTicket: jest.fn(() => ({ id: 't1', mode: 'human' })),
}));

jest.mock('../auditService', () => ({ logAction: jest.fn() }));
jest.mock('../eventLedgerService', () => ({ appendEventV1: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const {
  resolveScheduleTarget,
  handleScheduleWhatsAppReply,
} = require('../scheduleWhatsAppResponder');

function makeRow(overrides = {}) {
  const state = {
    id: 'sch-1',
    tenant_key: 'tenant-1',
    status: 'scheduled',
    requires_confirmation: true,
    confirmation_status: 'pending',
    channel: 'whatsapp',
    mode: 'free',
    start_at: '2026-03-03T12:00:00.000Z',
    end_at: '2026-03-03T12:30:00.000Z',
    timezone: 'UTC',
    conversation_id: 'conv-1',
    contact_id: '5511999999999',
    context_type: 'ticket',
    context_id: 't1',
    metadata: {},
    ...overrides,
  };

  return {
    toJSON() { return { ...state }; },
    async update(patch) {
      Object.assign(state, patch);
      return this;
    },
    get state() { return state; },
  };
}

describe('scheduleWhatsAppResponder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSendOutbound.mockResolvedValue({ queued: true, itemId: 'out-1' });
    mockConfirmSchedule.mockResolvedValue({ ok: true, schedule: { id: 'sch-1', startAt: '2026-03-03T12:00:00.000Z', timezone: 'UTC' } });
    mockDeclineSchedule.mockResolvedValue({ ok: true, schedule: { id: 'sch-1', status: 'canceled' } });
    mockCancelSchedule.mockResolvedValue({ ok: true, schedule: { id: 'sch-1', status: 'canceled' } });
    mockRescheduleSchedule.mockResolvedValue({ ok: true, schedule: { id: 'sch-1', status: 'scheduled' } });
    mockAvailability.mockResolvedValue({ available: true });
  });

  test('resolveScheduleTarget prioriza reply context por metadata', async () => {
    const row = makeRow({ metadata: { confirmation_message_id: 'wamid.123' } });
    mockScheduleModel.findAll.mockResolvedValue([row]);

    const out = await resolveScheduleTarget({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      replyToMessageIds: ['wamid.123'],
    });

    expect(out.schedule).toBeTruthy();
    expect(out.method).toBe('reply_context');
  });

  test('fluxo pending -> confirm', async () => {
    const row = makeRow();
    mockScheduleModel.findAll.mockResolvedValue([row]);

    const out = await handleScheduleWhatsAppReply({
      tenantId: 'tenant-1',
      messageText: '1',
      conversationId: 'conv-1',
      contactId: '5511999999999',
      from: '5511999999999',
      payload: { message: { context: { id: 'x' } } },
      inboundMessageId: 'in-1',
    });

    expect(out.handled).toBe(true);
    expect(out.action).toBe('confirm');
    expect(mockConfirmSchedule).toHaveBeenCalled();
    expect(mockSendOutbound).toHaveBeenCalled();
  });

  test('idempotência: mesma inbound message não duplica confirmação/envio', async () => {
    const row = makeRow();
    mockScheduleModel.findAll.mockResolvedValue([row]);

    const payload = {
      tenantId: 'tenant-1',
      messageText: '1',
      conversationId: 'conv-1',
      contactId: '5511999999999',
      from: '5511999999999',
      inboundMessageId: 'in-dup-1',
    };

    const first = await handleScheduleWhatsAppReply(payload);
    const second = await handleScheduleWhatsAppReply(payload);

    expect(first.handled).toBe(true);
    expect(first.action).toBe('confirm');
    expect(second.handled).toBe(true);
    expect(second.idempotent).toBe(true);
    expect(mockConfirmSchedule).toHaveBeenCalledTimes(1);
    expect(mockSendOutbound).toHaveBeenCalledTimes(1);
  });

  test('fluxo pending -> cancel usa decline', async () => {
    const row = makeRow({ requires_confirmation: true, confirmation_status: 'pending' });
    mockScheduleModel.findAll.mockResolvedValue([row]);

    const out = await handleScheduleWhatsAppReply({
      tenantId: 'tenant-1',
      messageText: '3',
      conversationId: 'conv-1',
      contactId: '5511999999999',
      from: '5511999999999',
      inboundMessageId: 'in-2',
    });

    expect(out.handled).toBe(true);
    expect(out.action).toBe('cancel');
    expect(mockDeclineSchedule).toHaveBeenCalled();
    expect(mockCancelSchedule).not.toHaveBeenCalled();
  });

  test('fluxo reschedule -> escolha -> rescheduled', async () => {
    const row = makeRow();
    mockScheduleModel.findAll.mockResolvedValue([row]);

    const first = await handleScheduleWhatsAppReply({
      tenantId: 'tenant-1',
      messageText: '2',
      conversationId: 'conv-1',
      contactId: '5511999999999',
      from: '5511999999999',
      inboundMessageId: 'in-3',
    });
    expect(first.handled).toBe(true);
    expect(first.action).toBe('reschedule');

    const second = await handleScheduleWhatsAppReply({
      tenantId: 'tenant-1',
      messageText: '1',
      conversationId: 'conv-1',
      contactId: '5511999999999',
      from: '5511999999999',
      inboundMessageId: 'in-4',
    });

    expect(second.handled).toBe(true);
    expect(second.action).toBe('reschedule_choice');
    expect(mockRescheduleSchedule).toHaveBeenCalled();
  });
});
