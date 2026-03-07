'use strict';

const mockScheduleModel = {
  sequelize: {
    transaction: jest.fn(async (cb) => cb({ id: 'tx-1' })),
  },
  create: jest.fn(),
  findOne: jest.fn(),
  findAll: jest.fn(),
  findAndCountAll: jest.fn(),
};

const mockWorkingHourModel = {
  findAll: jest.fn(),
  destroy: jest.fn(),
  bulkCreate: jest.fn(),
};

const mockBlockModel = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
};

const mockReminderModel = {
  destroy: jest.fn(),
  bulkCreate: jest.fn(),
  findAndCountAll: jest.fn(),
};
const mockUserModel = {
  findOne: jest.fn(),
};
const mockDepartmentModel = {
  findOne: jest.fn(),
};

const mockLogAction = jest.fn();
const mockAppendEventV1 = jest.fn(async () => ({ ok: true }));

jest.mock('../../db/models', () => ({
  OperationalSchedule: () => mockScheduleModel,
  ScheduleWorkingHour: () => mockWorkingHourModel,
  ScheduleBlock: () => mockBlockModel,
  ScheduleReminder: () => mockReminderModel,
  User: () => mockUserModel,
  Department: () => mockDepartmentModel,
}));

jest.mock('../auditService', () => ({
  logAction: (...args) => mockLogAction(...args),
}));

