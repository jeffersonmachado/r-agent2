'use strict';

/**
 * Regressão do safe cold-start do cursor de dispatch de eventos.
 *
 * O cursor `event_dispatch_state.last_received_at` NUNCA pode nascer em
 * 1970-01-01: num BD com histórico, o primeiro scan varre tudo e dispara
 * webhook/flows retroativos em massa (flood). O cold-start deve começar no
 * evento mais recente (ou NOW) e curar cursors legados presos em 1970.
 */

const mockQuery = jest.fn();
const mockGetSequelize = jest.fn();

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

const { ensureStateRow } = require('../../api/services/eventLedgerTriggerDispatcher');

function captureInserts(queries) {
  return queries
    .map((call) => call[0])
    .filter((sql) => typeof sql === 'string' && sql.includes('INSERT INTO event_dispatch_state'));
}

describe('eventLedgerTriggerDispatcher.ensureStateRow — safe cold-start', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockGetSequelize.mockReset();
    mockGetSequelize.mockImplementation(() => ({ query: (...args) => mockQuery(...args) }));
  });

  test('usa MAX(received_at) como cursor inicial (não 1970)', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('MAX(received_at)')) {
        return [[{ max_received_at: '2026-08-12T20:00:00.000Z' }]];
      }
      if (sql.includes('SELECT id, consumer, last_received_at')) {
        return [[{ id: 'eds:webhooks_v1', consumer: 'webhooks_v1', last_received_at: '2026-08-12T20:00:00.000Z', last_event_id: null }]];
      }
      return [[]];
    });

    await ensureStateRow({ consumer: 'webhooks_v1' });

    const inserts = captureInserts(mockQuery.mock.calls);
    expect(inserts.length).toBe(1);
    // O insert não pode conter o default bugado de 1970.
    expect(inserts[0]).not.toMatch(/1970-01-01/);
    // O cursor deve ser passado via binding :safeStart (valor calculado).
    expect(inserts[0]).toMatch(/:safeStart::timestamptz/);
    expect(inserts[0]).toMatch(/ON CONFLICT \(consumer\) DO UPDATE/);
    expect(inserts[0]).toMatch(/last_received_at < '2000-01-01'/);
  });

  test('cura cursor legado preso em 1970 via DO UPDATE WHERE', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('MAX(received_at)')) {
        return [[{ max_received_at: '2026-08-12T21:00:00.000Z' }]];
      }
      if (sql.includes('SELECT id, consumer, last_received_at')) {
        return [[{ id: 'eds:webhooks_v1', consumer: 'webhooks_v1', last_received_at: '2026-08-12T21:00:00.000Z', last_event_id: null }]];
      }
      return [[]];
    });

    await ensureStateRow({ consumer: 'webhooks_v1' });

    const inserts = captureInserts(mockQuery.mock.calls);
    expect(inserts.length).toBe(1);
    // Cláusula de cura: só sobrescreve cursor anterior a 2000 (o default bugado).
    expect(inserts[0]).toMatch(/ON CONFLICT \(consumer\) DO UPDATE/);
    expect(inserts[0]).toMatch(/WHERE event_dispatch_state\.last_received_at < '2000-01-01'/);
  });

  test('MAX(received_at) indisponível cai para NOW() sem quebrar', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (sql.includes('MAX(received_at)')) {
        return [[{ max_received_at: null }]];
      }
      if (sql.includes('SELECT id, consumer, last_received_at')) {
        return [[{ id: 'eds:webhooks_v1', consumer: 'webhooks_v1', last_received_at: null, last_event_id: null }]];
      }
      return [[]];
    });

    const state = await ensureStateRow({ consumer: 'webhooks_v1' });
    expect(state).toBeDefined();
    const inserts = captureInserts(mockQuery.mock.calls);
    expect(inserts[0]).not.toMatch(/1970-01-01/);
  });
});
