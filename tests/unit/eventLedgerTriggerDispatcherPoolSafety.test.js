'use strict';

/**
 * Regressão: scanAndEnqueue NÃO pode adquirir uma segunda conexão do pool
 * dentro de uma transação aberta.
 *
 * Defeito comprovado em runtime real (2026-09-10): scanAndEnqueue abria
 * `sequelize.transaction()` (conexão A + FOR UPDATE em event_dispatch_state) e,
 * DENTRO da transação, chamava `enqueueJob()` — que faz `Model.create()`
 * (autocommit), adquirindo uma SEGUNDA conexão do mesmo pool.
 *
 * Sob concorrência, todas as conexões do pool ficam presas em
 * "idle in transaction" esperando uma conexão que nunca é liberada →
 * `SequelizeConnectionAcquireTimeoutError: Operation timeout` em toda a API
 * (ExecutionQueue, OutboundWorker, TenantService, WhatsAppQRBridge, Scheduler)
 * e o "INSERT INTO event_dispatch_state" de outras varreduras fica bloqueado no
 * lock de linha da transação presa (cascata de esgotamento).
 *
 * Este teste simula um pool de tamanho 1 com falha rápida na aquisição — o
 * cenário extremo do esgotamento — e exige que a varredura conclua e enfileire
 * os eventos mesmo assim.
 */

const mockState = {
  poolMax: 1,
  held: 0,
  inTransaction: false,
  observedInsideTransaction: 0,
  enqueuePoolError: null,
  sequelize: null,
};

const mockEventCount = { value: 3 };

function mockAcquireConnection(label) {
  if (mockState.held >= mockState.poolMax) {
    const err = new Error(`pool timeout ao adquirir conexao (${label})`);
    err.name = 'SequelizeConnectionAcquireTimeoutError';
    return { ok: false, err };
  }
  mockState.held += 1;
  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      mockState.held -= 1;
    },
  };
}

function mockStateRow() {
  return {
    id: 'eds:webhooks_v1',
    consumer: 'webhooks_v1',
    last_received_at: new Date('2026-09-01T00:00:00.000Z'),
    last_event_id: null,
  };
}

function mockMakeEvent(n) {
  return {
    id: `evt-${n}`,
    tenant_key: 'system',
    type: 'order.created',
    source: 'test',
    received_at: new Date(`2026-09-02T00:00:0${n}.000Z`),
    toJSON() {
      return {
        id: this.id,
        tenant_key: this.tenant_key,
        type: this.type,
        source: this.source,
        received_at: this.received_at,
      };
    },
  };
}

function mockQueryResult(sql) {
  if (/MAX\(received_at\)/.test(sql)) {
    return [[{ max_received_at: new Date('2026-09-01T00:00:00.000Z') }], 1];
  }
  if (/INSERT INTO event_dispatch_state/.test(sql)) return [[], 1];
  if (/SELECT id, consumer, last_received_at, last_event_id/.test(sql)) return [[mockStateRow()], 1];
  if (/UPDATE event_dispatch_state/.test(sql)) return [[], 1];
  throw new Error('SQL inesperado no teste: ' + String(sql).slice(0, 80));
}

function mockBuildSequelize() {
  return {
    // Fidelidade com o Sequelize real: query com { transaction: t } reutiliza a
    // conexão da transação; sem transação, adquire OUTRA conexão do pool.
    async query(sql, opts) {
      const reused = opts && opts.transaction && opts.transaction.__conn;
      if (reused) return mockQueryResult(sql);
      const conn = mockAcquireConnection('query');
      if (!conn.ok) throw conn.err;
      try {
        return mockQueryResult(sql);
      } finally {
        conn.release();
      }
    },
    async transaction(fn) {
      const conn = mockAcquireConnection('transaction');
      if (!conn.ok) throw conn.err;
      mockState.inTransaction = true;
      try {
        return await fn({ __conn: conn });
      } finally {
        mockState.inTransaction = false;
        conn.release();
      }
    },
  };
}

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockState.sequelize,
}));

jest.mock('../../api/db/models', () => ({
  EventLedger: () => ({
    async findAll(opts) {
      const reused = opts && opts.transaction && opts.transaction.__conn;
      const events = () => Array.from({ length: mockEventCount.value }, (_, i) => mockMakeEvent(i + 1));
      if (reused) return events();
      const conn = mockAcquireConnection('findAll');
      if (!conn.ok) throw conn.err;
      try {
        return events();
      } finally {
        conn.release();
      }
    },
  }),
}));

jest.mock('../../api/services/executionQueueService', () => ({
  enqueueJob: async (args) => {
    // enqueueJob faz Model.create() → autocommit → precisa de OUTRA conexão.
    if (mockState.inTransaction) mockState.observedInsideTransaction += 1;
    const conn = mockAcquireConnection('enqueueJob');
    if (!conn.ok) {
      mockState.enqueuePoolError = conn.err;
      throw conn.err;
    }
    try {
      return { id: 'job-' + args.idempotencyKey };
    } finally {
      conn.release();
    }
  },
}));

describe('eventLedgerTriggerDispatcher — segurança de pool em scanAndEnqueue', () => {
  let scanAndEnqueue;

  beforeEach(() => {
    mockState.held = 0;
    mockState.inTransaction = false;
    mockState.observedInsideTransaction = 0;
    mockState.enqueuePoolError = null;
    mockState.sequelize = mockBuildSequelize();
    mockEventCount.value = 3;
    jest.resetModules();
    ({ scanAndEnqueue } = require('../../api/services/eventLedgerTriggerDispatcher'));
  });

  test('conclui a varredura e enfileira todos os eventos mesmo com pool de tamanho 1', async () => {
    const out = await scanAndEnqueue({ consumer: 'webhooks_v1', batchSize: 10 });

    expect(mockState.enqueuePoolError).toBeNull();
    expect(out.ok).toBe(true);
    expect(out.enqueued).toBe(3);
    expect(mockState.held).toBe(0);
  });

  test('não chama enqueueJob enquanto uma conexão transacional está retida', async () => {
    await scanAndEnqueue({ consumer: 'webhooks_v1', batchSize: 10 });

    expect(mockState.observedInsideTransaction).toBe(0);
  });

  test('libera todas as conexões do pool ao final (sem vazamento)', async () => {
    await scanAndEnqueue({ consumer: 'webhooks_v1', batchSize: 10 });

    expect(mockState.held).toBe(0);
  });
});