jest.mock('../eventLedgerService', () => ({
  appendEventV1: (...args) => mockAppendEventV1(...args),
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const schedulingService = require('../schedulingService');

function makeScheduleRow(overrides = {}) {
  const state = {
    id: 'sch-1',
    tenant_key: 'tenant-1',
    context_type: 'ticket',
    context_id: 'ctx-1',
    contact_id: null,
    conversation_id: null,
    channel: 'whatsapp',
    mode: 'free',
    origin: 'human',
    start_at: new Date('2026-03-02T13:00:00.000Z'),
    end_at: new Date('2026-03-02T13:30:00.000Z'),
    timezone: 'UTC',
    requires_confirmation: true,
    confirmation_status: 'pending',
    status: 'scheduled',
    owner_id: null,
    team_id: null,
    purpose: 'retorno',
    notes: null,
    metadata: {},
    idempotency_key: null,
    created_at: new Date('2026-03-01T12:00:00.000Z'),
    updated_at: new Date('2026-03-01T12:00:00.000Z'),
    ...overrides,
  };

  return {
    get id() { return state.id; },
    get status() { return state.status; },
    get requires_confirmation() { return state.requires_confirmation; },
    get mode() { return state.mode; },
    get owner_id() { return state.owner_id; },
    get team_id() { return state.team_id; },
    get channel() { return state.channel; },
    get purpose() { return state.purpose; },
    get notes() { return state.notes; },
    get origin() { return state.origin; },
    get timezone() { return state.timezone; },
    get metadata() { return state.metadata; },
    get start_at() { return state.start_at; },
    get end_at() { return state.end_at; },
    toJSON() {
      return { ...state };
    },
    async update(patch) {
      Object.assign(state, patch);
      return this;
    },
  };
}

describe('schedulingService', () => {
  beforeEach(() => {
    mockScheduleModel.sequelize.transaction.mockReset();
    mockScheduleModel.sequelize.transaction.mockImplementation(async (cb) => cb({ id: 'tx-1' }));
    mockScheduleModel.create.mockReset();
    mockScheduleModel.findOne.mockReset();
    mockScheduleModel.findAll.mockReset();
    mockScheduleModel.findAndCountAll.mockReset();
    mockWorkingHourModel.findAll.mockReset();
    mockWorkingHourModel.destroy.mockReset();
    mockWorkingHourModel.bulkCreate.mockReset();
    mockBlockModel.findAll.mockReset();
    mockBlockModel.findOne.mockReset();
    mockBlockModel.create.mockReset();
    mockReminderModel.destroy.mockReset();
    mockReminderModel.bulkCreate.mockReset();
    mockReminderModel.findAndCountAll.mockReset();
    mockUserModel.findOne.mockReset();
    mockDepartmentModel.findOne.mockReset();
    mockLogAction.mockReset();
    mockAppendEventV1.mockReset();
    mockAppendEventV1.mockResolvedValue({ ok: true });

    mockWorkingHourModel.findAll.mockResolvedValue([]);
    mockBlockModel.findAll.mockResolvedValue([]);
    mockScheduleModel.findAll.mockResolvedValue([]);
    mockReminderModel.destroy.mockResolvedValue(1);
    mockReminderModel.bulkCreate.mockResolvedValue([]);
    mockScheduleModel.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
    mockUserModel.findOne.mockResolvedValue({ id: 'owner-1', tenant_key: 'tenant-1' });
    mockDepartmentModel.findOne.mockResolvedValue({ id: 'team-a', tenant_key: 'tenant-1', active: true, agent_ids: ['agent-1'] });
  });

  test('getAvailability em mode=free retorna disponível sem conflitos', async () => {
    const out = await schedulingService.getAvailability({
      tenantId: 'tenant-1',
      mode: 'free',
      startAt: '2026-03-05T10:00:00.000Z',
      endAt: '2026-03-05T10:30:00.000Z',
      timezone: 'America/Sao_Paulo',
    });

    expect(out.available).toBe(true);
    expect(out.reasons).toEqual([]);
    expect(out.source).toBe('free_mode');
    expect(mockWorkingHourModel.findAll).not.toHaveBeenCalled();
  });

  test('createSchedule com team_based bloqueia quando indisponível', async () => {
    mockWorkingHourModel.findAll.mockResolvedValue([]);

    await expect(
      schedulingService.createSchedule({
        tenantId: 'tenant-1',
        input: {
          contextType: 'ticket',
          contextId: 'ticket-9',
          channel: 'whatsapp',
          mode: 'team_based',
          teamId: 'team-a',
          startAt: '2026-03-05T10:00:00.000Z',
          endAt: '2026-03-05T10:30:00.000Z',
          timezone: 'UTC',
          requiresConfirmation: true,
        },
      }),
    ).rejects.toMatchObject({ code: 'schedule_unavailable' });

    expect(mockScheduleModel.create).not.toHaveBeenCalled();
  });

  test('createSchedule sem metadata explícita injeta metadata com reminders no app', async () => {
    mockScheduleModel.create.mockImplementation(async (payload) => makeScheduleRow({
      id: payload.id,
      tenant_key: payload.tenant_key,
      context_type: payload.context_type,
      context_id: payload.context_id,
      channel: payload.channel,
      mode: payload.mode,
      origin: payload.origin,
      start_at: payload.start_at,
      end_at: payload.end_at,
      timezone: payload.timezone,
      metadata: payload.metadata,
    }));

    const out = await schedulingService.createSchedule({
      tenantId: 'tenant-1',
      input: {
        contextType: 'ticket',
        contextId: 'ticket-10',
        channel: 'whatsapp',
        mode: 'free',
        startAt: '2026-03-05T10:00:00.000Z',
        endAt: '2026-03-05T10:30:00.000Z',
        timezone: 'UTC',
      },
    });

    const createdPayload = mockScheduleModel.create.mock.calls[0][0];
    expect(createdPayload.metadata).toBeTruthy();
    expect(Array.isArray(createdPayload.metadata.reminders)).toBe(true);
    expect(createdPayload.metadata.reminders.length).toBeGreaterThan(0);
    expect(out.schedule.metadata).toHaveProperty('reminders');
  });

  test('createSchedule normaliza reminder sem payload para {}', async () => {
    mockScheduleModel.create.mockImplementation(async (payload) => makeScheduleRow({
      id: payload.id,
      tenant_key: payload.tenant_key,
      context_type: payload.context_type,
      context_id: payload.context_id,
      channel: payload.channel,
      mode: payload.mode,
      origin: payload.origin,
      start_at: payload.start_at,
      end_at: payload.end_at,
      timezone: payload.timezone,
      metadata: payload.metadata,
    }));

    await schedulingService.createSchedule({
      tenantId: 'tenant-1',
      input: {
        contextType: 'ticket',
        contextId: 'ticket-11',
        channel: 'whatsapp',
        mode: 'free',
        startAt: '2026-03-05T11:00:00.000Z',
        endAt: '2026-03-05T11:30:00.000Z',
        timezone: 'UTC',
        reminders: [{ offsetMinutes: -30, action: 'notify' }],
      },
    });

    expect(mockReminderModel.bulkCreate).toHaveBeenCalledTimes(1);
    const reminderRows = mockReminderModel.bulkCreate.mock.calls[0][0];
    expect(reminderRows.length).toBe(1);
    expect(reminderRows[0].payload).toEqual({});
  });

  test('createSchedule reutiliza idempotency key quando unique conflict', async () => {
    const existing = makeScheduleRow({ id: 'sch-existing', idempotency_key: 'idem-1' });
    mockScheduleModel.create.mockRejectedValueOnce({ name: 'SequelizeUniqueConstraintError' });
    mockScheduleModel.findOne.mockResolvedValue(existing);

    const out = await schedulingService.createSchedule({
      tenantId: 'tenant-1',
      input: {
        contextType: 'ticket',
        contextId: 'ticket-9',
        channel: 'whatsapp',
        mode: 'free',
        startAt: '2026-03-05T10:00:00.000Z',
        endAt: '2026-03-05T10:30:00.000Z',
        timezone: 'UTC',
        idempotencyKey: 'idem-1',
      },
    });

    expect(out.ok).toBe(true);
    expect(out.schedule.id).toBe('sch-existing');
    expect(mockScheduleModel.findOne).toHaveBeenCalled();
  });

  test('confirmSchedule em draft com confirmação obrigatória muda para scheduled/confirmed', async () => {
    const row = makeScheduleRow({ status: 'draft', requires_confirmation: true, confirmation_status: 'pending' });
    mockScheduleModel.findOne.mockResolvedValue(row);

    const out = await schedulingService.confirmSchedule({
      tenantId: 'tenant-1',
      scheduleId: 'sch-1',
      by: 'ui',
    });

    expect(out.schedule.status).toBe('scheduled');
    expect(out.schedule.confirmationStatus).toBe('confirmed');
  });

  test('confirmSchedule sem confirmação obrigatória marca not_required', async () => {
    const row = makeScheduleRow({ requires_confirmation: false, confirmation_status: 'pending' });
    mockScheduleModel.findOne.mockResolvedValue(row);

    const out = await schedulingService.confirmSchedule({
      tenantId: 'tenant-1',
      scheduleId: 'sch-1',
      by: 'system',
    });

    expect(out.schedule.confirmationStatus).toBe('not_required');
  });

  test('markInProgress bloqueia transição inválida', async () => {
    const row = makeScheduleRow({ status: 'draft' });
    mockScheduleModel.findOne.mockResolvedValue(row);

    await expect(
      schedulingService.markInProgress({ tenantId: 'tenant-1', scheduleId: 'sch-1' }),
    ).rejects.toMatchObject({ code: 'invalid_schedule_transition' });
  });

  test('rescheduleSchedule atualiza janela e recria reminders', async () => {
    const row = makeScheduleRow({
      mode: 'team_based',
      team_id: 'team-a',
      metadata: { existing: true },
    });
    mockScheduleModel.findOne.mockResolvedValue(row);
    mockWorkingHourModel.findAll.mockResolvedValue([
      { start_time: '08:00', end_time: '18:00' },
    ]);
    mockBlockModel.findAll.mockResolvedValue([]);
    mockScheduleModel.findAll.mockResolvedValue([]);

    const out = await schedulingService.rescheduleSchedule({
      tenantId: 'tenant-1',
      scheduleId: 'sch-1',
      input: {
        startAt: '2026-03-06T15:00:00.000Z',
        endAt: '2026-03-06T15:45:00.000Z',
        metadata: { from: 'test' },
        reminders: [{ offsetMinutes: -60, action: 'request_confirmation' }],
      },
    });

    expect(out.ok).toBe(true);
    expect(out.schedule.startAt).toBe('2026-03-06T15:00:00.000Z');
    expect(out.schedule.endAt).toBe('2026-03-06T15:45:00.000Z');
    expect(mockReminderModel.destroy).toHaveBeenCalled();
    expect(mockReminderModel.bulkCreate).toHaveBeenCalledTimes(1);
  });

  test('declineSchedule cancela e marca declined', async () => {
    const row = makeScheduleRow({ status: 'scheduled', requires_confirmation: true, confirmation_status: 'pending' });
    mockScheduleModel.findOne.mockResolvedValue(row);

    const out = await schedulingService.declineSchedule({
      tenantId: 'tenant-1',
      scheduleId: 'sch-1',
      by: 'message',
    });

    expect(out.schedule.status).toBe('canceled');
    expect(out.schedule.confirmationStatus).toBe('declined');
    expect(mockAppendEventV1).toHaveBeenCalled();
    expect(mockLogAction).toHaveBeenCalled();
  });

  test('createSchedule team_based sem owner/team retorna team_or_owner_required', async () => {
    await expect(
      schedulingService.createSchedule({
        tenantId: 'tenant-1',
        input: {
          contextType: 'ticket',
          contextId: 'ticket-20',
          channel: 'whatsapp',
          mode: 'team_based',
          startAt: '2026-03-05T10:00:00.000Z',
          endAt: '2026-03-05T10:30:00.000Z',
          timezone: 'UTC',
        },
      }),
    ).rejects.toMatchObject({ code: 'team_or_owner_required' });
  });

  test('createSchedule com owner inexistente retorna owner_not_found', async () => {
    mockUserModel.findOne.mockResolvedValueOnce(null);

    await expect(
      schedulingService.createSchedule({
        tenantId: 'tenant-1',
        input: {
          contextType: 'ticket',
          contextId: 'ticket-21',
          channel: 'whatsapp',
          mode: 'free',
          ownerId: 'owner-missing',
          startAt: '2026-03-05T11:00:00.000Z',
          endAt: '2026-03-05T11:30:00.000Z',
          timezone: 'UTC',
        },
      }),
    ).rejects.toMatchObject({ code: 'owner_not_found' });
  });

  test('createSchedule com team inexistente retorna team_not_found', async () => {
    mockDepartmentModel.findOne.mockResolvedValueOnce(null);

    await expect(
      schedulingService.createSchedule({
        tenantId: 'tenant-1',
        input: {
          contextType: 'ticket',
          contextId: 'ticket-22',
          channel: 'whatsapp',
          mode: 'free',
          teamId: 'team-missing',
          startAt: '2026-03-05T12:00:00.000Z',
          endAt: '2026-03-05T12:30:00.000Z',
          timezone: 'UTC',
        },
      }),
    ).rejects.toMatchObject({ code: 'team_not_found' });
  });

  test('createSchedule origin=bot com ownerId retorna owner_not_allowed_for_bot', async () => {
    await expect(
      schedulingService.createSchedule({
        tenantId: 'tenant-1',
        input: {
          contextType: 'ticket',
          contextId: 'ticket-23',
          channel: 'whatsapp',
          mode: 'free',
          origin: 'bot',
          ownerId: 'owner-1',
          startAt: '2026-03-05T13:00:00.000Z',
          endAt: '2026-03-05T13:30:00.000Z',
          timezone: 'UTC',
        },
      }),
    ).rejects.toMatchObject({ code: 'owner_not_allowed_for_bot' });
  });

  test('createSchedule origin=human com ownerId diferente sem permissão retorna owner_not_allowed', async () => {
    await expect(
      schedulingService.createSchedule({
        tenantId: 'tenant-1',
        input: {
          contextType: 'ticket',
          contextId: 'ticket-24',
          channel: 'whatsapp',
          mode: 'free',
          origin: 'human',
          ownerId: 'owner-1',
          startAt: '2026-03-05T14:00:00.000Z',
          endAt: '2026-03-05T14:30:00.000Z',
          timezone: 'UTC',
        },
        actor: {
          requestUser: {
            id: 'agent-2',
            username: 'agent2',
            role: 'operator',
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'owner_not_allowed' });
  });
});
