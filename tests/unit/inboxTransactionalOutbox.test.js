'use strict';

/**
 * Transactional Outbox do Inbox (P1) — atomicidade ChannelMessage +
 * OutboundQueueItem e repair idempotente de estado parcial legado.
 *
 * O harness em memória simula a semântica de transação do Postgres: writes só
 * são commitados se fn(transaction) completar; qualquer throw descarta todas
 * as escritas do escopo (rollback) — mesmo contrato do sequelize.transaction.
 */

const { createInboxService } = require('../../api/modules/inbox/service');

function makeConversation(overrides = {}) {
  return {
    id: 'conv-1',
    tenantId: 'tenant-1',
    channelType: 'whatsapp',
    externalId: '5511999999999',
    contactId: '5511999999999',
    status: 'open',
    currentTicketId: null,
    assignedTo: null,
    metadata: {},
    ...overrides,
  };
}

function makeReq(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    agent: { id: 'agent-1', username: 'agent', role: 'operator' },
    params: { conversationId: 'conv-1' },
    query: {},
    url: '/inbox/conversations',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  };
}

function uniqueViolationError() {
  const err = new Error('duplicate key value violates unique constraint "channel_messages_tenant_client_msg_id_uq"');
  err.name = 'SequelizeUniqueConstraintError';
  err.original = { code: '23505' };
  return err;
}

/**
 * Store transacional em memória: mensagens + fila no mesmo "banco";
 * runInTransaction faz snapshot e rollback em qualquer erro.
 */
function makeTransactionalHarness({ enqueueError = null } = {}) {
  const state = {
    messages: new Map(),
    queue: new Map(),
    seq: 0,
  };

  const channels = {
    getConversation: jest.fn(async () => makeConversation()),
    createMessage: jest.fn(async (input) => {
      const key = `${input.tenantId}::${input.clientMessageId}`;
      if (input.clientMessageId && state.messages.has(key)) throw uniqueViolationError();
      state.seq += 1;
      const message = {
        id: `cmsg-${state.seq}`,
        conversationId: input.conversationId,
        direction: input.direction,
        type: input.type,
        body: input.body,
        clientMessageId: input.clientMessageId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        _tx: input.transaction || null,
      };
      if (input.clientMessageId) state.messages.set(key, message);
      return message;
    }),
    findMessageByClientMessageId: jest.fn(async ({ tenantId, clientMessageId }) => (
      state.messages.get(`${tenantId}::${clientMessageId}`) || null
    )),
    runInTransaction: jest.fn(async (fn) => {
      const snapshot = {
        messages: new Map(state.messages),
        queue: new Map(state.queue),
        seq: state.seq,
      };
      try {
        return await fn({ txId: 'tx-1' });
      } catch (err) {
        state.messages = snapshot.messages;
        state.queue = snapshot.queue;
        state.seq = snapshot.seq;
        throw err;
      }
    }),
  };

  const outbound = {
    enqueueOutbound: jest.fn(async (input, options = {}) => {
      if (enqueueError) throw enqueueError;
      const key = `${input.tenantId}::${input.message.meta.clientMessageId}`;
      if (state.queue.has(key)) return { queued: false, idempotent: true, itemId: state.queue.get(key).id };
      state.seq += 1;
      const item = { id: `outq-${state.seq}`, clientMessageId: input.message.meta.clientMessageId, _tx: options.transaction || null };
      state.queue.set(key, item);
      return { queued: true, itemId: item.id };
    }),
    ensureOutboundQueued: jest.fn(async (input) => {
      const key = `${input.tenantId}::${input.message.meta.clientMessageId}`;
      if (state.queue.has(key)) return { queued: false, idempotent: true, itemId: state.queue.get(key).id };
      state.seq += 1;
      const item = { id: `outq-${state.seq}`, clientMessageId: input.message.meta.clientMessageId };
      state.queue.set(key, item);
      return { queued: true, repaired: true, itemId: item.id };
    }),
  };

  const deps = {
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    channelConversationService: channels,
    outboundQueueService: outbound,
    conversationTicketLinkService: { appendTicketMessage: jest.fn() },
  };
  return { state, channels, outbound, deps };
}

