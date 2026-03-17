'use strict';

// ── mock DB models ─────────────────────────────────────────────────────────────
jest.mock('../../api/db/models', () => ({
  EventLedger: jest.fn(),
}));

jest.mock('../../api/events/eventModelV1', () => ({
  buildEventV1: jest.fn((args) => ({
    id: 'evt-1',
    tenant_key: args.tenantId || '',
    type: args.type || 'test',
    source: args.source || 'test',
    occurred_at: new Date().toISOString(),
    correlation_id: null,
    subject: { type: null, id: null },
    actor: { type: null, id: null },
    idempotency_key: args.idempotencyKey || null,
    payload: args.payload || {},
  })),
}));

const { EventLedger } = require('../../api/db/models');
const { listEvents } = require('../../api/services/eventLedgerService');

describe('eventLedgerService', () => {
  let mockFindAndCountAll;

  beforeEach(() => {
    mockFindAndCountAll = jest.fn();
    // Re-wire EventLedger mock after resetMocks clears implementations
    EventLedger.mockReturnValue({ findAndCountAll: mockFindAndCountAll });
  });

  test('listEvents – nominal: retorna items e total corretamente', async () => {
    const fakeRow = { toJSON: () => ({ id: 'evt-1', type: 'ticket.created' }) };
    mockFindAndCountAll.mockResolvedValueOnce({ count: 1, rows: [fakeRow] });

    const result = await listEvents({ tenantId: 'tenant-a', type: 'ticket.created' });

    expect(result.ok).toBe(true);
    expect(result.total).toBe(1);
    expect(result.items).toEqual([{ id: 'evt-1', type: 'ticket.created' }]);
    expect(mockFindAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenant_key: 'tenant-a', type: 'ticket.created' }),
      }),
    );
  });

  test('listEvents – tenantId proxy revogado nao lanca, usa string vazia', async () => {
    // Proxy object that behaves like a string for String() but will throw when revoked
    const { proxy: hostiTenant, revoke } = Proxy.revocable({ toString: () => 'tenant-x' }, {
      get() { throw new TypeError('revoked'); },
    });
    revoke();

    mockFindAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

    // Must not throw; safeToString catches the TypeError and returns ''
    const result = await listEvents({ tenantId: hostiTenant });

    expect(result.ok).toBe(true);
    // safeToString de proxy revogado → '' (fallback)
    expect(mockFindAndCountAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenant_key: '' }) }),
    );
  });

  test('listEvents – limit/offset hostis (proxy revogado) usam defaults', async () => {
    const { proxy: hostiLimit, revoke: rl } = Proxy.revocable({ valueOf: () => 10 }, {
      get() { throw new TypeError('revoked'); },
    });
    const { proxy: hostiOffset, revoke: ro } = Proxy.revocable({ valueOf: () => 0 }, {
      get() { throw new TypeError('revoked'); },
    });
    rl();
    ro();

    mockFindAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

    const result = await listEvents({ tenantId: 'tenant-b', limit: hostiLimit, offset: hostiOffset });

    expect(result.ok).toBe(true);
    // safeToFiniteInt de proxy revogado → fallback (200 / 0)
    expect(result.limit).toBe(200);
    expect(result.offset).toBe(0);
  });

  test('listEvents – subjectType/subjectId/correlationId hostis nao lancam', async () => {
    const { proxy: hostiSubType, revoke: r1 } = Proxy.revocable({ toString: () => 'ticket' }, {
      get() { throw new TypeError('revoked'); },
    });
    const { proxy: hostiSubId, revoke: r2 } = Proxy.revocable({ toString: () => 'sub-1' }, {
      get() { throw new TypeError('revoked'); },
    });
    r1();
    r2();

    mockFindAndCountAll.mockResolvedValueOnce({ count: 0, rows: [] });

    await expect(
      listEvents({ tenantId: 'tenant-c', subjectType: hostiSubType, subjectId: hostiSubId }),
    ).resolves.toMatchObject({ ok: true });
  });
});
