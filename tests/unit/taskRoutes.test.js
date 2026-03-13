describe('taskRoutes handler', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      requireTenant: jest.fn(() => 'tenant-1'),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('retorna false para rota nao tratada', async () => {
    jest.doMock('../../api/services/tasksService', () => ({}));
    const { handleTaskRoutes } = require('../../api/serverHandlers/taskRoutes');

    const deps = makeDeps();
    const handled = await handleTaskRoutes({
      req: {},
      res: {},
      method: 'GET',
      pathname: '/other',
      deps,
    });

    expect(handled).toBe(false);
    expect(deps.sendJson).not.toHaveBeenCalled();
  });

  test('GET /tasks retorna 403 sem permissao', async () => {
    jest.doMock('../../api/services/tasksService', () => ({ listTasks: jest.fn() }));
    const { handleTaskRoutes } = require('../../api/serverHandlers/taskRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ requirePermission: jest.fn(() => ({ allowed: false, error: 'forbidden' })) });

    const handled = await handleTaskRoutes({ req, res, method: 'GET', pathname: '/tasks', deps });

    expect(handled).toBe(true);
    expect(deps.sendJson).toHaveBeenCalledWith(res, 403, {
      error: 'forbidden',
      message: 'forbidden',
    });
  });

  test('POST /tasks valida content-type', async () => {
    const createTask = jest.fn(async () => ({ ok: true, task: { id: 't1' } }));
    jest.doMock('../../api/services/tasksService', () => ({ createTask }));
    const { handleTaskRoutes } = require('../../api/serverHandlers/taskRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ hasJsonContentType: jest.fn(() => false) });

    const handled = await handleTaskRoutes({ req, res, method: 'POST', pathname: '/tasks', deps });

    expect(handled).toBe(true);
    expect(createTask).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'Content-Type deve ser application/json');
  });

  test('POST /tasks exige title', async () => {
    const createTask = jest.fn(async () => ({ ok: true, task: { id: 't1' } }));
    jest.doMock('../../api/services/tasksService', () => ({ createTask }));
    const { handleTaskRoutes } = require('../../api/serverHandlers/taskRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({ parseJsonBody: jest.fn(async () => ({ description: 'x' })) });

    const handled = await handleTaskRoutes({ req, res, method: 'POST', pathname: '/tasks', deps });

    expect(handled).toBe(true);
    expect(createTask).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, 'title é obrigatório');
  });

  test('POST /tasks cria tarefa', async () => {
    const createTask = jest.fn(async () => ({ ok: true, task: { id: 'task-1', title: 'Follow up' } }));
    jest.doMock('../../api/services/tasksService', () => ({ createTask }));
    const { handleTaskRoutes } = require('../../api/serverHandlers/taskRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({
        title: '  Follow up  ',
        description: 'desc',
        dueAt: '2026-03-12T10:00:00.000Z',
        priority: 'high',
      })),
    });

    const handled = await handleTaskRoutes({ req, res, method: 'POST', pathname: '/tasks', deps });

    expect(handled).toBe(true);
    expect(createTask).toHaveBeenCalledWith('tenant-1', {
      title: 'Follow up',
      description: 'desc',
      dueAt: '2026-03-12T10:00:00.000Z',
      priority: 'high',
    });
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, {
      ok: true,
      task: { id: 'task-1', title: 'Follow up' },
    });
  });

  test('POST /tasks/:id/complete mapeia not_found para 404', async () => {
    const completeTask = jest.fn(async () => ({ ok: false, error: 'not_found' }));
    jest.doMock('../../api/services/tasksService', () => ({ completeTask }));
    const { handleTaskRoutes } = require('../../api/serverHandlers/taskRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps();

    const handled = await handleTaskRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/tasks/task-2/complete',
      deps,
    });

    expect(handled).toBe(true);
    expect(completeTask).toHaveBeenCalledWith('tenant-1', 'task-2');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 404, {
      error: 'not_found',
      message: 'Tarefa não encontrada',
    });
  });

  test('POST /tasks/:id/reminder agenda lembrete', async () => {
    const scheduleReminder = jest.fn(async () => ({ ok: true, task: { id: 'task-3', reminderAt: '2026-03-12T11:00:00.000Z' } }));
    jest.doMock('../../api/services/tasksService', () => ({ scheduleReminder }));
    const { handleTaskRoutes } = require('../../api/serverHandlers/taskRoutes');

    const req = {};
    const res = {};
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ reminderAt: '2026-03-12T11:00:00.000Z' })),
    });

    const handled = await handleTaskRoutes({
      req,
      res,
      method: 'POST',
      pathname: '/tasks/task-3/reminder',
      deps,
    });

    expect(handled).toBe(true);
    expect(scheduleReminder).toHaveBeenCalledWith('tenant-1', 'task-3', '2026-03-12T11:00:00.000Z');
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ok: true,
      task: { id: 'task-3', reminderAt: '2026-03-12T11:00:00.000Z' },
    });
  });
});
