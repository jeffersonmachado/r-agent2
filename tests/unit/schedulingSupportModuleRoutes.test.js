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
const { createSchedulingSupportRoutes } = require('../../api/modules/scheduling-support/routes');
const { createSchedulingSupportController } = require('../../api/modules/scheduling-support/controller');

describe('scheduling-support module', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    authService.listAgents.mockResolvedValue([]);
    departmentsService.listDepartments.mockReturnValue([]);
    scheduleService._getTenantStore.mockImplementation(() => new Map());
    scheduleService.listSchedules.mockImplementation(() => ({ items: [], total: 0 }));
  });

  test('router nativo monta rotas esperadas', () => {
    const router = createSchedulingSupportRoutes({ buildDeps: () => makeDeps() });
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(paths).toEqual([
      { path: '/api/users/search', methods: ['get'] },
      { path: '/api/teams/search', methods: ['get'] },
      { path: '/api/schedule-purposes', methods: ['get'] },
      { path: '/api/crm/contacts', methods: ['get'] },
      { path: '/api/calendar/me', methods: ['get'] },
      { path: '/api/calendar/resource/:resourceId', methods: ['get'] },
      { path: '/api/calendar/resource/:resourceId/blocks', methods: ['post'] },
      { path: '/api/calendar/resource/:resourceId/blocks/:blockId', methods: ['delete'] },
    ]);
  });

  test('controller createBlock valida payload invalido', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ startAt: '2026-03-15T10:00:00.000Z', endAt: '2026-03-15T09:00:00.000Z' })),
    });
    const service = {
      createCalendarBlock: jest.fn(() => ({ ok: false, kind: 'bad_request', message: 'endAt deve ser maior que startAt' })),
    };
    const controller = createSchedulingSupportController({ service, deps });
    const res = {};

    await controller.createBlock({ params: { resourceId: 'u1' } }, res);

    expect(deps.badRequest).toHaveBeenCalledWith(res, 'endAt deve ser maior que startAt');
  });

  test('controller getMyCalendar preserva retorno 200', async () => {
    const deps = makeDeps();
    const service = {
      getMyCalendar: jest.fn(() => ({ ok: true, payload: { resourceId: 'u1', items: [], total: 0 } })),
    };
    const controller = createSchedulingSupportController({ service, deps });
    const res = {};

    await controller.getMyCalendar({ agent: { id: 'u1' } }, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      resourceId: 'u1',
      items: [],
      total: 0,
    });
  });
});
