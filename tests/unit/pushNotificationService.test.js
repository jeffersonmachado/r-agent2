'use strict';

/**
 * Testes unitários do pushNotificationService (Web Push do PWA).
 *
 * Cobre: validação da inscrição, upsert por tenant+endpoint, unsubscribe,
 * fail-closed sem VAPID (skipped, nunca lança), envio com VAPID e higiene
 * de inscrições expiradas (404/410 → remoção).
 */

const webpush = require('web-push');
const { getSequelize } = require('../../api/db/sequelize');
const { PushSubscription } = require('../../api/db/models');
const logger = require('../../api/utils/logger');

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(),
}));

jest.mock('../../api/db/models', () => ({
  PushSubscription: jest.fn(),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const service = require('../../api/services/pushNotificationService');

const VAPID_ENV = {
  WEBPUSH_VAPID_PUBLIC_KEY: 'BPubKeyTest',
  WEBPUSH_VAPID_PRIVATE_KEY: 'PrivKeyTest',
  WEBPUSH_SUBJECT: 'mailto:push@test.local',
};

function buildModel(overrides = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    destroy: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

function buildRow(data) {
  return {
    ...data,
    update: jest.fn().mockResolvedValue(undefined),
    toJSON: () => ({ ...data }),
  };
}

describe('services/pushNotificationService', () => {
  let model;

  beforeEach(() => {
    delete process.env.WEBPUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEBPUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEBPUSH_SUBJECT;
    model = buildModel();
    PushSubscription.mockReturnValue(model);
    getSequelize.mockReturnValue({});
  });

  afterEach(() => {
    delete process.env.WEBPUSH_VAPID_PUBLIC_KEY;
    delete process.env.WEBPUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEBPUSH_SUBJECT;
  });

  describe('configuração VAPID (fail-closed)', () => {
    it('sem chaves: isConfigured=false e publicKey=null', () => {
      expect(service.isConfigured()).toBe(false);
      expect(service.publicKey()).toBeNull();
    });

    it('com chaves: isConfigured=true e expõe apenas a pública', () => {
      Object.assign(process.env, VAPID_ENV);
      expect(service.isConfigured()).toBe(true);
      expect(service.publicKey()).toBe('BPubKeyTest');
    });
  });

  describe('subscribe', () => {
    const validSubscription = {
      endpoint: 'https://push.example.com/sub/abc',
      keys: { p256dh: 'p256', auth: 'auth' },
    };

    it('cria inscrição nova com tenant+user', async () => {
      model.create.mockResolvedValue(buildRow({ id: 'psub-1' }));

      const result = await service.subscribe({
        tenantId: 't1',
        userId: 'u1',
        subscription: validSubscription,
        deviceName: 'Pixel 8',
      });

      expect(model.create).toHaveBeenCalledWith(expect.objectContaining({
        tenant_key: 't1',
        user_id: 'u1',
        endpoint: validSubscription.endpoint,
        keys: validSubscription.keys,
        device_name: 'Pixel 8',
      }));
      expect(result.id).toBe('psub-1');
    });

    it('upsert: mesmo endpoint atualiza a inscrição existente sem duplicar', async () => {
      const existing = buildRow({ id: 'psub-9', tenant_key: 't1', endpoint: validSubscription.endpoint });
      model.findOne.mockResolvedValue(existing);

      const result = await service.subscribe({
        tenantId: 't1',
        userId: 'u2',
        subscription: validSubscription,
      });

      expect(model.create).not.toHaveBeenCalled();
      expect(existing.update).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u2' }));
      expect(result.id).toBe('psub-9');
    });

    it('rejeita inscrição sem endpoint/keys com validation_error', async () => {
      await expect(service.subscribe({
        tenantId: 't1',
        userId: 'u1',
        subscription: { endpoint: 'https://x' },
      })).rejects.toMatchObject({ code: 'validation_error' });

      await expect(service.subscribe({
        tenantId: 't1',
        userId: 'u1',
        subscription: { endpoint: '', keys: { p256dh: 'a', auth: 'b' } },
      })).rejects.toMatchObject({ code: 'validation_error' });

      expect(model.create).not.toHaveBeenCalled();
    });

    it('sem banco: persistence_required (sem fallback em memória)', async () => {
      getSequelize.mockReturnValue(null);
      await expect(service.subscribe({
        tenantId: 't1',
        userId: 'u1',
        subscription: validSubscription,
      })).rejects.toThrow(/persistence_required/);
    });
  });

  describe('unsubscribe', () => {
    it('remove por tenant+endpoint e reporta a contagem', async () => {
      model.destroy.mockResolvedValue(1);
      const result = await service.unsubscribe({ tenantId: 't1', endpoint: 'https://push.example.com/sub/abc' });
      expect(model.destroy).toHaveBeenCalledWith({
        where: { tenant_key: 't1', endpoint: 'https://push.example.com/sub/abc' },
      });
      expect(result).toEqual({ removed: 1 });
    });
  });

  describe('sendToUser', () => {
    const subRow = {
      endpoint: 'https://push.example.com/sub/1',
      keys: { p256dh: 'p', auth: 'a' },
      user_id: 'u1',
    };

    it('sem VAPID: skipped=true e nunca lança (fail-closed silencioso)', async () => {
      const result = await service.sendToUser({ tenantId: 't1', userId: 'u1', payload: { title: 'x' } });
      expect(result).toEqual({ sent: 0, removed: 0, skipped: true });
      expect(webpush.sendNotification).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('com VAPID: envia para todas as inscrições do usuário', async () => {
      Object.assign(process.env, VAPID_ENV);
      model.findAll.mockResolvedValue([buildRow(subRow), buildRow({ ...subRow, endpoint: 'https://push.example.com/sub/2' })]);
      webpush.sendNotification.mockResolvedValue({});

      const result = await service.sendToUser({ tenantId: 't1', userId: 'u1', payload: { title: 'Nova mensagem' } });

      expect(webpush.setVapidDetails).toHaveBeenCalledWith(VAPID_ENV.WEBPUSH_SUBJECT, VAPID_ENV.WEBPUSH_VAPID_PUBLIC_KEY, VAPID_ENV.WEBPUSH_VAPID_PRIVATE_KEY);
      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ sent: 2, removed: 0, skipped: false });
    });

    it('410/404: remove a inscrição expirada e continua com as demais', async () => {
      Object.assign(process.env, VAPID_ENV);
      model.findAll.mockResolvedValue([
        buildRow(subRow),
        buildRow({ ...subRow, endpoint: 'https://push.example.com/sub/ok' }),
      ]);
      webpush.sendNotification
        .mockRejectedValueOnce({ statusCode: 410 })
        .mockResolvedValueOnce({});
      model.destroy.mockResolvedValue(1);

      const result = await service.sendToUser({ tenantId: 't1', userId: 'u1', payload: {} });

      expect(result).toEqual({ sent: 1, removed: 1, skipped: false });
      expect(model.destroy).toHaveBeenCalledWith({
        where: { tenant_key: 't1', endpoint: 'https://push.example.com/sub/1' },
      });
    });

    it('falha transitória (500): não remove a inscrição', async () => {
      Object.assign(process.env, VAPID_ENV);
      model.findAll.mockResolvedValue([buildRow(subRow)]);
      webpush.sendNotification.mockRejectedValue({ statusCode: 500, message: 'push service down' });

      const result = await service.sendToUser({ tenantId: 't1', userId: 'u1', payload: {} });

      expect(result).toEqual({ sent: 0, removed: 0, skipped: false });
      expect(model.destroy).not.toHaveBeenCalled();
    });
  });

  describe('sendToTenant', () => {
    it('sem VAPID: skipped=true', async () => {
      const result = await service.sendToTenant({ tenantId: 't1', payload: {} });
      expect(result).toEqual({ sent: 0, removed: 0, skipped: true });
    });

    it('exclui excludeUserIds e deduplica usuários', async () => {
      Object.assign(process.env, VAPID_ENV);
      // 1ª chamada findAll: usuários do tenant; demais: inscrições por usuário
      model.findAll
        .mockResolvedValueOnce([
          buildRow({ user_id: 'u1' }),
          buildRow({ user_id: 'u1' }),
          buildRow({ user_id: 'u2' }),
        ])
        .mockResolvedValue([buildRow({ endpoint: 'https://push.example.com/sub/x', keys: { p256dh: 'p', auth: 'a' } })]);
      webpush.sendNotification.mockResolvedValue({});

      const result = await service.sendToTenant({ tenantId: 't1', payload: { title: 't' }, excludeUserIds: ['u2'] });

      // Apenas u1 recebeu (u2 excluído; duplicata de u1 deduplicada)
      expect(result.sent).toBe(1);
      expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    });
  });
});
