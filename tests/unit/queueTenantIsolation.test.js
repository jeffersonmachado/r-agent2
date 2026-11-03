'use strict';

/**
 * ISOLAMENTO MULTI-TENANT DE FILAS — P0 medido em 2026-10-20.
 *
 * O índice de filas em memória é chaveado por NOME (`queues: Map<queueName, Set<ticketId>>`),
 * enquanto os tickets carregam `tenantId`. Sem escopo nas operações:
 *   - `getQueueStats` contava tickets de TODOS os tenants;
 *   - `deleteQueue(name, force=true)` fechava tickets de QUALQUER tenant com o mesmo nome de fila;
 *   - a listagem mesclava nomes globais na visão de cada tenant.
 *
 * Estes testes usam os helpers REAIS (não mocks) para provar o isolamento.
 */

const {
  createQueue: createQueueOp,
  deleteQueue: deleteQueueOp,
  getQueueInfo: getQueueInfoOp,
} = require('../../api/services/queue/queueAdminOperations');
const { getQueueStats } = require('../../api/services/queue/queueIndexStore');

function buildHarness() {
  const queues = new Map();
  const tickets = new Map();
  const logger = { debug: jest.fn(), error: jest.fn() };
  const safeTrim = (value) => String(value ?? '').trim();
  const ensureQueueIndex = (map, name) => { if (!map.has(name)) map.set(name, new Set()); };
  const persistTicketBestEffort = jest.fn();
  const stats = (queueName, tenantId = null) => getQueueStats({ tickets, queues, queueName, tenantId });

  return {
    queues,
    tickets,
    logger,
    stats,
    createQueue: (name) => createQueueOp(name, { queues, ensureQueueIndex, safeTrim, logger }),
    deleteQueue: (name, force, tenantId = null) => deleteQueueOp(name, force, {
      queues, tickets, getQueueStats, persistTicketBestEffort, safeTrim, logger, tenantId,
    }),
    getQueueInfo: (name, tenantId = null) => getQueueInfoOp(name, {
      queues, tickets, getQueueStats, safeTrim, tenantId,
    }),
  };
}

function addTicket(harness, { id, tenantId, queue = 'vendas', status = 'waiting' }) {
  if (!harness.queues.has(queue)) harness.queues.set(queue, new Set());
  harness.queues.get(queue).add(id);
  harness.tickets.set(id, { id, tenantId, queue, status });
}

describe('filas — isolamento multi-tenant', () => {
  test('estatísticas são escopadas por tenant', () => {
    const h = buildHarness();
    addTicket(h, { id: 'a-1', tenantId: 'tenant-a' });
    addTicket(h, { id: 'b-1', tenantId: 'tenant-b' });
    addTicket(h, { id: 'b-2', tenantId: 'tenant-b', status: 'closed' });

    expect(h.stats('vendas', 'tenant-a')).toMatchObject({ ticketCount: 1, activeTickets: 1 });
    expect(h.stats('vendas', 'tenant-b')).toMatchObject({ ticketCount: 2, activeTickets: 1, closedTickets: 1 });
    expect(h.stats('vendas')).toMatchObject({ ticketCount: 3 });
  });

  test('exclusão forçada do tenant A NÃO fecha tickets do tenant B', () => {
    const h = buildHarness();
    addTicket(h, { id: 'a-1', tenantId: 'tenant-a', status: 'waiting' });
    addTicket(h, { id: 'b-1', tenantId: 'tenant-b', status: 'waiting' });

    const result = h.deleteQueue('vendas', true, 'tenant-a');

    expect(result.success).toBe(true);
    expect(result.deletedTickets).toBe(1);
    expect(h.tickets.get('a-1').status).toBe('closed');
    // O ticket do outro tenant permanece intacto.
    expect(h.tickets.get('b-1').status).toBe('waiting');
    // E continua no índice (a fila nominal sobrevive para ele).
    expect(h.queues.get('vendas').has('b-1')).toBe(true);
  });

  test('exclusão sem force recusa quando HÁ ticket ativo no tenant', () => {
    const h = buildHarness();
    addTicket(h, { id: 'a-1', tenantId: 'tenant-a', status: 'waiting' });

    const result = h.deleteQueue('vendas', false, 'tenant-a');

    expect(result.success).toBe(false);
    expect(result.activeTickets).toBe(1);
    expect(h.tickets.get('a-1').status).toBe('waiting');
  });

  test('fila vazia para o tenant pode ser excluída sem afetar o outro', () => {
    const h = buildHarness();
    addTicket(h, { id: 'b-1', tenantId: 'tenant-b', status: 'waiting' });

    const result = h.deleteQueue('vendas', false, 'tenant-a');

    expect(result.success).toBe(true);
    expect(h.tickets.get('b-1').status).toBe('waiting');
    expect(h.queues.get('vendas').has('b-1')).toBe(true);
  });

  test('getQueueInfo expõe apenas números do tenant consultante', () => {
    const h = buildHarness();
    h.createQueue('vendas');
    addTicket(h, { id: 'a-1', tenantId: 'tenant-a' });
    addTicket(h, { id: 'b-1', tenantId: 'tenant-b' });

    expect(h.getQueueInfo('vendas', 'tenant-a')).toMatchObject({ exists: true, ticketCount: 1 });
    expect(h.getQueueInfo('vendas', 'tenant-b')).toMatchObject({ exists: true, ticketCount: 1 });
  });
});
