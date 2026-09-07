'use strict';

const { createInboxService } = require('../../api/modules/inbox/service');
const { createInboxController } = require('../../api/modules/inbox/controller');
const { createInboxRoutes } = require('../../api/modules/inbox/routes');

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
    lastMessageAt: '2026-08-27T10:00:00.000Z',
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T10:00:00.000Z',
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

function makeDeps(overrides = {}) {
  const conversation = makeConversation();
  return {
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    getTicket: jest.fn(() => null),
    assignTicket: jest.fn(),
    transferTicket: jest.fn(),
    addTicketNote: jest.fn(),
    emitEvent: jest.fn(),
    logAction: jest.fn(),
    channelConversationService: {
      listConversations: jest.fn(async () => ({ total: 1, items: [conversation] })),
      getConversation: jest.fn(async () => conversation),
      listConversationMessages: jest.fn(async () => ({ total: 0, items: [] })),
      updateConversation: jest.fn(async ({ patch }) => ({ ...conversation, ...patch })),
      createMessage: jest.fn(async (input) => ({
        id: 'cmsg-1',
        conversationId: input.conversationId,
        direction: input.direction,
        type: input.type,
        body: input.body,
        externalMessageId: input.externalMessageId,
        status: 'pending',
        createdAt: '2026-08-27T11:00:00.000Z',
      })),
    },
    outboundQueueService: {
      enqueueOutbound: jest.fn(async () => ({ id: 'outq-1' })),
    },
    conversationTicketLinkService: {
      appendTicketMessage: jest.fn(),
    },
    caseService: {
      createCaseFromConversation: jest.fn(async () => ({
        ok: true,
        status: 201,
        case: { id: 'cases-1', status: 'waiting', priority: 'high' },
      })),
    },
    ...overrides,
  };
}

