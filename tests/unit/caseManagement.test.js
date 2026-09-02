'use strict';

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const mockState = {
  tickets: new Map(),
  links: [],
  conversations: new Map(),
};

function mockTicketRow(data) {
  return { ...data, toJSON() { const { toJSON, ...rest } = this; return rest; } };
}

function mockLinkRow(data) {
  return { ...data, toJSON() { const { toJSON, ...rest } = this; return rest; } };
}

// Nota: jest.config usa resetMocks/clearMocks globais — os mocks abaixo usam
// funções estáveis (não jest.fn) para sobreviver ao reset por teste.
jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => ({}),
}));

jest.mock('../../api/db/models', () => ({
  CaseConversation: () => ({
    findOne: async ({ where }) => mockState.links.find((l) => (
      l.tenant_key === where.tenant_key
      && l.case_id === where.case_id
      && l.conversation_id === where.conversation_id
    )) || null,
    findAll: async ({ where }) => mockState.links.filter((l) => (
      l.tenant_key === where.tenant_key && l.case_id === where.case_id
    )),
    create: async (data) => {
      const row = mockLinkRow(data);
      mockState.links.push(row);
      return row;
    },
    destroy: async ({ where }) => {
      const before = mockState.links.length;
      mockState.links = mockState.links.filter((l) => !(
        l.tenant_key === where.tenant_key
        && l.case_id === where.case_id
        && l.conversation_id === where.conversation_id
      ));
      return before - mockState.links.length;
    },
  }),
  Ticket: () => ({
    findOne: async ({ where }) => {
      const row = mockState.tickets.get(where.id);
      if (!row || row.tenant_key !== where.tenant_key) return null;
      return row;
    },
  }),
}));

const mockGetConversation = jest.fn();
const mockUpdateConversation = jest.fn();
const mockListConversationsByIds = jest.fn();

jest.mock('../../api/services/channelConversationService', () => ({
  getConversation: (...args) => mockGetConversation(...args),
  updateConversation: (...args) => mockUpdateConversation(...args),
  listConversationsByIds: (...args) => mockListConversationsByIds(...args),
}));

const mockCreateTicket = jest.fn();

jest.mock('../../api/services/queueService', () => ({
  createTicket: (...args) => mockCreateTicket(...args),
}));

const caseService = require('../../api/services/caseService');

function seedConversation({ id, tenantId, channelType = 'whatsapp', externalId = '5511999999999', currentTicketId = null }) {
  const conversation = {
    id,
    tenantId,
    channelType,
    externalId,
    status: 'open',
    currentTicketId,
    metadata: {},
  };
  mockState.conversations.set(`${tenantId}:${id}`, conversation);
  return conversation;
}

