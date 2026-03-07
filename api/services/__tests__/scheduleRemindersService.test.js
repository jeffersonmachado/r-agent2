'use strict';

const mockSequelize = {
  Sequelize: { Op: require('sequelize').Op },
};

const mockReminderModel = {
  sequelize: mockSequelize,
  findAll: jest.fn(),
  findOne: jest.fn(),
  update: jest.fn(async () => [1]),
};

const mockScheduleModel = {
  findOne: jest.fn(),
};

const mockEnqueue = jest.fn();

jest.mock('../../db/models', () => ({
  ScheduleReminder: () => mockReminderModel,
  OperationalSchedule: () => mockScheduleModel,
}));

jest.mock('../outboundQueueService', () => ({
  enqueueOutbound: (...args) => mockEnqueue(...args),
}));

jest.mock('../scheduleWhatsAppResponder', () => ({
  sendScheduleConfirmationRequest: jest.fn(async () => ({ queued: true })),
}));

jest.mock('../schedulingService', () => ({
  markNoShow: jest.fn(async () => ({ ok: true, schedule: { status: 'no_show' } })),
}));

jest.mock('../auditService', () => ({ logAction: jest.fn() }));
jest.mock('../eventLedgerService', () => ({ appendEventV1: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const service = require('../scheduleRemindersService');

function makeSchedule(overrides = {}) {
  const json = {
    id: 'sch-1',
    tenant_key: 'tenant-1',
    channel: 'whatsapp',
    contact_id: '5511999999999',
    conversation_id: 'conv-1',
    start_at: '2026-03-03T12:00:00.000Z',
    end_at: '2026-03-03T12:30:00.000Z',
    status: 'scheduled',
    requires_confirmation: true,
    confirmation_status: 'pending',
    timezone: 'UTC',
    ...overrides,
  };
  return {
    toJSON: () => ({ ...json }),
  };
}

describe('scheduleRemindersService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReminderModel.findAll.mockReset();
    mockReminderModel.findOne.mockReset();
    mockReminderModel.update.mockReset();
    mockReminderModel.update.mockResolvedValue([1]);
    mockReminderModel.findAll.mockResolvedValue([]);
    mockReminderModel.findOne.mockImplementation(async ({ where }) => {
      if (String(where?.id || '') !== 'r1') return null;
      return {
        toJSON: () => ({
          id: 'r1',
          tenant_key: 'tenant-1',
          schedule_id: 'sch-1',
          action: 'notify',
          channel: 'whatsapp',
          status: 'processing',
        }),
      };
    });
    mockEnqueue.mockResolvedValue({ queued: true, itemId: 'out-1' });
    mockScheduleModel.findOne.mockResolvedValue(makeSchedule());
  });

  test('processa reminder pending notify e marca done', async () => {
    mockReminderModel.findAll
      .mockResolvedValueOnce([]) // recovery stale
      .mockResolvedValueOnce([{ id: 'r1' }]); // due candidates

    mockReminderModel.update.mockImplementation(async (patch, options) => {
      if (options?.where?.id === 'r1' && options?.where?.status === 'pending') return [1];
      if (options?.where?.id === 'r1') return [1];
      return [0];
    });

    const out = await service.processDueRemindersBatch({ limit: 10 });
    expect(out.ok).toBe(true);
    expect(out.done).toBe(1);
    expect(out.failed).toBe(0);
    expect(mockEnqueue).toHaveBeenCalled();
    expect(mockReminderModel.update).toHaveBeenCalled();
  });

  test('duas execuções simultâneas não duplicam o mesmo reminder (lock)', async () => {
    mockReminderModel.findAll.mockImplementation(async ({ where } = {}) => {
      if (where?.status === 'processing') return [];
      if (where?.status === 'pending') return [{ id: 'r1' }];
      return [];
    });

    let claimed = false;
    mockReminderModel.update.mockImplementation(async (patch, options) => {
      if (options?.where?.id === 'r1' && options?.where?.status === 'pending') {
        if (claimed) return [0];
        claimed = true;
        return [1];
      }
      if (options?.where?.id === 'r1') return [1];
      return [0];
    });

    const [a, b] = await Promise.all([
      service.processDueRemindersBatch({ limit: 10 }),
      service.processDueRemindersBatch({ limit: 10 }),
    ]);

    expect((a.done + b.done)).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });
});