describe('inbox desacoplado (ChannelConversation-based)', () => {
  test('lista conversas SEM nenhum ticket existente', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.listConversations(makeReq({
      query: { status: 'open', channelType: 'whatsapp', limit: '50', offset: '0' },
    }));

    expect(out.ok).toBe(true);
    expect(out.payload.total).toBe(1);
    expect(out.payload.conversations).toHaveLength(1);
    expect(out.payload.conversations[0].caseId).toBeNull();
    expect(deps.channelConversationService.listConversations).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      status: 'open',
      channelType: 'whatsapp',
    }));
  });

  test('list sem tenant → 403 tenant_required', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.listConversations(makeReq({ tenantId: null, agent: { id: 'a', role: 'super_admin' } }));

    expect(out).toEqual({ ok: false, status: 403, payload: { error: 'tenant_required' } });
  });

  test('get retorna conversa + mensagens de channel_messages', async () => {
    const message = {
      id: 'cmsg-9',
      conversationId: 'conv-1',
      direction: 'in',
      type: 'text',
      body: { text: 'oi' },
      status: 'received',
      createdAt: '2026-08-27T10:00:00.000Z',
    };
    const deps = makeDeps();
    deps.channelConversationService.listConversationMessages.mockResolvedValue({ total: 1, items: [message] });
    const service = createInboxService(deps);

    const out = await service.getConversation(makeReq());

    expect(out.ok).toBe(true);
    expect(out.payload.conversation.id).toBe('conv-1');
    expect(out.payload.messages).toEqual([message]);
  });

  test('get cai no ledger do ticket quando channel_messages está vazio (compat)', async () => {
    const deps = makeDeps({
      getTicket: jest.fn(() => ({
        id: 't-1',
        messages: [{ id: 'm1', text: 'alo', sender: 'user', timestamp: '2026-08-27T09:30:00.000Z' }],
      })),
    });
    deps.channelConversationService.getConversation.mockResolvedValue(makeConversation({ currentTicketId: 't-1' }));
    const service = createInboxService(deps);

    const out = await service.getConversation(makeReq());

    expect(out.ok).toBe(true);
    expect(out.payload.messages).toHaveLength(1);
    expect(out.payload.messages[0]).toMatchObject({ direction: 'in', body: { text: 'alo' } });
  });

  test('get em conversa inexistente → 404 conversation_not_found', async () => {
    const deps = makeDeps();
    deps.channelConversationService.getConversation.mockResolvedValue(null);
    const service = createInboxService(deps);

    const out = await service.getConversation(makeReq());

    expect(out).toEqual({ ok: false, status: 404, payload: { error: 'conversation_not_found' } });
  });

  test('reply persiste em channel_messages (out) e despacha pelo canal da conversa', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), { body: 'Olá, posso ajudar?' });

    expect(out.ok).toBe(true);
    expect(out.payload.message.direction).toBe('out');
    expect(deps.channelConversationService.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      channelType: 'whatsapp',
      direction: 'out',
      body: { text: 'Olá, posso ajudar?' },
    }));
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      channelType: 'whatsapp',
      conversationId: 'conv-1',
      message: expect.objectContaining({
        to: '5511999999999',
        body: { text: 'Olá, posso ajudar?' },
      }),
    }));
    // Sem ticket atual: não espelha no ledger legado.
    expect(deps.conversationTicketLinkService.appendTicketMessage).not.toHaveBeenCalled();
  });

  test('reply com ticket atual espelha no ledger do ticket (compat)', async () => {
    const deps = makeDeps();
    deps.channelConversationService.getConversation.mockResolvedValue(makeConversation({ currentTicketId: 't-1' }));
    const service = createInboxService(deps);

    await service.reply(makeReq(), { body: 'resposta' });

    expect(deps.conversationTicketLinkService.appendTicketMessage).toHaveBeenCalledWith('t-1', expect.objectContaining({
      direction: 'out',
      text: 'resposta',
    }));
  });

  test('reply sem body → bad_request', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.reply(makeReq(), {});

    expect(out).toEqual({ ok: false, kind: 'bad_request', message: 'body é obrigatório' });
  });

  test('assign sem ticket atual seta assigned_to na conversa', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.assignConversation(makeReq(), { assigneeId: 'agent-9' });

    expect(out.ok).toBe(true);
    expect(deps.channelConversationService.updateConversation).toHaveBeenCalledWith(expect.objectContaining({
      patch: { assigned_to: 'agent-9' },
    }));
    expect(deps.assignTicket).not.toHaveBeenCalled();
  });

  test('assign com ticket atual delega ao ticket (compat)', async () => {
    const deps = makeDeps();
    deps.channelConversationService.getConversation.mockResolvedValue(makeConversation({ currentTicketId: 't-1' }));
    const service = createInboxService(deps);

    await service.assignConversation(makeReq(), { assigneeId: 'agent-9' });

    expect(deps.assignTicket).toHaveBeenCalledWith('t-1', 'agent-9');
  });

  test('notes sem ticket atual grava em metadata da conversa', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.addNote(makeReq(), { note: 'cliente pediu retorno' });

    expect(out).toEqual({ ok: true, status: 200, payload: { ok: true } });
    expect(deps.channelConversationService.updateConversation).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        metadata: expect.objectContaining({
          notes: [expect.objectContaining({ note: 'cliente pediu retorno', author: 'agent-1' })],
        }),
      }),
    }));
    expect(deps.addTicketNote).not.toHaveBeenCalled();
  });

  test('createCase delega ao caseService e retorna o case', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.createCase(makeReq(), { subject: 'Troca de plano', priority: 'high' });

    expect(out.ok).toBe(true);
    expect(out.status).toBe(201);
    expect(out.payload.case.id).toBe('cases-1');
    expect(deps.caseService.createCaseFromConversation).toHaveBeenCalledWith(expect.objectContaining({
      tenantKey: 'tenant-1',
      conversationId: 'conv-1',
      subject: 'Troca de plano',
      priority: 'high',
    }));
  });

  test('controller usa permissão do recurso inbox', async () => {
    const deps = makeDeps({
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
    });
    const service = createInboxService(deps);
    const controller = createInboxController({ service, deps });

    await controller.list(makeReq(), {});

    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'inbox', 'read');
  });

  test('list repassa filtro q (busca livre) para o service de canais', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    await service.listConversations(makeReq({ query: { q: '5511' } }));

    expect(deps.channelConversationService.listConversations).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      q: '5511',
    }));
  });

  test('get reseta metadata.unread.count quando a conversa tem não-lidas', async () => {
    const deps = makeDeps();
    deps.channelConversationService.getConversation.mockResolvedValue(makeConversation({
      metadata: { unread: { count: 3, lastInboundAt: '2026-08-27T10:00:00.000Z' }, origin: 'webhook' },
    }));
    const service = createInboxService(deps);

    const out = await service.getConversation(makeReq());

    expect(out.ok).toBe(true);
    expect(deps.channelConversationService.updateConversation).toHaveBeenCalledWith(expect.objectContaining({
      patch: {
        metadata: {
          unread: { count: 0, lastInboundAt: '2026-08-27T10:00:00.000Z' },
          origin: 'webhook',
        },
      },
    }));
    expect(out.payload.conversation.metadata.unread.count).toBe(0);
  });

  test('get sem unread não grava metadata', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.getConversation(makeReq());

    expect(out.ok).toBe(true);
    expect(deps.channelConversationService.updateConversation).not.toHaveBeenCalled();
  });

  test('setConversationStatus atualiza status e emite conversation.updated', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.setConversationStatus(makeReq(), { status: 'resolved' });

    expect(out.ok).toBe(true);
    expect(out.payload.ok).toBe(true);
    expect(out.payload.conversation.status).toBe('resolved');
    expect(deps.channelConversationService.updateConversation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      patch: { status: 'resolved' },
    }));
    expect(deps.emitEvent).toHaveBeenCalledWith('conversation.updated', expect.objectContaining({
      conversationId: 'conv-1',
      tenantId: 'tenant-1',
      status: 'resolved',
    }), { tenantId: 'tenant-1' });
  });

  test('setConversationStatus rejeita status fora do contrato (bad_request)', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    const out = await service.setConversationStatus(makeReq(), { status: 'deleted' });

    expect(out.ok).toBe(false);
    expect(out.kind).toBe('bad_request');
    expect(deps.channelConversationService.updateConversation).not.toHaveBeenCalled();
  });

  test('setConversationStatus em conversa inexistente → 404', async () => {
    const deps = makeDeps();
    deps.channelConversationService.getConversation.mockResolvedValue(null);
    const service = createInboxService(deps);

    const out = await service.setConversationStatus(makeReq(), { status: 'open' });

    expect(out).toEqual({ ok: false, status: 404, payload: { error: 'conversation_not_found' } });
  });

  test('assign emite conversation.updated com assignedTo', async () => {
    const deps = makeDeps();
    const service = createInboxService(deps);

    await service.assignConversation(makeReq(), { assigneeId: 'agent-9' });

    expect(deps.emitEvent).toHaveBeenCalledWith('conversation.updated', expect.objectContaining({
      conversationId: 'conv-1',
      tenantId: 'tenant-1',
      assignedTo: 'agent-9',
    }), { tenantId: 'tenant-1' });
  });

  test('controller setStatus exige permissão inbox:update e responde 400 em status inválido', async () => {
    const deps = makeDeps({
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({ status: 'bogus' })),
    });
    const service = createInboxService(deps);
    const controller = createInboxController({ service, deps });

    await controller.setStatus(makeReq(), {});

    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'inbox', 'update');
    expect(deps.badRequest).toHaveBeenCalled();
  });

  test('router monta as rotas do contrato (inclui reply e case)', () => {
    const router = createInboxRoutes({ buildDeps: () => makeDeps() });
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/inbox/conversations', methods: ['get'] },
      { path: '/inbox/conversations/:conversationId/intelligence', methods: ['get'] },
      { path: '/inbox/conversations/:conversationId', methods: ['get'] },
      { path: '/inbox/conversations/:conversationId/reply', methods: ['post'] },
      { path: '/inbox/conversations/:conversationId/assign', methods: ['post'] },
      { path: '/inbox/conversations/:conversationId/transfer', methods: ['post'] },
      { path: '/inbox/conversations/:conversationId/status', methods: ['post'] },
      { path: '/inbox/conversations/:conversationId/notes', methods: ['post'] },
      { path: '/inbox/conversations/:conversationId/case', methods: ['post'] },
    ]);
  });
});