describe('transactional outbox do Inbox (message + queue atômicos)', () => {
  test('T1: queue INSERT falha → rollback total (0 mensagens, 0 queue rows), cliente recebe erro', async () => {
    const { state, channels, outbound, deps } = makeTransactionalHarness({
      enqueueError: new Error('db_constraint_boom'),
    });
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), { body: 'Oi', clientMessageId: 'cli-t1' });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(500);
    expect(state.messages.size).toBe(0);
    expect(state.queue.size).toBe(0);
    // Ambas as escritas aconteceram dentro da MESMA transação
    expect(channels.runInTransaction).toHaveBeenCalledTimes(1);
    const msgTx = channels.createMessage.mock.calls[0][0].transaction;
    const queueTx = outbound.enqueueOutbound.mock.calls[0][1].transaction;
    expect(msgTx).toBeTruthy();
    expect(queueTx).toBeTruthy();
  });

  test('T2: estado parcial legado (mensagem existe, queue ausente) → retry repara sem duplicar', async () => {
    const { state, deps } = makeTransactionalHarness();
    // Prepara estado parcial legado diretamente no "banco"
    state.messages.set('tenant-1::cli-legacy-1', {
      id: 'cmsg-legacy',
      conversationId: 'conv-1',
      direction: 'out',
      type: 'text',
      body: { text: 'Oi' },
      clientMessageId: 'cli-legacy-1',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), { body: 'Oi', clientMessageId: 'cli-legacy-1' });

    expect(out.ok).toBe(true);
    expect(out.payload.idempotent).toBe(true);
    expect(out.payload.message.id).toBe('cmsg-legacy');
    // mensagem não duplicada, queue reparada exatamente uma vez
    expect(state.messages.size).toBe(1);
    expect(deps.channelConversationService.createMessage).not.toHaveBeenCalled();
    expect(deps.outboundQueueService.ensureOutboundQueued).toHaveBeenCalledTimes(1);
    expect(state.queue.size).toBe(1);
    expect(state.queue.get('tenant-1::cli-legacy-1').clientMessageId).toBe('cli-legacy-1');
  });

  test('T3: race no INSERT da mensagem → rollback + re-read + repair, 1 mensagem e 1 queue row', async () => {
    const { state, channels, outbound, deps } = makeTransactionalHarness();
    // Simula corrida: o INSERT da mensagem colide no UNIQUE (outro request venceu)
    channels.createMessage.mockImplementationOnce(async () => { throw uniqueViolationError(); });
    state.messages.set('tenant-1::cli-race-t3', {
      id: 'cmsg-winner',
      conversationId: 'conv-1',
      direction: 'out',
      type: 'text',
      body: { text: 'Oi' },
      clientMessageId: 'cli-race-t3',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), { body: 'Oi', clientMessageId: 'cli-race-t3' });

    expect(out.ok).toBe(true);
    expect(out.payload.idempotent).toBe(true);
    expect(out.payload.message.id).toBe('cmsg-winner');
    expect(state.messages.size).toBe(1);
    expect(outbound.ensureOutboundQueued).toHaveBeenCalledTimes(1);
    expect(state.queue.size).toBe(1);
  });

  test('T4: invariante — reply com sucesso commita mensagem E queue com a mesma chave', async () => {
    const { state, deps } = makeTransactionalHarness();
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), { body: 'Obrigado!', clientMessageId: 'cli-t4' });

    expect(out.ok).toBe(true);
    expect(state.messages.size).toBe(1);
    expect(state.queue.size).toBe(1);
    const msg = state.messages.get('tenant-1::cli-t4');
    const item = state.queue.get('tenant-1::cli-t4');
    expect(msg).toBeTruthy();
    expect(item).toBeTruthy();
    expect(msg.clientMessageId).toBe(item.clientMessageId);
  });

  test('T5: falha de queue no caminho SEM transação (deps legados) → 500 explícito; retry repara', async () => {
    const { state, deps } = makeTransactionalHarness({ enqueueError: new Error('boom') });
    // Remove a capability de transação: cai no caminho sequencial legado
    delete deps.channelConversationService.runInTransaction;
    const service = createInboxService(deps);

    const first = await service.reply(makeReq(), { body: 'Oi', clientMessageId: 'cli-t5' });
    expect(first.ok).toBe(false);
    expect(first.status).toBe(500);
    // caminho legado deixou estado parcial: mensagem sem queue
    expect(state.messages.size).toBe(1);
    expect(state.queue.size).toBe(0);

    // Retry com a mesma chave: repair reconstrói o queue item (não duplica)
    const second = await service.reply(makeReq(), { body: 'Oi', clientMessageId: 'cli-t5' });
    expect(second.ok).toBe(true);
    expect(second.payload.idempotent).toBe(true);
    expect(state.messages.size).toBe(1);
    expect(state.queue.size).toBe(1);
  });
});
