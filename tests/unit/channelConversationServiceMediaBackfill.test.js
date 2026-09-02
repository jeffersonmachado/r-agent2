'use strict';

/**
 * Item 1 — Backfill de mídia fora do hot path de leitura do Inbox.
 *
 * listConversationMessages não awaita mais backfillPersistedMessageMedia por
 * row: retorna imediatamente com os dados persistidos e agenda o backfill em
 * background (fire-and-forget com catch → logger.warn, sem unhandledRejection,
 * account resolvida uma única vez por lote).
 */

const mockBackfill = jest.fn();
const mockResolveAccount = jest.fn();
const mockLoggerWarn = jest.fn();

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: (...args) => mockLoggerWarn(...args),
  error: jest.fn(),
}));

jest.mock('../../api/services/channelGatewayService', () => ({
  backfillPersistedMessageMedia: (...args) => mockBackfill(...args),
  resolveWhatsAppAccountForBackfill: (...args) => mockResolveAccount(...args),
}));

const mockMessageFindAndCountAll = jest.fn();

// Nota: resetMocks global — os mocks usam funções estáveis (não jest.fn) nas
// factories para sobreviver ao reset por teste.
jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => ({}),
}));

jest.mock('../../api/db/models', () => ({
  ChannelConversation: () => ({}),
  ChannelMessage: () => ({
    findAndCountAll: (...a) => mockMessageFindAndCountAll(...a),
  }),
  Ticket: () => ({}),
}));

const { listConversationMessages } = require('../../api/services/channelConversationService');

function makeMessageRow(id, overrides = {}) {
  return {
    id,
    tenant_key: 'tenant-1',
    conversation_id: 'conv-1',
    channel_type: 'whatsapp',
    direction: 'in',
    type: 'image',
    body: { image: { id: `media-${id}` } }, // sem mediaUrl → candidato a backfill
    external_message_id: `wamid.${id}`,
    status: 'received',
    created_at: new Date('2026-09-01T10:00:00Z'),
    update: jest.fn(async () => null),
    ...overrides,
  };
}

function flushBackground() {
  // setImmediate (agendamento) + microtasks do loop sequencial de backfill.
  return new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
}

describe('channelConversationService.listConversationMessages — backfill fora do hot path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveAccount.mockResolvedValue({ id: 'acct-1', tenant_key: 'tenant-1' });
    mockBackfill.mockResolvedValue(true);
  });

  test('retorna imediatamente com os dados persistidos, sem awaitar backfill', async () => {
    // Backfill que NUNCA resolve: se a listagem awaitasse, o teste travaria.
    mockBackfill.mockReturnValue(new Promise(() => {}));
    const rows = [makeMessageRow('m1'), makeMessageRow('m2')];
    mockMessageFindAndCountAll.mockResolvedValue({ count: 2, rows });

    const result = await listConversationMessages({ tenantId: 'tenant-1', conversationId: 'conv-1' });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('m1');
    // A listagem retornou e o backfill nem chegou a rodar (agendado via setImmediate).
    expect(mockBackfill).not.toHaveBeenCalled();
  });

  test('backfill roda em background, uma account por lote, só para candidatos whatsapp sem mediaUrl', async () => {
    const rows = [
      makeMessageRow('m1'),
      makeMessageRow('m2'),
      makeMessageRow('m3', { body: { image: { id: 'media-m3' }, mediaUrl: '/tickets/media/x' } }), // já tem mediaUrl
      makeMessageRow('m4', { channel_type: 'instagram' }), // não é whatsapp
      makeMessageRow('m5', { type: 'text', body: { text: 'oi' } }), // sem mediaRef
    ];
    mockMessageFindAndCountAll.mockResolvedValue({ count: rows.length, rows });

    const result = await listConversationMessages({ tenantId: 'tenant-1', conversationId: 'conv-1' });
    expect(result.items).toHaveLength(5);

    await flushBackground();

    // Account resolvida UMA vez para o lote inteiro.
    expect(mockResolveAccount).toHaveBeenCalledTimes(1);
    expect(mockResolveAccount).toHaveBeenCalledWith('tenant-1');

    // Candidatos: m1, m2 (whatsapp sem mediaUrl). m3/m4 filtrados no service;
    // m5 chega ao backfill (pré-filtro barato não inspeciona mediaRef) mas a
    // semântica de "sem mídia → false" continua no channelGatewayService.
    const backfilledIds = mockBackfill.mock.calls.map(([args]) => args.messageRow.id);
    expect(backfilledIds).toEqual(['m1', 'm2', 'm5']);
    for (const [args] of mockBackfill.mock.calls) {
      expect(args.tenantId).toBe('tenant-1');
      expect(args.account).toEqual({ id: 'acct-1', tenant_key: 'tenant-1' });
    }
  });

  test('sem account whatsapp única ativa, nenhum backfill roda', async () => {
    mockResolveAccount.mockResolvedValue(null);
    const rows = [makeMessageRow('m1')];
    mockMessageFindAndCountAll.mockResolvedValue({ count: 1, rows });

    await listConversationMessages({ tenantId: 'tenant-1', conversationId: 'conv-1' });
    await flushBackground();

    expect(mockResolveAccount).toHaveBeenCalledTimes(1);
    expect(mockBackfill).not.toHaveBeenCalled();
  });

  test('erro no backfill vira logger.warn (best-effort), sem unhandledRejection', async () => {
    mockBackfill.mockRejectedValue(new Error('provider down'));
    const rows = [makeMessageRow('m1')];
    mockMessageFindAndCountAll.mockResolvedValue({ count: 1, rows });

    const result = await listConversationMessages({ tenantId: 'tenant-1', conversationId: 'conv-1' });
    expect(result.items).toHaveLength(1);

    await flushBackground();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      '[channelConversationService] Backfill de mídia em background falhou (best-effort)',
      expect.objectContaining({ tenantId: 'tenant-1', error: 'provider down' }),
    );
  });

  test('sem mensagens candidatas, nada é agendado', async () => {
    const rows = [makeMessageRow('m1', { body: { text: 'oi' }, type: 'text' })];
    mockMessageFindAndCountAll.mockResolvedValue({ count: 1, rows });

    // Texto puro: body sem mediaUrl E channel whatsapp → entra no pré-filtro
    // (url/mediaUrl vazio). Para isolar "sem candidato", usar outro canal.
    rows[0].channel_type = 'instagram';

    await listConversationMessages({ tenantId: 'tenant-1', conversationId: 'conv-1' });
    await flushBackground();

    expect(mockResolveAccount).not.toHaveBeenCalled();
    expect(mockBackfill).not.toHaveBeenCalled();
  });
});
