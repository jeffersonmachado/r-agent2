'use strict';

jest.mock('../../api/services/authService', () => ({
  listAgents: jest.fn(),
}));

jest.mock('../../api/services/departmentsService', () => ({
  listDepartments: jest.fn(),
}));

jest.mock('../../api/services/scheduleService', () => ({
  _getTenantStore: jest.fn(),
  listSchedules: jest.fn(),
  createSchedule: jest.fn(),
  getSchedule: jest.fn(),
  deleteSchedule: jest.fn(),
}));

jest.mock('../../api/db/models', () => ({
  MarketingLead: jest.fn(),
}));

const authService = require('../../api/services/authService');
const departmentsService = require('../../api/services/departmentsService');
const scheduleService = require('../../api/services/scheduleService');
const { MarketingLead } = require('../../api/db/models');
const { handleSchedulingSupportRoutes } = require('../../api/modules/scheduling-support/handleSchedulingSupportRoutes');

function makeDeps(overrides = {}) {
  return {
    requireAuth: jest.fn(() => ({ valid: true })),
    requireTenant: jest.fn(() => 'tenant-1'),
    sendJson: jest.fn(),
    badRequest: jest.fn(),
    hasJsonContentType: jest.fn(() => true),
    parseJsonBody: jest.fn(async () => ({})),
    logger: { warn: jest.fn() },
    ...overrides,
  };
}

describe('schedulingSupportRoutes', () => {
  let store;

  beforeEach(() => {
    jest.clearAllMocks();

    authService.listAgents.mockResolvedValue([
      { id: 'u1', name: 'Alice', email: 'alice@example.com', username: 'alice', role: 'admin', status: 'active' },
      { id: 'u2', name: 'Bob', email: 'bob@example.com', username: 'bob', role: 'agent', status: 'active' },
    ]);

    departmentsService.listDepartments.mockReturnValue([
      { id: 'team-1', name: 'Atendimento', description: 'Equipe de atendimento', color: '#111111', active: true },
      { id: 'team-2', name: 'Comercial', description: 'Equipe comercial', color: '#222222', active: true },
    ]);

    store = new Map();
    store.set('s1', {
      id: 's1',
      contextType: 'custom',
      contextId: 'u1',
      ownerId: 'u1',
      startAt: '2026-03-15T10:00:00.000Z',
      endAt: '2026-03-15T11:00:00.000Z',
      purpose: 'consulta',
      status: 'scheduled',
    });
    store.set('block-1', {
      id: 'block-1',
      contextType: 'calendar_block',
      contextId: 'u1',
      startAt: '2026-03-15T12:00:00.000Z',
      endAt: '2026-03-15T13:00:00.000Z',
      notes: 'almoco',
      metadata: { reason: 'almoco' },
    });

    scheduleService._getTenantStore.mockImplementation(() => store);
    scheduleService.listSchedules.mockImplementation(() => ({ items: Array.from(store.values()), total: store.size }));
    scheduleService.createSchedule.mockImplementation(({ payload }) => {
      const created = {
        id: `created-${store.size + 1}`,
        contextType: payload.contextType,
        contextId: payload.contextId,
        startAt: payload.startAt,
        endAt: payload.endAt,
        notes: payload.notes,
        metadata: payload.metadata || {},
      };
      store.set(created.id, created);
      return created;
    });
    scheduleService.getSchedule.mockImplementation(({ scheduleId }) => store.get(scheduleId) || null);
    scheduleService.deleteSchedule.mockImplementation(({ scheduleId }) => store.delete(scheduleId));

    MarketingLead.mockImplementation(() => ({
      findAll: jest.fn(async () => [
        {
          toJSON: () => ({
            id: 'lead-1',
            name: 'Cliente Teste',
            email: 'cliente@example.com',
            phone: '11999999999',
            stage: 'qualified',
            score: 80,
            external_id: 'ext-1',
            last_seen_at: '2026-03-15T09:00:00.000Z',
            attributes: { source: 'site' },
          }),
        },
      ]),
    }));
  });

  test('GET /api/users/search retorna usuarios filtrados', async () => {
    const deps = makeDeps();
    const res = {};

    const handled = await handleSchedulingSupportRoutes({
      req: { url: '/api/users/search?q=ali&limit=10', tenantId: 'tenant-1' },
      res,
      method: 'GET',
      pathname: '/api/users/search',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      items: [expect.objectContaining({ id: 'u1', name: 'Alice' })],
      total: 1,
    }));
  });

  test('GET /api/crm/contacts retorna contatos', async () => {
    const deps = makeDeps();
    const res = {};

    const handled = await handleSchedulingSupportRoutes({
      req: { url: '/api/crm/contacts?limit=10&offset=0', tenantId: 'tenant-1' },
      res,
      method: 'GET',
      pathname: '/api/crm/contacts',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      items: [expect.objectContaining({ id: 'lead-1', name: 'Cliente Teste' })],
      contacts: [expect.objectContaining({ id: 'lead-1' })],
    }));
  });

  test('GET /api/calendar/me inclui schedule e block do recurso', async () => {
    const deps = makeDeps();
    const res = {};

    const handled = await handleSchedulingSupportRoutes({
      req: {
        url: '/api/calendar/me?start=2026-03-15T00:00:00.000Z&end=2026-03-16T00:00:00.000Z',
        tenantId: 'tenant-1',
        agent: { id: 'u1', username: 'alice' },
      },
      res,
      method: 'GET',
      pathname: '/api/calendar/me',
      deps,
    });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      resourceId: 'u1',
      total: 2,
      items: expect.arrayContaining([
        expect.objectContaining({ id: 's1', type: 'schedule' }),
        expect.objectContaining({ id: 'block-1', type: 'block' }),
      ]),
    }));
  });

  test('POST e DELETE de /api/calendar/resource/:id/blocks funcionam', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        startAt: '2026-03-15T18:00:00.000Z',
        endAt: '2026-03-15T19:00:00.000Z',
        reason: 'treinamento',
      })),
    });
    const resPost = {};

    const handledPost = await handleSchedulingSupportRoutes({
      req: { url: '/api/calendar/resource/u1/blocks', tenantId: 'tenant-1' },
      res: resPost,
      method: 'POST',
      pathname: '/api/calendar/resource/u1/blocks',
      deps,
    });

    expect(handledPost).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(resPost, 201, expect.objectContaining({
      item: expect.objectContaining({ type: 'block', contextId: 'u1' }),
    }));

    const createdId = deps.sendJson.mock.calls.find((call) => call[1] === 201)[2].item.id;
    const resDelete = {};
    const handledDelete = await handleSchedulingSupportRoutes({
      req: { url: `/api/calendar/resource/u1/blocks/${createdId}`, tenantId: 'tenant-1' },
      res: resDelete,
      method: 'DELETE',
      pathname: `/api/calendar/resource/u1/blocks/${createdId}`,
      deps,
    });

    expect(handledDelete).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(resDelete, 200, { ok: true });
  });
});
