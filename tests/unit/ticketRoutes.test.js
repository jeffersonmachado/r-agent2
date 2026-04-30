describe('ticketRoutes handler', () => {
  let handleTicketRoutes;

  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      createTicket: jest.fn(() => ({ id: 't-new', queue: 'support', conversationId: null })),
      getTicket: jest.fn(() => null),
      getTicketBySession: jest.fn(() => null),
      closeTicket: jest.fn(),
      listAllTickets: jest.fn(() => ({
        tickets: [],
        total: 0,
        limit: undefined,
        offset: undefined,
      })),
      listQueues: jest.fn(() => []),
      getMetrics: jest.fn(() => ({ totalTickets: 0, ticketsByStatus: {}, ticketsByQueue: {} })),
      addAgentMessage: jest.fn(),
      updateOutboundMessageMeta: jest.fn(),
      markMessagesAsRead: jest.fn(),
      getTicketMessages: jest.fn(() => []),
      canAccessTicket: jest.fn(() => true),
      canModifyTicket: jest.fn(() => true),
      assignTicket: jest.fn(),
      triggerWebhooks: jest.fn(() => Promise.resolve()),
      emitEvent: jest.fn(),
      logAction: jest.fn(),
      outboundQueueService: { enqueueOutbound: jest.fn(() => Promise.resolve()) },
      listConversationMessages: jest.fn(async () => ({ items: [] })),
      takeOverTicket: jest.fn(),
      returnTicketToBot: jest.fn(),
      pauseTicket: jest.fn(),
      resumeHumanTicket: jest.fn(),
      autoAssignTicket: jest.fn(() => Promise.resolve()),
      closeReasonsService: {
        listCloseReasons: jest.fn(() => []),
      },
      ticketInsightService: {
        getAiSummary: jest.fn(),
        generateAiSummary: jest.fn(),
      },
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      url: '/tickets',
      tenantId: 'tenant-1',
      agent: { id: 'agent-1', username: 'alice', role: 'admin' },
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    handleTicketRoutes = require('../../api/modules/ticket/handleTicketRoutes').handleTicketRoutes;
  });

  test('retorna false para rota nao tratada', async () => {
    const handled = await handleTicketRoutes({
      req: makeReq({ url: '/other' }),
      res: {},
      method: 'GET',
      pathname: '/other',
      deps: makeDeps(),
    });

    expect(handled).toBe(false);
  });

  test('GET /tickets retorna 401 sem autenticacao', async () => {
    const res = {};
    const deps = makeDeps({
      requireAuth: jest.fn(() => ({ valid: false, error: 'unauthorized' })),
    });

    const handled = await handleTicketRoutes({
      req: makeReq(),
      res,
      method: 'GET',
      pathname: '/tickets',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 401, expect.objectContaining({ error: 'unauthorized' }));
  });

  test('GET /tickets filtra tickets para role agent', async () => {
    const res = {};
    const deps = makeDeps({
      listAllTickets: jest.fn(() => ({
        tickets: [
          { id: 't-1', assignedTo: 'agent-1' },
          { id: 't-2', assignedTo: 'agent-2' },
        ],
        total: 2,
        limit: undefined,
        offset: undefined,
      })),
      canAccessTicket: jest.fn((agent, ticket) => agent.id === ticket.assignedTo),
    });

    const handled = await handleTicketRoutes({
      req: makeReq({ agent: { id: 'agent-1', username: 'alice', role: 'agent' } }),
      res,
      method: 'GET',
      pathname: '/tickets',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        total: 1,
        tickets: [{ id: 't-1', assignedTo: 'agent-1' }],
      })
    );
  });

  test('POST /tickets valida telefone antes de criar ticket', async () => {
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        phoneNumber: 'abc',
        queue: 'support',
      })),
    });

    const handled = await handleTicketRoutes({
      req: makeReq({ url: '/tickets' }),
      res,
      method: 'POST',
      pathname: '/tickets',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(
      res,
      'Número de telefone inválido. Use formato: +5511999999999 ou 5511999999999'
    );
    expect(deps.createTicket).not.toHaveBeenCalled();
  });

  test('POST /tickets usa sessionId canônico e tenant no dedupe', async () => {
    const res = {};
    const existingTicket = { id: 't-existing', status: 'in_progress' };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        phoneNumber: '11 98864-8492',
        queue: 'support',
      })),
      getTicketBySession: jest.fn(() => existingTicket),
    });

    const handled = await handleTicketRoutes({
      req: makeReq({ url: '/tickets', tenantId: 'tenant-1' }),
      res,
      method: 'POST',
      pathname: '/tickets',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.getTicketBySession).toHaveBeenCalledWith('whatsapp_5511988648492', 'tenant-1');
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      409,
      expect.objectContaining({ error: 'ticket_already_exists' })
    );
    expect(deps.createTicket).not.toHaveBeenCalled();
  });

  test('POST /tickets/:id/message rejeita payload sem message e sem media', async () => {
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({})),
      getTicket: jest.fn(() => ({
        id: 't-1',
        tenantId: 'tenant-1',
        status: 'in_progress',
        phoneNumber: '5511999999999',
        conversationId: 'conv-1',
        messages: [],
        assignedTo: 'agent-1',
      })),
    });

    const handled = await handleTicketRoutes({
      req: makeReq({ url: '/tickets/t-1/message' }),
      res,
      method: 'POST',
      pathname: '/tickets/t-1/message',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.badRequest).toHaveBeenCalledWith(
      res,
      'Campo "message" ou "media" é obrigatório e não pode estar vazio'
    );
    expect(deps.addAgentMessage).not.toHaveBeenCalled();
    expect(deps.outboundQueueService.enqueueOutbound).not.toHaveBeenCalled();
  });

  test('POST /tickets/:id/message aceita media sem message e enfileira fallback textual', async () => {
    const res = {};
    const ticket = {
      id: 't-1',
      tenantId: 'tenant-1',
      status: 'in_progress',
      phoneNumber: '5511999999999',
      conversationId: 'conv-1',
      messages: [
        { sender: 'user', text: 'oi' },
      ],
      assignedTo: 'agent-1',
    };
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        media: {
          type: 'image',
          url: 'https://cdn.example.com/a.png',
          fileName: 'a.png',
        },
      })),
      getTicket: jest.fn(() => ticket),
      addAgentMessage: jest.fn((id, message, agentId, options) => {
        ticket.messages.push({ sender: 'agent', text: message, deliveryStatus: 'pending', clientMessageId: options.clientMessageId, agentId });
        return ticket;
      }),
    });

    const handled = await handleTicketRoutes({
      req: makeReq({ url: '/tickets/t-1/message' }),
      res,
      method: 'POST',
      pathname: '/tickets/t-1/message',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.addAgentMessage).toHaveBeenCalledWith(
      't-1',
      '[image] a.png',
      'agent-1',
      expect.objectContaining({
        clientMessageId: expect.stringMatching(/^outq-/),
        deliveryStatus: 'pending',
      })
    );
    expect(deps.outboundQueueService.enqueueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        conversationId: 'conv-1',
        message: expect.objectContaining({
          to: '5511999999999',
          type: 'text',
          body: { text: '[image] a.png\nhttps://cdn.example.com/a.png' },
          meta: expect.objectContaining({
            ticketId: 't-1',
            clientMessageId: expect.stringMatching(/^outq-/),
          }),
        }),
      })
    );
    expect(deps.sendJson).toHaveBeenCalledWith(
      res,
      200,
      expect.objectContaining({
        success: true,
        ticketId: 't-1',
        message: '[image] a.png',
      })
    );
  });
});
