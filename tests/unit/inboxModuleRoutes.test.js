'use strict';

const { createInboxRoutes } = require('../../api/modules/inbox/routes');
const { createInboxController } = require('../../api/modules/inbox/controller');

describe('inbox module', () => {
  function makeTicket() {
    return { id: 't1', tenantId: 'tenant1', queue: 'support', assignedTo: null };
  }

  function makeDeps(overrides = {}) {
    const ticket = makeTicket();
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      listAllTickets: jest.fn(() => [ticket]),
      getTicket: jest.fn(() => ticket),
      canAccessTicket: jest.fn(() => true),
      canModifyTicket: jest.fn(() => true),
      assignTicket: jest.fn(() => ({ ...ticket, assignedTo: 'a1' })),
      transferTicket: jest.fn(() => ({ ...ticket, queue: 'billing' })),
      addTicketNote: jest.fn(() => ({ ...ticket, notes: [{ note: 'ok' }] })),
      triggerWebhooks: jest.fn(async () => {}),
      emitEvent: jest.fn(),
      logAction: jest.fn(),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
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

  test('controller transfer valida queue obrigatoria', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({})),
    });
    const service = {
      transferConversation: jest.fn(async () => ({ ok: false, kind: 'bad_request', message: 'queue é obrigatório' })),
    };
    const controller = createInboxController({ service, deps });
    const res = {};

    await controller.transfer({}, res);

    expect(deps.badRequest).toHaveBeenCalledWith(res, 'queue é obrigatório');
  });

  test('controller notes preserva retorno 200', async () => {
    const deps = makeDeps();
    const service = {
      addNote: jest.fn(async () => ({ ok: true, status: 200, payload: { id: 't1', notes: [{ note: 'ok' }] } })),
    };
    const controller = createInboxController({ service, deps });
    const res = {};

    await controller.notes({}, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, { id: 't1', notes: [{ note: 'ok' }] });
  });
});