describe('caseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockState.tickets = new Map();
    mockState.links = [];
    mockState.conversations = new Map();

    mockGetConversation.mockImplementation(async ({ tenantId, conversationId }) => (
      mockState.conversations.get(`${tenantId}:${conversationId}`) || null
    ));
    mockUpdateConversation.mockImplementation(async ({ tenantId, conversationId, patch }) => {
      const key = `${tenantId}:${conversationId}`;
      const conversation = mockState.conversations.get(key);
      if (!conversation) return null;
      const updated = { ...conversation, ...patch };
      if (patch.assigned_to !== undefined) updated.assignedTo = patch.assigned_to;
      if (patch.current_ticket_id !== undefined) updated.currentTicketId = patch.current_ticket_id;
      mockState.conversations.set(key, updated);
      return updated;
    });
    mockListConversationsByIds.mockImplementation(async ({ tenantId, ids }) => (
      (ids || [])
        .map((id) => mockState.conversations.get(`${tenantId}:${id}`))
        .filter(Boolean)
    ));
    mockCreateTicket.mockImplementation(({ tenantId, queue, context }) => {
      const id = `${queue}-1`;
      const row = mockTicketRow({
        id,
        tenant_key: tenantId,
        session_id: context && context.conversationId ? `case_${context.conversationId}` : 'session',
        conversation_id: context?.conversationId || null,
        channel_type: context?.channelType || null,
        queue,
        status: 'waiting',
        context: context || {},
        created_at: new Date('2026-08-27T00:00:00.000Z'),
        updated_at: new Date('2026-08-27T00:00:00.000Z'),
      });
      mockState.tickets.set(id, row);
      return {
        id,
        tenantId,
        conversationId: context?.conversationId || null,
        status: 'waiting',
        queue,
        context: context || {},
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
      };
    });
  });

  test('createCaseFromConversation cria ticket, link e aponta current_ticket_id', async () => {
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });

    const result = await caseService.createCaseFromConversation({
      tenantKey: 'tenant-1',
      conversationId: 'conv-1',
      subject: 'Troca de plano',
      priority: 'high',
      createdBy: 'agent-1',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.case.id).toBe('cases-1');
    expect(result.case.priority).toBe('high');
    expect(mockState.links).toHaveLength(1);
    expect(mockState.links[0]).toMatchObject({
      tenant_key: 'tenant-1',
      case_id: 'cases-1',
      conversation_id: 'conv-1',
    });
    expect(mockUpdateConversation).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      patch: expect.objectContaining({ current_ticket_id: 'cases-1' }),
    }));
  });

  test('createCaseFromConversation é idempotente para conversa já vinculada', async () => {
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1', currentTicketId: 'cases-1' });
    mockState.tickets.set('cases-1', mockTicketRow({
      id: 'cases-1',
      tenant_key: 'tenant-1',
      queue: 'cases',
      status: 'in_progress',
      context: {},
    }));

    const result = await caseService.createCaseFromConversation({
      tenantKey: 'tenant-1',
      conversationId: 'conv-1',
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyExisted).toBe(true);
    expect(mockCreateTicket).not.toHaveBeenCalled();
    expect(mockState.links).toHaveLength(1); // link recriado uma única vez
  });

  test('conversa de outro tenant → 404 fail-closed', async () => {
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });

    const result = await caseService.createCaseFromConversation({
      tenantKey: 'tenant-2',
      conversationId: 'conv-1',
    });

    expect(result).toEqual({ ok: false, status: 404, error: 'conversation_not_found' });
    expect(mockCreateTicket).not.toHaveBeenCalled();
  });

  test('linkConversationToCase vincula 2 conversas ao mesmo case', async () => {
    mockState.tickets.set('cases-1', mockTicketRow({
      id: 'cases-1',
      tenant_key: 'tenant-1',
      queue: 'cases',
      status: 'waiting',
      context: {},
    }));
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });
    seedConversation({ id: 'conv-2', tenantId: 'tenant-1', channelType: 'instagram', externalId: 'user2' });

    const first = await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-1' });
    const second = await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-2' });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(mockState.links).toHaveLength(2);

    const conversations = await caseService.listCaseConversations({ tenantKey: 'tenant-1', caseId: 'cases-1' });
    expect(conversations.map((c) => c.id).sort()).toEqual(['conv-1', 'conv-2']);
  });

  test('listCaseConversations faz 1 query em lote (sem N+1 por link) e preserva ordem dos links', async () => {
    mockState.tickets.set('cases-1', mockTicketRow({
      id: 'cases-1',
      tenant_key: 'tenant-1',
      queue: 'cases',
      status: 'waiting',
      context: {},
    }));
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });
    seedConversation({ id: 'conv-2', tenantId: 'tenant-1', channelType: 'instagram', externalId: 'user2' });
    await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-1' });
    await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-2' });

    mockGetConversation.mockClear();
    mockListConversationsByIds.mockClear();

    const conversations = await caseService.listCaseConversations({ tenantKey: 'tenant-1', caseId: 'cases-1' });

    expect(conversations.map((c) => c.id)).toEqual(['conv-1', 'conv-2']);
    expect(mockListConversationsByIds).toHaveBeenCalledTimes(1);
    expect(mockListConversationsByIds).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      ids: ['conv-1', 'conv-2'],
    });
    // N+1 eliminado: nenhum findOne por link.
    expect(mockGetConversation).not.toHaveBeenCalled();
  });

  test('listCaseConversations ignora falha da leitura em lote (sem derrubar a listagem)', async () => {
    mockState.tickets.set('cases-1', mockTicketRow({
      id: 'cases-1',
      tenant_key: 'tenant-1',
      queue: 'cases',
      status: 'waiting',
      context: {},
    }));
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });
    await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-1' });

    mockListConversationsByIds.mockRejectedValueOnce(new Error('db down'));

    const conversations = await caseService.listCaseConversations({ tenantKey: 'tenant-1', caseId: 'cases-1' });
    expect(conversations).toEqual([]);
  });

  test('linkConversationToCase é idempotente', async () => {
    mockState.tickets.set('cases-1', mockTicketRow({
      id: 'cases-1',
      tenant_key: 'tenant-1',
      queue: 'cases',
      status: 'waiting',
      context: {},
    }));
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });

    await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-1' });
    const again = await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-1' });

    expect(again.alreadyExisted).toBe(true);
    expect(mockState.links).toHaveLength(1);
  });

  test('linkConversationToCase cross-tenant (conversa de outro tenant) → 404', async () => {
    mockState.tickets.set('cases-1', mockTicketRow({
      id: 'cases-1',
      tenant_key: 'tenant-1',
      queue: 'cases',
      status: 'waiting',
      context: {},
    }));
    seedConversation({ id: 'conv-9', tenantId: 'tenant-2' });

    const result = await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-9' });

    expect(result).toEqual({ ok: false, status: 404, error: 'conversation_not_found' });
    expect(mockState.links).toHaveLength(0);
  });

  test('linkConversationToCase com case de outro tenant → 404', async () => {
    mockState.tickets.set('cases-2', mockTicketRow({
      id: 'cases-2',
      tenant_key: 'tenant-2',
      queue: 'cases',
      status: 'waiting',
      context: {},
    }));
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });

    const result = await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-2', conversationId: 'conv-1' });

    expect(result).toEqual({ ok: false, status: 404, error: 'case_not_found' });
    expect(mockState.links).toHaveLength(0);
  });

  test('unlinkConversation remove o link com isolamento de tenant', async () => {
    mockState.tickets.set('cases-1', mockTicketRow({
      id: 'cases-1',
      tenant_key: 'tenant-1',
      queue: 'cases',
      status: 'waiting',
      context: {},
    }));
    seedConversation({ id: 'conv-1', tenantId: 'tenant-1' });
    await caseService.linkConversationToCase({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-1' });

    const removed = await caseService.unlinkConversation({ tenantKey: 'tenant-1', caseId: 'cases-1', conversationId: 'conv-1' });

    expect(removed).toEqual({ ok: true, status: 200, removed: true });
    expect(mockState.links).toHaveLength(0);
  });
});