describe('inteligência da conversa (NBA + resultados no Inbox)', () => {
  function makeIntelligenceDeps(overrides = {}) {
    return makeDeps({
      workspaceEntityLink: {
        findOne: jest.fn(async () => ({ entity_id: 'ent-1' })),
      },
      linkAutomationService: {
        linkConversationCreated: jest.fn(async () => ({ entity_id: 'ent-healed' })),
      },
      workspaceService: {
        getActions: jest.fn(async () => ({
          items: [],
          suggestion: {
            type: 'followup',
            label: 'Retomar contato',
            reason: 'Cliente sem resposta há 4 dias.',
            confidence: 0.82,
            risk: 'low',
            expectedOutcome: 'Recuperar o relacionamento',
            action: { kind: 'send_message', label: 'Responder agora', conversationId: 'conv-1' },
          },
          tenantRecommendation: null,
          recentOutcomes: [{ id: 'rec-1', title: 'Enviar lembrete', status: 'applied' }],
        })),
      },
      ...overrides,
    });
  }

  test('conversa com entidade vinculada retorna suggestion e recentOutcomes', async () => {
    const deps = makeIntelligenceDeps();
    const service = createInboxService(deps);

    const out = await service.getConversationIntelligence(makeReq());

    expect(out.ok).toBe(true);
    expect(out.status).toBe(200);
    expect(out.payload.entityId).toBe('ent-1');
    expect(out.payload.suggestion.label).toBe('Retomar contato');
    expect(out.payload.recentOutcomes).toHaveLength(1);
    expect(deps.workspaceService.getActions).toHaveBeenCalledWith('tenant-1', 'ent-1', expect.objectContaining({
      classification: expect.any(String),
    }));
    // Vínculo encontrado: auto-heal não é necessário
    expect(deps.linkAutomationService.linkConversationCreated).not.toHaveBeenCalled();
  });

  test('conversa sem vínculo dispara auto-heal e usa a entidade criada', async () => {
    const deps = makeIntelligenceDeps({
      workspaceEntityLink: { findOne: jest.fn(async () => null) },
    });
    const service = createInboxService(deps);

    const out = await service.getConversationIntelligence(makeReq());

    expect(out.ok).toBe(true);
    expect(deps.linkAutomationService.linkConversationCreated).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      conversation: { id: 'conv-1', external_id: '5511999999999', contact_id: '5511999999999' },
    });
    expect(out.payload.entityId).toBe('ent-healed');
    expect(deps.workspaceService.getActions).toHaveBeenCalledWith('tenant-1', 'ent-healed', expect.anything());
  });

  test('sem vínculo e auto-heal nulo retorna payload vazio com 200', async () => {
    const deps = makeIntelligenceDeps({
      workspaceEntityLink: { findOne: jest.fn(async () => null) },
      linkAutomationService: { linkConversationCreated: jest.fn(async () => null) },
    });
    const service = createInboxService(deps);

    const out = await service.getConversationIntelligence(makeReq());

    expect(out).toEqual({
      ok: true,
      status: 200,
      payload: { entityId: null, suggestion: null, tenantRecommendation: null, recentOutcomes: [] },
    });
    expect(deps.workspaceService.getActions).not.toHaveBeenCalled();
  });

  test('conversa inexistente retorna 404 conversation_not_found', async () => {
    const deps = makeIntelligenceDeps();
    deps.channelConversationService.getConversation.mockResolvedValue(null);
    const service = createInboxService(deps);

    const out = await service.getConversationIntelligence(makeReq());

    expect(out).toEqual({ ok: false, status: 404, payload: { error: 'conversation_not_found' } });
  });

  test('sem tenant retorna 403 tenant_required', async () => {
    const deps = makeIntelligenceDeps();
    const service = createInboxService(deps);

    const out = await service.getConversationIntelligence(makeReq({ tenantId: null, agent: null }));

    expect(out).toEqual({ ok: false, status: 403, payload: { error: 'tenant_required' } });
  });

  test('falha na inteligência é fail-closed: 200 com campos vazios e warn', async () => {
    const deps = makeIntelligenceDeps();
    deps.workspaceService.getActions.mockRejectedValue(new Error('db down'));
    const service = createInboxService(deps);

    const out = await service.getConversationIntelligence(makeReq());

    expect(out).toEqual({
      ok: true,
      status: 200,
      payload: { entityId: null, suggestion: null, tenantRecommendation: null, recentOutcomes: [] },
    });
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  test('controller intelligence exige auth + inbox:read e responde payload do service', async () => {
    const deps = makeIntelligenceDeps({
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
    });
    const service = createInboxService(deps);
    const controller = createInboxController({ service, deps });

    await controller.intelligence(makeReq(), {});

    expect(deps.requirePermission).toHaveBeenCalledWith(expect.anything(), 'inbox', 'read');
    expect(deps.sendJson).toHaveBeenCalledWith({}, 200, expect.objectContaining({
      entityId: 'ent-1',
      suggestion: expect.objectContaining({ label: 'Retomar contato' }),
    }));
  });

  test('controller intelligence nega sem permissão inbox:read', async () => {
    const deps = makeIntelligenceDeps({
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
    });
    const service = createInboxService(deps);
    const controller = createInboxController({ service, deps });

    await controller.intelligence(makeReq(), {});

    expect(deps.sendJson).toHaveBeenCalledWith({}, 403, expect.objectContaining({ error: 'forbidden' }));
    expect(deps.workspaceService.getActions).not.toHaveBeenCalled();
  });
});
