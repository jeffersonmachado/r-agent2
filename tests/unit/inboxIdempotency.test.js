'use strict';

/**
 * Idempotência end-to-end do reply do Inbox (clientMessageId estável).
 *
 * O store em memória impõe a UNIQUE (tenant_key, client_message_id) do banco:
 * a 2ª inserção com a mesma chave lança erro no shape de unique violation do
 * Sequelize/pg — mesmo contrato que o service reconhece em produção.
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
    lastMessageAt: '2026-09-08T10:00:00.000Z',
    createdAt: '2026-09-08T09:00:00.000Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
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
 * Store em memória com a mesma semântica da UNIQUE parcial
 * (tenant_key, client_message_id) WHERE client_message_id IS NOT NULL.
 */
function makeChannelStore(conversation) {
  const messages = new Map();
  let seq = 0;
  return {
    getConversation: jest.fn(async () => conversation),
    createMessage: jest.fn(async (input) => {
      const key = `${input.tenantId}::${input.clientMessageId}`;
      if (input.clientMessageId && messages.has(key)) {
        throw uniqueViolationError();
      }
      seq += 1;
      const message = {
        id: `cmsg-${seq}`,
        conversationId: input.conversationId,
        direction: input.direction,
        type: input.type,
        body: input.body,
        externalMessageId: input.externalMessageId,
        clientMessageId: input.clientMessageId,
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      if (input.clientMessageId) messages.set(key, message);
      return message;
    }),
    findMessageByClientMessageId: jest.fn(async ({ tenantId, clientMessageId }) => (
      messages.get(`${tenantId}::${clientMessageId}`) || null
    )),
    _messages: messages,
  };
}

function makeDeps(overrides = {}) {
  const conversation = makeConversation();
  return {
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    channelConversationService: makeChannelStore(conversation),
    outboundQueueService: {
      enqueueOutbound: jest.fn(async () => ({ queued: true, itemId: 'outq-1' })),
    },
    conversationTicketLinkService: {
      appendTicketMessage: jest.fn(),
    },
    ...overrides,
  };
}

describe('idempotência do reply do Inbox (clientMessageId)', () => {
  test('A: request normal cria 1 mensagem, enfileira 1x e devolve o clientMessageId', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), { body: 'Olá!', clientMessageId: 'cli-a-1' });

    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.payload.clientMessageId).toBe('cli-a-1');
    expect(out.payload.idempotent).toBe(false);
    expect(out.payload.message.id).toBeTruthy();
    expect(deps.channelConversationService.createMessage).toHaveBeenCalledTimes(1);
    expect(deps.channelConversationService.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      clientMessageId: 'cli-a-1',
    }));
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.objectContaining({
        meta: expect.objectContaining({ clientMessageId: 'cli-a-1' }),
      }),
    }));
  });

  test('B: mesmo request 2x sequencial → 1 mensagem, 1 enqueue, 2ª resposta idempotent', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const first = await service.reply(makeReq(), { body: 'Olá!', clientMessageId: 'cli-b-1' });
    const second = await service.reply(makeReq(), { body: 'Olá!', clientMessageId: 'cli-b-1' });

    expect(deps.channelConversationService.createMessage).toHaveBeenCalledTimes(1);
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(first.payload.idempotent).toBe(false);
    expect(second.payload.idempotent).toBe(true);
    expect(second.payload.message.id).toBe(first.payload.message.id);
    expect(second.payload.clientMessageId).toBe('cli-b-1');
    expect(deps.channelConversationService._messages.size).toBe(1);
  });

  test('C: concorrência — unique violation na 2ª inserção, ambas as respostas apontam a mesma mensagem', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const [r1, r2] = await Promise.all([
      service.reply(makeReq(), { body: 'Olá!', clientMessageId: 'cli-c-1' }),
      service.reply(makeReq(), { body: 'Olá!', clientMessageId: 'cli-c-1' }),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(deps.channelConversationService._messages.size).toBe(1);
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(r1.payload.message.id).toBe(r2.payload.message.id);
    // Exatamente uma request criou de fato; a outra caiu na unique violation.
    const idempotents = [r1.payload.idempotent, r2.payload.idempotent].sort();
    expect(idempotents).toEqual([false, true]);
  });

  test('D: resposta perdida — retry com o mesmo clientMessageId não reenfileira (1 outbound lógico)', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    // Primeira tentativa: servidor persiste + enfileira, mas a resposta se
    // perde na rede (o cliente nunca a vê).
    const first = await service.reply(makeReq(), { body: 'Chegou?', clientMessageId: 'cli-d-1' });
    expect(first.payload.idempotent).toBe(false);

    // Retry do outbox PWA com a MESMA chave.
    const retry = await service.reply(makeReq(), { body: 'Chegou?', clientMessageId: 'cli-d-1' });

    expect(retry.payload.idempotent).toBe(true);
    expect(retry.payload.message.id).toBe(first.payload.message.id);
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(1);
    expect(deps.channelConversationService._messages.size).toBe(1);
  });

  test('E: o service usa o clientMessageId do body e não gera um novo', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), { body: 'PWA restart', clientMessageId: 'cli-e-1' });

    expect(out.payload.clientMessageId).toBe('cli-e-1');
    expect(deps.channelConversationService.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      clientMessageId: 'cli-e-1',
    }));
  });

  test('E2: clientMessageId ausente/inválido cai no fallback gerado server-side (compat legado)', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const semChave = await service.reply(makeReq(), { body: 'legado sem chave' });
    expect(semChave.ok).toBe(true);
    expect(semChave.payload.clientMessageId).toMatch(/^outq-/);
    expect(semChave.payload.idempotent).toBe(false);

    const invalida = await service.reply(makeReq(), { body: 'chave inválida', clientMessageId: 'id com espaços!!' });
    expect(invalida.ok).toBe(true);
    expect(invalida.payload.clientMessageId).toMatch(/^outq-/);

    // Chamadores legados nunca fazem lookup de idempotência nem colidem.
    expect(deps.channelConversationService.findMessageByClientMessageId).not.toHaveBeenCalled();
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(2);
  });

  test('F: mesmo body com dois clientMessageIds diferentes → 2 mensagens', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const first = await service.reply(makeReq(), { body: 'Mesmo texto', clientMessageId: 'cli-f-1' });
    const second = await service.reply(makeReq(), { body: 'Mesmo texto', clientMessageId: 'cli-f-2' });

    expect(first.payload.idempotent).toBe(false);
    expect(second.payload.idempotent).toBe(false);
    expect(second.payload.message.id).not.toBe(first.payload.message.id);
    expect(deps.channelConversationService._messages.size).toBe(2);
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(2);
  });

  test('G: mesmo clientMessageId em tenants diferentes → 2 operações independentes', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const t1 = await service.reply(makeReq({ tenantId: 'tenant-1' }), { body: 'Oi', clientMessageId: 'cli-g-1' });
    const t2 = await service.reply(makeReq({ tenantId: 'tenant-2' }), { body: 'Oi', clientMessageId: 'cli-g-1' });

    expect(t1.payload.idempotent).toBe(false);
    expect(t2.payload.idempotent).toBe(false);
    expect(t2.payload.message.id).not.toBe(t1.payload.message.id);
    expect(deps.channelConversationService._messages.size).toBe(2);
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledTimes(2);
  });

  test('reply idempotente não espelha no ticket legado novamente', async () => {
    const conversation = makeConversation({ currentTicketId: 't-1' });
    const deps = makeDeps();
    deps.channelConversationService = makeChannelStore(conversation);
    const service = createInboxService(deps);

    await service.reply(makeReq(), { body: 'com ticket', clientMessageId: 'cli-t-1' });
    const second = await service.reply(makeReq(), { body: 'com ticket', clientMessageId: 'cli-t-1' });

    expect(second.payload.idempotent).toBe(true);
    expect(deps.conversationTicketLinkService.appendTicketMessage).toHaveBeenCalledTimes(1);
  });
});
