'use strict';

/**
 * Regressão N+1 (channelGatewayService.updateStatus):
 * webhook de status do WhatsApp fazia findOne em channel_messages + findOne em
 * outbound_queue por status do batch (4 queries/item). Agora: 1 findAll por
 * tabela com external_message_id IN (...), mapa em memória e updates por item.
 */

const mockMessageFindAll = jest.fn();
const mockMessageFindOne = jest.fn();
const mockOutFindAll = jest.fn();
const mockOutFindOne = jest.fn();

jest.mock('../../api/db/models', () => ({
  ChannelAccount: () => ({ findOne: jest.fn(async () => null) }),
  ChannelConversation: () => ({}),
  ChannelMessage: () => ({
    findAll: (...a) => mockMessageFindAll(...a),
    findOne: (...a) => mockMessageFindOne(...a),
  }),
  OutboundQueueItem: () => ({
    findAll: (...a) => mockOutFindAll(...a),
    findOne: (...a) => mockOutFindOne(...a),
  }),
}));
jest.mock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
jest.mock('../../api/services/queueService', () => ({
  getTicketBySession: jest.fn(),
  getTicketByConversationId: jest.fn(() => null),
  updateOutboundMessageMeta: jest.fn(),
}));
jest.mock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));
jest.mock('../../api/services/ticketMediaService', () => ({ storeTicketMedia: jest.fn() }));
jest.mock('../../api/services/workspace/WorkspaceLinkAutomationService', () => jest.fn().mockImplementation(() => ({
  linkMessageReceived: jest.fn(async () => null),
})));
jest.mock('../../api/utils/crypto', () => ({ encrypt: jest.fn(), decrypt: jest.fn() }));
jest.mock('../../api/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { updateStatus } = require('../../api/services/channelGatewayService');
const { getSequelize } = require('../../api/db/sequelize');

function makeRow(externalId, extra = {}) {
  return {
    external_message_id: externalId,
    conversation_id: null,
    update: jest.fn(async () => null),
    ...extra,
  };
}

describe('channelGatewayService.updateStatus — batch sem N+1', () => {
  beforeEach(() => {
    // resetMocks global remove implementações — reestabelece o sequelize "up".
    getSequelize.mockReturnValue({});
  });

  it('faz 1 findAll por tabela (não findOne por status) e atualiza cada mensagem', async () => {
    const rows = [makeRow('wamid.1'), makeRow('wamid.2'), makeRow('wamid.3')];
    mockMessageFindAll.mockResolvedValue(rows);
    const outRow = makeRow('wamid.2', { reason_code: null, last_error: null });
    mockOutFindAll.mockResolvedValue([outRow]);

    const payload = {
      value: {
        statuses: [
          { id: 'wamid.1', status: 'sent' },
          { id: 'wamid.2', status: 'delivered' },
          { id: 'wamid.3', status: 'read' },
        ],
      },
    };
    const result = await updateStatus('whatsapp', payload, { tenantId: 'tenant-1' });

    expect(result.updated).toBe(3);
    // O(1) leituras: antes seriam 3 findOne em cada tabela (6 leituras).
    expect(mockMessageFindAll).toHaveBeenCalledTimes(1);
    expect(mockOutFindAll).toHaveBeenCalledTimes(1);
    expect(mockMessageFindOne).not.toHaveBeenCalled();
    expect(mockOutFindOne).not.toHaveBeenCalled();

    const where = mockMessageFindAll.mock.calls[0][0].where;
    expect(where.tenant_key).toBe('tenant-1');
    expect(where.channel_type).toBe('whatsapp');
    const { Op } = require('sequelize');
    expect(where.external_message_id[Op.in]).toEqual(['wamid.1', 'wamid.2', 'wamid.3']);

    for (const row of rows) expect(row.update).toHaveBeenCalledTimes(1);
    expect(outRow.update).toHaveBeenCalledTimes(1);
    expect(outRow.update.mock.calls[0][0].status).toBe('delivered');
  });

  it('failed propaga reason_code/last_error; não-failed preserva valores anteriores do outbound', async () => {
    mockMessageFindAll.mockResolvedValue([makeRow('wamid.f'), makeRow('wamid.ok')]);
    const outFailed = makeRow('wamid.f', { reason_code: 'old', last_error: 'old-error' });
    const outOk = makeRow('wamid.ok', { reason_code: 'keep', last_error: 'keep-error' });
    mockOutFindAll.mockResolvedValue([outFailed, outOk]);

    const payload = {
      value: {
        statuses: [
          { id: 'wamid.f', status: 'failed', errors: [{ code: 131026, title: 'Message undeliverable' }] },
          { id: 'wamid.ok', status: 'delivered' },
        ],
      },
    };
    const result = await updateStatus('whatsapp', payload, { tenantId: 'tenant-1' });

    expect(result.updated).toBe(2);

    const failedUpdate = outFailed.update.mock.calls[0][0];
    expect(failedUpdate.status).toBe('failed');
    expect(failedUpdate.reason_code).toBe('131026');
    expect(failedUpdate.last_error).toContain('131026');

    const okUpdate = outOk.update.mock.calls[0][0];
    expect(okUpdate.status).toBe('delivered');
    expect(okUpdate.reason_code).toBe('keep');
    expect(okUpdate.last_error).toBe('keep-error');
  });

  it('status sem mensagem persistida é ignorado (updated=0)', async () => {
    mockMessageFindAll.mockResolvedValue([]);
    mockOutFindAll.mockResolvedValue([]);

    const result = await updateStatus(
      'whatsapp',
      { value: { statuses: [{ id: 'wamid.x', status: 'sent' }] } },
      { tenantId: 'tenant-1' },
    );

    expect(result.updated).toBe(0);
    expect(mockMessageFindAll).toHaveBeenCalledTimes(1);
  });

  it('batch vazio de statuses não toca no banco', async () => {
    const result = await updateStatus('whatsapp', { value: { statuses: [] } }, { tenantId: 'tenant-1' });
    expect(result.updated).toBe(0);
    expect(mockMessageFindAll).not.toHaveBeenCalled();
    expect(mockOutFindAll).not.toHaveBeenCalled();
  });
});
