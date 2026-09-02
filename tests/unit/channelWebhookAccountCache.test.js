'use strict';

/**
 * Item 6 — Cache de resolução webhook → channel_account.
 *
 * resolveTenantForWebhook fazia findOne em channel_accounts por external_id a
 * cada webhook/batch. Agora: cache em memória (TTL 60s) somente para acertos,
 * com invalidação explícita no CRUD de channelAccountsService.
 */

const mockAccountFindOne = jest.fn();
const mockAccountDestroy = jest.fn(async () => 1);

jest.mock('../../api/db/models', () => ({
  ChannelAccount: () => ({
    findOne: (...a) => mockAccountFindOne(...a),
    destroy: (...a) => mockAccountDestroy(...a),
  }),
  ChannelConversation: () => ({}),
  ChannelMessage: () => ({}),
  OutboundQueueItem: () => ({}),
}));
jest.mock('../../api/db/sequelize', () => ({ getSequelize: jest.fn(() => ({})) }));
jest.mock('../../api/services/queueService', () => ({
  getTicketBySession: jest.fn(),
  getTicketByConversationId: jest.fn(() => null),
  updateOutboundMessageMeta: jest.fn(),
}));
jest.mock('../../api/services/outboundQueueService', () => ({ enqueueOutbound: jest.fn() }));
jest.mock('../../api/services/ticketMediaService', () => ({ storeTicketMedia: jest.fn() }));
jest.mock('../../api/services/planLimitsService', () => ({
  checkLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock('../../api/services/workspace/WorkspaceLinkAutomationService', () => jest.fn().mockImplementation(() => ({
  linkMessageReceived: jest.fn(async () => null),
  linkTicketCreated: jest.fn(async () => null),
})));
jest.mock('../../api/utils/crypto', () => ({
  encrypt: jest.fn((v) => `enc:${v}`),
  decrypt: jest.fn((v) => String(v).replace(/^enc:/, '')),
}));
jest.mock('../../api/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const { resolveTenantForWebhook } = require('../../api/services/channelGatewayService');
const channelAccountsService = require('../../api/services/channelAccountsService');
const webhookAccountCache = require('../../api/services/channelAccountResolutionCache');
const { getSequelize } = require('../../api/db/sequelize');

const WA_PAYLOAD = { value: { metadata: { phone_number_id: 'pn-1' } } };

function accountRow(overrides = {}) {
  return {
    id: 'acct-1',
    tenant_key: 'tenant-1',
    type: 'whatsapp',
    external_id: 'pn-1',
    status: 'active',
    update: jest.fn(async () => null),
    ...overrides,
  };
}

describe('resolveTenantForWebhook — cache de channel account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    webhookAccountCache.clearAccountCache();
    // resetMocks global remove implementações — reestabelece o sequelize "up".
    getSequelize.mockReturnValue({});
    mockAccountDestroy.mockResolvedValue(1);
  });

  test('2 webhooks com o mesmo external_id fazem 1 query (cache hit)', async () => {
    mockAccountFindOne.mockResolvedValue(accountRow());

    const first = await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    const second = await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);

    expect(first.tenantId).toBe('tenant-1');
    expect(second.tenantId).toBe('tenant-1');
    expect(second.account).toBe(first.account);
    expect(mockAccountFindOne).toHaveBeenCalledTimes(1);
  });

  test('miss não é cacheado (onboarding de account nova não espera TTL)', async () => {
    mockAccountFindOne.mockResolvedValueOnce(null);

    const missing = await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    expect(missing).toEqual({ tenantId: null, account: null });

    mockAccountFindOne.mockResolvedValueOnce(accountRow());
    const afterCreate = await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    expect(afterCreate.tenantId).toBe('tenant-1');
    expect(mockAccountFindOne).toHaveBeenCalledTimes(2);
  });

  test('updateAccount invalida o cache (status/type/external_id podem mudar)', async () => {
    const row = accountRow();
    // 1ª chamada (webhook) popula o cache; 2ª chamada é o findOne do updateAccount.
    mockAccountFindOne.mockImplementation(async ({ where }) => {
      if (where && where.id === 'acct-1') return row;
      if (where && where.external_id === 'pn-1') return row;
      return null;
    });

    const resolved = await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    expect(resolved.tenantId).toBe('tenant-1');
    expect(mockAccountFindOne).toHaveBeenCalledTimes(1);

    const updated = await channelAccountsService.updateAccount({
      tenantId: 'tenant-1',
      id: 'acct-1',
      patch: { status: 'inactive' },
    });
    expect(updated.success).toBe(true);

    // Após invalidação, o próximo webhook consulta o DB de novo.
    await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    const callsAfterUpdate = mockAccountFindOne.mock.calls.length;
    expect(callsAfterUpdate).toBeGreaterThan(1);
  });

  test('deleteAccount limpa o cache (webhook para conta removida não resolve stale)', async () => {
    const row = accountRow();
    mockAccountFindOne.mockResolvedValue(row);

    await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    expect(webhookAccountCache.getCachedAccount('whatsapp', 'pn-1')).toBe(row);

    const deleted = await channelAccountsService.deleteAccount({ tenantId: 'tenant-1', id: 'acct-1' });
    expect(deleted.success).toBe(true);

    // Cache limpo: o próximo webhook reconsulta o DB (e não acha mais).
    expect(webhookAccountCache.getCachedAccount('whatsapp', 'pn-1')).toBeNull();
    mockAccountFindOne.mockResolvedValue(null);
    const afterDelete = await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    expect(afterDelete).toEqual({ tenantId: null, account: null });
    expect(mockAccountFindOne).toHaveBeenCalledTimes(2);
  });

  test('cache expira por TTL (backstop)', async () => {
    mockAccountFindOne.mockResolvedValue(accountRow());

    await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    expect(mockAccountFindOne).toHaveBeenCalledTimes(1);

    const realNow = Date.now;
    Date.now = () => realNow() + webhookAccountCache.WEBHOOK_ACCOUNT_CACHE_TTL_MS + 1000;
    try {
      await resolveTenantForWebhook('whatsapp', WA_PAYLOAD);
    } finally {
      Date.now = realNow;
    }
    expect(mockAccountFindOne).toHaveBeenCalledTimes(2);
  });
});
