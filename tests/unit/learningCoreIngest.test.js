'use strict';

const mockAppendEventV1 = jest.fn(async () => ({}));
const mockFindOrCreate = jest.fn();
const mockSessionUpdate = jest.fn(async () => ({}));

jest.mock('../../api/services/eventLedgerService', () => ({
  appendEventV1: (...args) => mockAppendEventV1(...args),
}));

jest.mock('../../api/db/models/UserInteractionSession', () => () => ({
  findOrCreate: (...args) => mockFindOrCreate(...args),
}));

jest.mock('../../api/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const {
  ingestInteractionBatch,
  MAX_BATCH_SIZE,
} = require('../../api/modules/learning-core/service');

const baseArgs = () => ({
  tenantId: 'system',
  agentId: 42,
  username: 'systemadmin',
  sessionId: 'sess-123',
  events: [
    {
      type: 'navigation',
      clientEventId: 'evt-1',
      occurredAt: new Date('2026-07-23T10:00:00Z').toISOString(),
      route: '/inbox',
      durationMs: 1500,
      metadata: { from: '/dashboard' },
    },
    {
      type: 'click',
      clientEventId: 'evt-2',
      target: 'button:send',
      route: '/inbox',
    },
  ],
});

describe('learning-core ingestInteractionBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppendEventV1.mockResolvedValue({});
    mockFindOrCreate.mockResolvedValue([
      {
        routesVisited: [],
        eventCount: 0,
        update: mockSessionUpdate,
      },
      true,
    ]);
  });

  test('aceita lote valido e persiste eventos learning.interaction.* no ledger', async () => {
    const result = await ingestInteractionBatch(baseArgs());

    expect(result).toEqual({ accepted: 2, rejected: 0 });
    expect(mockAppendEventV1).toHaveBeenCalledTimes(2);

    const [firstCall] = mockAppendEventV1.mock.calls[0];
    expect(firstCall.tenantId).toBe('system');
    expect(firstCall.type).toBe('learning.interaction.navigation');
    expect(firstCall.source).toBe('learning-core');
    expect(firstCall.correlationId).toBe('sess-123');
    expect(firstCall.subject).toEqual({ type: 'user_session', id: 'sess-123' });
    expect(firstCall.actor).toEqual({ type: 'agent', id: '42' });
    expect(firstCall.idempotencyKey).toBe('sess-123:evt-1');
    expect(firstCall.payload.route).toBe('/inbox');
    expect(firstCall.payload.durationMs).toBe(1500);
  });

  test('atualiza agregado de sessao com rotas mescladas e contagem', async () => {
    await ingestInteractionBatch(baseArgs());

    expect(mockFindOrCreate).toHaveBeenCalledTimes(1);
    expect(mockSessionUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockSessionUpdate.mock.calls[0][0];
    expect(updateArg.eventCount).toBe(2);
    expect(updateArg.routesVisited).toContain('/inbox');
  });

  test('rejeita lote sem sessionId com BAD_REQUEST', async () => {
    const args = baseArgs();
    args.sessionId = '';
    await expect(ingestInteractionBatch(args)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(mockAppendEventV1).not.toHaveBeenCalled();
  });

  test('rejeita lote vazio com BAD_REQUEST', async () => {
    const args = baseArgs();
    args.events = [];
    await expect(ingestInteractionBatch(args)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('rejeita lote acima do tamanho maximo com BAD_REQUEST', async () => {
    const args = baseArgs();
    args.events = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => ({
      type: 'navigation',
      clientEventId: `evt-${i}`,
      route: '/x',
    }));
    await expect(ingestInteractionBatch(args)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  test('descarta eventos com tipo invalido e conta como rejected', async () => {
    const args = baseArgs();
    args.events.push({ type: 'password', clientEventId: 'evt-3', route: '/secret' });
    args.events.push({ type: 'click', occurredAt: 'data-invalida' });

    const result = await ingestInteractionBatch(args);

    expect(result).toEqual({ accepted: 2, rejected: 2 });
    expect(mockAppendEventV1).toHaveBeenCalledTimes(2);
  });

  test('sanitiza payload por whitelist (campos fora da whitelist sao removidos)', async () => {
    const args = baseArgs();
    args.events = [
      {
        type: 'click',
        clientEventId: 'evt-9',
        route: '/inbox',
        target: 'button:send',
        password: 'segredo',
        text: 'conteudo digitado pelo usuario',
      },
    ];

    await ingestInteractionBatch(args);

    const [call] = mockAppendEventV1.mock.calls[0];
    expect(call.payload.password).toBeUndefined();
    expect(call.payload.text).toBeUndefined();
    expect(call.payload.target).toBe('button:send');
  });

  test('falha do agregado nao derruba a ingestao (ledger integro)', async () => {
    const logger = require('../../api/utils/logger');
    mockFindOrCreate.mockRejectedValueOnce(new Error('db indisponivel'));

    const result = await ingestInteractionBatch(baseArgs());

    expect(result).toEqual({ accepted: 2, rejected: 0 });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('[learning-core]'),
      expect.objectContaining({ sessionId: 'sess-123' }),
    );
  });

  test('falha do ledger propaga o erro', async () => {
    mockAppendEventV1.mockRejectedValueOnce(new Error('ledger down'));

    await expect(ingestInteractionBatch(baseArgs())).rejects.toThrow('ledger down');
  });
});
