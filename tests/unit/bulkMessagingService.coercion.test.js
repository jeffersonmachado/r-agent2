'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('bulkMessagingService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  test('createCampaign ignora phone hostil sem estourar', () => {
    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn(async () => ({ ok: true })),
    }));

    const { createCampaign } = require('../../api/services/bulkMessagingService');
    const hostilePhone = { toString() { throw new Error('boom-phone'); } };

    const out = createCampaign({
      tenantId: 'tenant-1',
      name: 'Campanha A',
      message: 'Mensagem',
      phoneNumbers: [hostilePhone, '+5511999999999'],
      createdBy: 'agent-1',
    });

    expect(out.success).toBe(true);
    expect(out.campaign.phoneNumbers).toEqual(['5511999999999']);
    expect(out.campaign.totalRecipients).toBe(1);
  });

  test('createCampaign com campos hostis retorna erro de validacao em vez de throw', () => {
    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn(async () => ({ ok: true })),
    }));

    const { createCampaign } = require('../../api/services/bulkMessagingService');
    const hostile = { toString() { throw new Error('boom-field'); } };

    const out = createCampaign({
      tenantId: 'tenant-1',
      name: hostile,
      message: hostile,
      phoneNumbers: ['+5511999999999'],
      createdBy: 'agent-1',
    });

    expect(out).toEqual({ success: false, error: 'Nome da campanha é obrigatório' });
  });

  test('startCampaign tolera error.message hostil no enqueue', async () => {
    const hostileError = {};
    Object.defineProperty(hostileError, 'message', {
      get() {
        throw new Error('boom-message-getter');
      },
    });

    const enqueueOutbound = jest.fn(async () => {
      throw hostileError;
    });

    jest.doMock('../../api/services/outboundQueueService', () => ({ enqueueOutbound }));

    const logger = require('../../api/utils/logger');
    const {
      createCampaign,
      startCampaign,
      getCampaign,
    } = require('../../api/services/bulkMessagingService');

    const created = createCampaign({
      tenantId: 'tenant-1',
      name: 'Campanha B',
      message: 'Mensagem B',
      phoneNumbers: ['+5511888888888'],
      createdBy: 'agent-1',
      rateLimit: 100,
    });

    expect(created.success).toBe(true);

    const start = await startCampaign(created.campaign.id);
    expect(start).toEqual({ success: true });

    // Aguarda o primeiro ciclo assíncrono de envio
    for (let i = 0; i < 10; i += 1) {
      const campaign = getCampaign(created.campaign.id);
      if (campaign.failedCount === 1) break;
      // eslint-disable-next-line no-await-in-loop
      await wait(10);
    }

    const campaign = getCampaign(created.campaign.id);
    expect(campaign.failedCount).toBe(1);
    expect(campaign.pendingCount).toBe(0);
    expect(campaign.deliveryStatus['5511888888888']).toBe('failed');
    expect(logger.error).toHaveBeenCalled();
  });

  test('listCampaigns usa tenantId normalizado com trim seguro', () => {
    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn(async () => ({ ok: true })),
    }));

    const {
      createCampaign,
      listCampaigns,
    } = require('../../api/services/bulkMessagingService');

    const created = createCampaign({
      tenantId: ' tenant-2 ',
      name: 'Campanha C',
      message: 'Mensagem C',
      phoneNumbers: ['+5511777777777'],
      createdBy: 'agent-1',
    });

    expect(created.success).toBe(true);

    const listed = listCampaigns({ tenantId: '  tenant-2  ' });
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0].tenantId).toBe('tenant-2');
  });

  test('startCampaign pausa com segurança quando tenantId da campanha é hostil', async () => {
    jest.doMock('../../api/services/outboundQueueService', () => ({
      enqueueOutbound: jest.fn(async () => ({ ok: true })),
    }));

    const logger = require('../../api/utils/logger');
    const {
      createCampaign,
      startCampaign,
      getCampaign,
    } = require('../../api/services/bulkMessagingService');

    const created = createCampaign({
      tenantId: 'tenant-hostile',
      name: 'Campanha D',
      message: 'Mensagem D',
      phoneNumbers: ['+5511666666666'],
      createdBy: 'agent-1',
      rateLimit: 60,
    });

    expect(created.success).toBe(true);

    const campaignRef = getCampaign(created.campaign.id);
    campaignRef.tenantId = {
      toString() {
        throw new Error('tenant toString hostile');
      },
    };

    const out = await startCampaign(created.campaign.id);
    expect(out).toEqual({ success: true });

    const campaignAfter = getCampaign(created.campaign.id);
    expect(campaignAfter.status).toBe('paused');
    expect(logger.error).toHaveBeenCalled();
  });
});
