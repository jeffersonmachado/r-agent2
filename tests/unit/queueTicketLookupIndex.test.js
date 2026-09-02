'use strict';

/**
 * Item 2 — Índice secundário do ticket store.
 *
 * findActiveTicketBySession/findActiveTicketByConversation não varrem mais o
 * Map global de tickets (todos os tenants) no hot path: usam o índice
 * Map<tenantId, Map<sessionId|conversationId, ticketId[]>> mantido nos mesmos
 * pontos de mutação do store (create/update/hydrate/retention), preservando a
 * semântica de "ativo" e o desempate por ordem de inserção.
 */

const {
  createTicketLookupIndex,
  indexTicket,
} = require('../../api/services/queue/queueTicketLookupIndex');
const {
  findActiveTicketBySession,
  findActiveTicketByConversation,
} = require('../../api/services/queue/queueTicketLookup');

function makeTicket(overrides = {}) {
  return {
    id: 't-1',
    tenantId: 'tenant-1',
    sessionId: 'sess-1',
    conversationId: null,
    queue: 'q1',
    status: 'waiting',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function mapThatThrowsOnValues(tickets) {
  const guarded = new Map(tickets);
  guarded.values = () => { throw new Error('scan global proibido no caminho indexado'); };
  return guarded;
}

describe('queueTicketLookup com índice secundário', () => {
  test('lookup por session NÃO varre o Map global (values() proibido) e isola tenants', () => {
    const tickets = new Map();
    const index = createTicketLookupIndex();
    const mine = makeTicket({ id: 't-mine', tenantId: 'tenant-1', sessionId: 'sess-x' });
    const other = makeTicket({ id: 't-other', tenantId: 'tenant-2', sessionId: 'sess-x' });
    tickets.set(mine.id, mine);
    tickets.set(other.id, other);
    indexTicket(index, mine);
    indexTicket(index, other);

    const guarded = mapThatThrowsOnValues(tickets);

    const found = findActiveTicketBySession({
      tickets: guarded,
      sessionId: 'sess-x',
      tenantId: 'tenant-1',
      lookupIndex: index,
    });
    expect(found).toBe(mine);

    const foundOther = findActiveTicketBySession({
      tickets: guarded,
      sessionId: 'sess-x',
      tenantId: 'tenant-2',
      lookupIndex: index,
    });
    expect(foundOther).toBe(other);

    // Sessão inexistente no tenant → null sem scan.
    expect(findActiveTicketBySession({
      tickets: guarded,
      sessionId: 'sess-y',
      tenantId: 'tenant-1',
      lookupIndex: index,
    })).toBeNull();
  });

  test('desempate preservado: primeiro ticket ativo na ordem de inserção; closed é pulado', () => {
    const tickets = new Map();
    const index = createTicketLookupIndex();
    const first = makeTicket({ id: 't-1', sessionId: 'sess-1', status: 'closed' });
    const second = makeTicket({ id: 't-2', sessionId: 'sess-1', status: 'waiting' });
    const third = makeTicket({ id: 't-3', sessionId: 'sess-1', status: 'in_progress' });
    for (const t of [first, second, third]) {
      tickets.set(t.id, t);
      indexTicket(index, t);
    }

    const found = findActiveTicketBySession({ tickets, sessionId: 'sess-1', tenantId: 'tenant-1', lookupIndex: index });
    expect(found).toBe(second);

    // Mesma semântica no scan legado (sem índice).
    const scanFound = findActiveTicketBySession({ tickets, sessionId: 'sess-1', tenantId: 'tenant-1' });
    expect(scanFound).toBe(second);
  });

  test('sem índice (ou sem tenantId em findBySession), fallback de scan preservado', () => {
    const tickets = new Map();
    const a = makeTicket({ id: 't-a', tenantId: 'tenant-1', sessionId: 'sess-1' });
    const b = makeTicket({ id: 't-b', tenantId: 'tenant-2', sessionId: 'sess-1' });
    tickets.set(a.id, a);
    tickets.set(b.id, b);

    // tenantId null → scan global legado (compat).
    expect(findActiveTicketBySession({ tickets, sessionId: 'sess-1' })).toBe(a);
    expect(findActiveTicketByConversation({ tickets, conversationId: 'conv-1', tenantId: 'tenant-1' })).toBeNull();
  });

  test('lookup por conversation usa o índice e isola tenants', () => {
    const tickets = new Map();
    const index = createTicketLookupIndex();
    const mine = makeTicket({ id: 't-mine', tenantId: 'tenant-1', conversationId: 'conv-1' });
    const other = makeTicket({ id: 't-other', tenantId: 'tenant-2', conversationId: 'conv-1' });
    tickets.set(mine.id, mine);
    tickets.set(other.id, other);
    indexTicket(index, mine);
    indexTicket(index, other);

    const guarded = mapThatThrowsOnValues(tickets);

    expect(findActiveTicketByConversation({
      tickets: guarded,
      conversationId: 'conv-1',
      tenantId: 'tenant-2',
      lookupIndex: index,
    })).toBe(other);
    expect(findActiveTicketByConversation({
      tickets: guarded,
      conversationId: 'conv-9',
      tenantId: 'tenant-1',
      lookupIndex: index,
    })).toBeNull();
  });
});

describe('queueService — índice mantido nos pontos de mutação do store', () => {
  const queueService = require('../../api/services/queueService');

  test('createTicket indexa por tenant+session; closeTicket remove do "ativo"', () => {
    const t1 = queueService.createTicket({ tenantId: 'idx-tenant-a', sessionId: 'idx-sess-1', queue: 'q-idx-a' });
    const t2 = queueService.createTicket({ tenantId: 'idx-tenant-b', sessionId: 'idx-sess-1', queue: 'q-idx-b' });

    expect(queueService.getTicketBySession('idx-sess-1', 'idx-tenant-a')).toBe(t1);
    expect(queueService.getTicketBySession('idx-sess-1', 'idx-tenant-b')).toBe(t2);

    queueService.closeTicket(t1.id);
    expect(queueService.getTicketBySession('idx-sess-1', 'idx-tenant-a')).toBeNull();
    expect(queueService.getTicketBySession('idx-sess-1', 'idx-tenant-b')).toBe(t2);
  });

  test('updateTicket com patch em sessionId/conversationId reindexa', () => {
    const ticket = queueService.createTicket({
      tenantId: 'idx-tenant-c',
      sessionId: 'idx-sess-old',
      queue: 'q-idx-c',
      context: { conversationId: 'idx-conv-old' },
    });

    expect(queueService.getTicketBySession('idx-sess-old', 'idx-tenant-c')).toBe(ticket);
    expect(queueService.getTicketByConversationId('idx-conv-old', 'idx-tenant-c')).toBe(ticket);

    queueService.updateTicket(ticket.id, { sessionId: 'idx-sess-new', conversationId: 'idx-conv-new' });

    expect(queueService.getTicketBySession('idx-sess-old', 'idx-tenant-c')).toBeNull();
    expect(queueService.getTicketByConversationId('idx-conv-old', 'idx-tenant-c')).toBeNull();
    expect(queueService.getTicketBySession('idx-sess-new', 'idx-tenant-c')).toBe(ticket);
    expect(queueService.getTicketByConversationId('idx-conv-new', 'idx-tenant-c')).toBe(ticket);
  });

  test('_upsertTicketFromDbRow (hydrate) indexa e reindexa em mudança de conversation_id', () => {
    const base = {
      id: 'idx-ticket-hydrate-1',
      tenant_key: 'idx-tenant-d',
      session_id: 'idx-sess-h1',
      conversation_id: 'idx-conv-h1',
      queue: 'q-idx-d',
      status: 'waiting',
      created_at: new Date('2026-09-01T10:00:00Z'),
      updated_at: new Date('2026-09-01T10:00:00Z'),
    };

    const ticket = queueService._upsertTicketFromDbRow(base);
    expect(queueService.getTicketBySession('idx-sess-h1', 'idx-tenant-d')).toBe(ticket);
    expect(queueService.getTicketByConversationId('idx-conv-h1', 'idx-tenant-d')).toBe(ticket);

    const rehydrated = queueService._upsertTicketFromDbRow({ ...base, conversation_id: 'idx-conv-h2' });
    expect(queueService.getTicketByConversationId('idx-conv-h1', 'idx-tenant-d')).toBeNull();
    expect(queueService.getTicketByConversationId('idx-conv-h2', 'idx-tenant-d')).toBe(rehydrated);
  });

  test('cleanupOldTickets remove do índice (sem stale hit após retenção)', () => {
    const ticket = queueService.createTicket({ tenantId: 'idx-tenant-e', sessionId: 'idx-sess-e1', queue: 'q-idx-e' });
    queueService.closeTicket(ticket.id);

    // maxAgeDays negativo: força remoção de qualquer ticket fechado.
    const cleaned = queueService.cleanupOldTickets(-1);
    expect(cleaned).toBeGreaterThan(0);

    expect(queueService.getTicketBySession('idx-sess-e1', 'idx-tenant-e')).toBeNull();

    // Novo ticket na mesma sessão é encontrado normalmente (índice consistente).
    const fresh = queueService.createTicket({ tenantId: 'idx-tenant-e', sessionId: 'idx-sess-e1', queue: 'q-idx-e' });
    expect(queueService.getTicketBySession('idx-sess-e1', 'idx-tenant-e')).toBe(fresh);
  });
});
