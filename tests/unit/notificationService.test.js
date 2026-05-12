'use strict';

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../api/utils/config', () => ({
  getFromFile: jest.fn((path) => {
    if (path === 'notifications.whatsapp.enabled') return true;
    return undefined;
  }),
  get: jest.fn((path, defaultValue) => defaultValue),
}));

describe('notificationService', () => {
  let deliveries;
  let notificationModel;
  let subjectModel;
  let enqueueJob;
  let sendTextMessage;
  let sendMail;
  let appendEventV1;
  let service;

  function wrapRow(row) {
    return {
      ...row,
      toJSON() {
        return { ...this };
      },
      async update(patch) {
        Object.assign(this, patch);
        return this;
      },
    };
  }

  beforeEach(() => {
    jest.resetModules();
    deliveries = [];

    notificationModel = {
      async create(payload) {
        if (payload.idempotency_key) {
          const existing = deliveries.find((item) => item.tenant_key === payload.tenant_key && item.idempotency_key === payload.idempotency_key);
          if (existing) {
            const err = new Error('duplicate key');
            err.original = { code: '23505' };
            throw err;
          }
        }
        const row = wrapRow({ ...payload });
        deliveries.push(row);
        return row;
      },
      async findOne({ where }) {
        return deliveries.find((item) => (
          Object.entries(where).every(([key, value]) => item[key] === value)
        )) || null;
      },
      async findAndCountAll({ where }) {
        const rows = deliveries.filter((item) => (
          Object.entries(where).every(([key, value]) => item[key] === value)
        ));
        return { count: rows.length, rows };
      },
    };

    subjectModel = {
      async findOne() {
        return wrapRow({
          id: 'subject-1',
          tenant_key: 'tenant-1',
          customer_id: 'customer-1',
          metadata: { phone: '5511999999999', email: 'john@example.com' },
        });
      },
    };

    enqueueJob = jest.fn(async () => ({ id: 'job-1' }));
    sendTextMessage = jest.fn(async () => ({ messages: [{ id: 'wa-msg-1' }] }));
    sendMail = jest.fn(async () => ({ messageId: 'email-msg-1' }));
    appendEventV1 = jest.fn(async () => ({ id: 'evt-1' }));

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: jest.fn(() => ({})),
    }));

    jest.doMock('../../api/db/models', () => ({
      NotificationDelivery: () => notificationModel,
      AccessSubject: () => subjectModel,
    }));

    jest.doMock('../../api/services/executionQueueService', () => ({
      enqueueJob: (...args) => enqueueJob(...args),
    }));

    jest.doMock('../../api/services/whatsappService', () => ({
      sendTextMessage: (...args) => sendTextMessage(...args),
    }));

    jest.doMock('nodemailer', () => ({
      createTransport: jest.fn(() => ({
        sendMail: (...args) => sendMail(...args),
      })),
    }));

    jest.doMock('../../api/services/eventLedgerService', () => ({
      appendEventV1: (...args) => appendEventV1(...args),
    }));

    service = require('../../api/services/notificationService');
  });

  test('queueNotification cria registro canonico e job', async () => {
    const out = await service.queueNotification({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      eventType: 'reminder_24h',
      channel: 'whatsapp',
      metadata: { vertical: 'beauty' },
    });

    expect(out.queued).toBe(true);
    expect(out.item).toEqual(expect.objectContaining({
      tenant_key: 'tenant-1',
      event_type: 'reminder_24h',
      channel: 'whatsapp',
      vertical: 'beauty',
    }));
    expect(enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      kind: 'vertical_notification_dispatch',
      payload: expect.objectContaining({ notificationId: out.item.id }),
    }));
  });

  test('dispatchNotification envia com sucesso e persiste status sent', async () => {
    const queued = await service.queueNotification({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      eventType: 'billing_confirmed',
      channel: 'whatsapp',
      metadata: { vertical: 'fitness' },
    });

    const result = await service.dispatchNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
      jobId: 'job-99',
    });

    expect(result.ok).toBe(true);
    expect(sendTextMessage).toHaveBeenCalledWith('5511999999999', expect.stringContaining('Pagamento confirmado'));
    expect(result.delivery).toEqual(expect.objectContaining({
      status: 'sent',
      execution_job_id: 'job-99',
      provider_message_id: 'wa-msg-1',
      attempts: 1,
    }));
    expect(appendEventV1).toHaveBeenCalled();
  });

  test('dispatchNotification registra falha e incrementa attempts', async () => {
    sendTextMessage.mockRejectedValueOnce(new Error('provider_down'));
    const queued = await service.queueNotification({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      eventType: 'billing_overdue',
      channel: 'whatsapp',
      metadata: { vertical: 'fitness' },
    });

    const result = await service.dispatchNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
      jobId: 'job-2',
    });

    expect(result.ok).toBe(false);
    expect(result.delivery).toEqual(expect.objectContaining({
      status: 'failed',
      attempts: 1,
      last_error: 'provider_down',
    }));
  });

  test('dispatchNotification evita duplicidade quando ja enviada', async () => {
    const queued = await service.queueNotification({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      eventType: 'reminder_1h',
      channel: 'whatsapp',
      metadata: { vertical: 'beauty' },
    });

    await service.dispatchNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
      jobId: 'job-3',
    });
    sendTextMessage.mockClear();

    const second = await service.dispatchNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
      jobId: 'job-4',
    });

    expect(second.ok).toBe(true);
    expect(second.deduplicated).toBe(true);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  test('reprocessNotification reabre entrega e agenda novo job', async () => {
    sendTextMessage.mockRejectedValueOnce(new Error('provider_down'));
    const queued = await service.queueNotification({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      eventType: 'follow_up_sent',
      channel: 'whatsapp',
      metadata: { vertical: 'beauty' },
    });
    await service.dispatchNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
      jobId: 'job-failed',
    });

    const result = await service.reprocessNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
    });

    expect(result.ok).toBe(true);
    expect(result.item.status).toBe('pending');
    expect(enqueueJob).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'vertical_notification_dispatch',
      payload: expect.objectContaining({ notificationId: queued.item.id, force: true }),
    }));
  });

  test('dispatchNotification envia email com sucesso quando smtp esta configurado', async () => {
    const cfg = require('../../api/utils/config');
    cfg.get.mockImplementation((path, defaultValue) => {
      if (path === 'notifications.email.enabled') return true;
      if (path === 'notifications.email.smtp.host') return '127.0.0.1';
      if (path === 'notifications.email.smtp.port') return 1025;
      if (path === 'notifications.email.smtp.secure') return false;
      if (path === 'notifications.email.fromAddress') return 'qa@example.test';
      if (path === 'notifications.email.fromName') return 'QA Waves';
      return defaultValue;
    });

    const queued = await service.queueNotification({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      eventType: 'welcome_sent',
      channel: 'email',
      metadata: { vertical: 'fitness' },
    });

    const result = await service.dispatchNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
      jobId: 'job-email-1',
    });

    expect(result.ok).toBe(true);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: 'QA Waves <qa@example.test>',
      to: 'john@example.com',
      subject: 'welcome_sent',
    }));
    expect(result.delivery).toEqual(expect.objectContaining({
      status: 'sent',
      provider_message_id: 'email-msg-1',
      attempts: 1,
    }));
  });

  test('dispatchNotification retorna stub quando email esta desabilitado', async () => {
    const cfg = require('../../api/utils/config');
    cfg.get.mockImplementation((path, defaultValue) => {
      if (path === 'notifications.email.enabled') return false;
      return defaultValue;
    });

    const queued = await service.queueNotification({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
      eventType: 'welcome_sent',
      channel: 'email',
      metadata: { vertical: 'fitness' },
    });

    const result = await service.dispatchNotification({
      tenantId: 'tenant-1',
      notificationId: queued.item.id,
      jobId: 'job-email-2',
    });

    expect(result.ok).toBe(true);
    expect(result.delivery).toEqual(expect.objectContaining({
      status: 'stub',
      attempts: 1,
    }));
    expect(sendMail).not.toHaveBeenCalled();
  });

  test('dispatchNotification respeita habilitacao de email por env/config.get', async () => {
    const cfg = require('../../api/utils/config');
    cfg.get.mockImplementation((path, defaultValue) => {
      if (path === 'notifications.email.enabled') return true;
      if (path === 'notifications.email.smtp.host') return '127.0.0.1';
      if (path === 'notifications.email.smtp.port') return 1025;
      if (path === 'notifications.email.fromAddress') return 'qa@example.test';
      return defaultValue;
    });

    const result = await service.dispatchNotification({
      tenantId: 'tenant-1',
      jobId: 'job-email-env',
      fallbackPayload: {
        tenantId: 'tenant-1',
        channel: 'email',
        recipient: 'john@example.com',
        eventType: 'welcome_sent',
      },
    });

    expect(result.ok).toBe(true);
    expect(sendMail).toHaveBeenCalled();
  });
});
