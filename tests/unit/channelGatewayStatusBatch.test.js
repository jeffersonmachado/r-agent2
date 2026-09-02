'use strict';

/**
 * Regressão N+1 (channelGatewayService.updateStatus):
 * - Leituras: 1 findAll por tabela com external_message_id IN (...) (sem
 *   findOne por status do batch).
 * - Escritas: updates em lote agrupados por status (Model.update com
 *   external_message_id IN (...)) em vez de row.update por mensagem;
 *   outbound_queue agrupado por (status, reason_code, last_error) e filtrado
 *   por id (PK) para só tocar a row mais recente de cada external_message_id.
 */

const mockMessageFindAll = jest.fn();
const mockMessageFindOne = jest.fn();
const mockMessageUpdate = jest.fn(async () => [0]);
const mockOutFindAll = jest.fn();
const mockOutFindOne = jest.fn();
const mockOutUpdate = jest.fn(async () => [0]);

jest.mock('../../api/db/models', () => ({
  ChannelAccount: () => ({ findOne: jest.fn(async () => null) }),
  ChannelConversation: () => ({}),
  ChannelMessage: () => ({
    findAll: (...a) => mockMessageFindAll(...a),
    findOne: (...a) => mockMessageFindOne(...a),
    update: (...a) => mockMessageUpdate(...a),
  }),
  OutboundQueueItem: () => ({
    findAll: (...a) => mockOutFindAll(...a),
    findOne: (...a) => mockOutFindOne(...a),
    update: (...a) => mockOutUpdate(...a),
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

const { Op } = require('sequelize');
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
    mockMessageUpdate.mockResolvedValue([0]);
    mockOutUpdate.mockResolvedValue([0]);
  });

  it('faz 1 findAll por tabela (não findOne por status) e atualiza mensagens em lote por status', async () => {
    const rows = [makeRow('wamid.1'), makeRow('wamid.2'), makeRow('wamid.3')];
    mockMessageFindAll.mockResolvedValue(rows);
    const outRow = makeRow('wamid.2', { id: 'out-2', reason_code: null, last_error: null });
    mockOutFindAll.mockResolvedValue([outRow]);

    const payload = {
      value: {
        statuses: [
          { id: 'wamid.1', status: 'sent' },
          { id: 'wamid.2', status: 'delivered' },
          { id: 'wamid.3', status: 'delivered' },
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
    expect(where.external_message_id[Op.in]).toEqual(['wamid.1', 'wamid.2', 'wamid.3']);

    // Escritas em lote: 1 UPDATE por status distinto (sent + delivered),
    // sem row.update por mensagem.
    expect(mockMessageUpdate).toHaveBeenCalledTimes(2);
    for (const row of rows) expect(row.update).not.toHaveBeenCalled();

    const byStatus = new Map(mockMessageUpdate.mock.calls.map(([fields]) => [fields.status, fields]));
    expect(byStatus.get('sent').updated_at).toBeInstanceOf(Date);
    expect(byStatus.get('delivered').updated_at).toBeInstanceOf(Date);

    const sentWhere = mockMessageUpdate.mock.calls.find(([f]) => f.status === 'sent')[1].where;
    expect(sentWhere.tenant_key).toBe('tenant-1');
    expect(sentWhere.channel_type).toBe('whatsapp');
    expect(sentWhere.external_message_id[Op.in]).toEqual(['wamid.1']);

    const deliveredWhere = mockMessageUpdate.mock.calls.find(([f]) => f.status === 'delivered')[1].where;
    expect(deliveredWhere.external_message_id[Op.in]).toEqual(['wamid.2', 'wamid.3']);

    // outbound_queue: 1 update em lote por id (PK), nunca por instância.
    expect(outRow.update).not.toHaveBeenCalled();
    expect(mockOutUpdate).toHaveBeenCalledTimes(1);
    const [outFields, outOpts] = mockOutUpdate.mock.calls[0];
    expect(outFields.status).toBe('delivered');
    // Não-failed não reescreve reason_code/last_error (preservados no DB).
    expect(outFields).not.toHaveProperty('reason_code');
    expect(outFields).not.toHaveProperty('last_error');
    expect(outOpts.where.id[Op.in]).toEqual(['out-2']);
  });

  it('failed propaga reason_code/last_error; não-failed preserva valores anteriores do outbound', async () => {
    mockMessageFindAll.mockResolvedValue([makeRow('wamid.f'), makeRow('wamid.ok')]);
    const outFailed = makeRow('wamid.f', { id: 'out-f', reason_code: 'old', last_error: 'old-error' });
    const outOk = makeRow('wamid.ok', { id: 'out-ok', reason_code: 'keep', last_error: 'keep-error' });
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
    expect(mockOutUpdate).toHaveBeenCalledTimes(2);

    const failedCall = mockOutUpdate.mock.calls.find(([f]) => f.status === 'failed');
    expect(failedCall[0].reason_code).toBe('131026');
    expect(failedCall[0].last_error).toContain('131026');
    expect(failedCall[1].where.id[Op.in]).toEqual(['out-f']);

    const okCall = mockOutUpdate.mock.calls.find(([f]) => f.status === 'delivered');
    // Não-failed: reason_code/last_error ficam intactos no banco (não escritos).
    expect(okCall[0]).not.toHaveProperty('reason_code');
    expect(okCall[0]).not.toHaveProperty('last_error');
    expect(okCall[1].where.id[Op.in]).toEqual(['out-ok']);
  });

  it('falha no update em lote de channel_messages propaga (sem fallback silencioso)', async () => {
    mockMessageFindAll.mockResolvedValue([makeRow('wamid.1')]);
    mockOutFindAll.mockResolvedValue([]);
    mockMessageUpdate.mockRejectedValueOnce(new Error('db down'));

    await expect(updateStatus(
      'whatsapp',
      { value: { statuses: [{ id: 'wamid.1', status: 'sent' }] } },
      { tenantId: 'tenant-1' },
    )).rejects.toThrow('db down');
  });

  it('falha no update do outbound_queue é best-effort (não derruba o batch)', async () => {
    mockMessageFindAll.mockResolvedValue([makeRow('wamid.1')]);
    mockOutFindAll.mockResolvedValue([makeRow('wamid.1', { id: 'out-1', reason_code: null, last_error: null })]);
    mockOutUpdate.mockRejectedValueOnce(new Error('outbound down'));

    const result = await updateStatus(
      'whatsapp',
      { value: { statuses: [{ id: 'wamid.1', status: 'sent' }] } },
      { tenantId: 'tenant-1' },
    );

    expect(result.updated).toBe(1);
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
    expect(mockMessageUpdate).not.toHaveBeenCalled();
  });

  it('batch vazio de statuses não toca no banco', async () => {
    const result = await updateStatus('whatsapp', { value: { statuses: [] } }, { tenantId: 'tenant-1' });
    expect(result.updated).toBe(0);
    expect(mockMessageFindAll).not.toHaveBeenCalled();
    expect(mockOutFindAll).not.toHaveBeenCalled();
    expect(mockMessageUpdate).not.toHaveBeenCalled();
    expect(mockOutUpdate).not.toHaveBeenCalled();
  });
});
