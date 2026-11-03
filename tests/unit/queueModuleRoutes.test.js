'use strict';

const { createQueueController } = require('../../api/modules/queue/controller');
const { createQueueService } = require('../../api/modules/queue/service');
const { createQueueRoutes } = require('../../api/modules/queue/routes');

describe('queue module', () => {
  function makeDeps(overrides = {}) {
    return {
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({})),
      listQueues: jest.fn(() => ['Support', 'Sales']),
      createQueue: jest.fn(() => ({ success: true, queueName: 'newq', message: 'Fila criada' })),
      getQueueInfo: jest.fn(() => ({ name: 'support', size: 3 })),
      deleteQueue: jest.fn(() => ({ success: true, message: 'deletada' })),
      listQueue: jest.fn(() => []),
      canAccessTicket: jest.fn(() => true),
      queueDefinitionService: {
        listQueues: jest.fn(() => [{ name: 'Delivery' }, { name: 'Support' }]),
        upsertQueue: jest.fn(async () => {}),
      },
      logAction: jest.fn(),
      logger: { error: jest.fn() },
      ...overrides,
    };
  }

  function makeReq(overrides = {}) {
    return {
      tenantId: 'tenant-1',
      url: '/',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      agent: { id: 'agent-1', username: 'alice', role: 'admin' },
      params: {},
      ...overrides,
    };
  }

  test('router nativo monta rotas esperadas', () => {
    const router = createQueueRoutes({ buildDeps: () => makeDeps() });
    const stack = router.stack
      .filter((layer) => layer.route)
      .map((layer) => ({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).sort(),
      }));

    expect(stack).toEqual([
      { path: '/queues', methods: ['get'] },
      { path: '/queues', methods: ['post'] },
      { path: '/queues/:queueName/tickets', methods: ['get'] },
      { path: '/queues/:queueName', methods: ['get'] },
      { path: '/queues/:queueName', methods: ['delete'] },
    ]);
  });

  test('controller list faz merge de filas legadas e persistidas', async () => {
    const deps = makeDeps();
    const service = createQueueService({ deps });
    const controller = createQueueController({ service, deps });
    const req = makeReq();
    const res = {};

    await controller.list(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, ['Delivery', 'Sales', 'Support']);
  });

  test('controller remove desativa a definição persistida (regressão: fila reaparecia após exclusão)', async () => {
    // Regressão observada em runtime real (2026-07-27): DELETE /queues/:name
    // removia apenas o Map em memória; a definição persistida continuava ativa
    // e GET /queues (merge das duas fontes) seguia exibindo a fila excluída.
    const deps = makeDeps({
      queueDefinitionService: {
        listQueues: jest.fn(() => []),
        getQueueByName: jest.fn(() => ({ id: 'q-1', tenantId: 'tenant-1', name: 'oldq', routingStrategy: 'round_robin', priority: 5, active: true })),
        upsertQueue: jest.fn(async () => ({ success: true })),
      },
    });
    const service = createQueueService({ deps });
    const controller = createQueueController({ service, deps });
    const req = makeReq({ params: { queueName: 'oldq' }, url: '/queues/oldq' });
    const res = {};

    await controller.remove(req, res);

    expect(deps.deleteQueue).toHaveBeenCalledWith('oldq', false, { tenantId: 'tenant-1' });
    expect(deps.queueDefinitionService.upsertQueue).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1',
      name: 'oldq',
      active: false,
      routingStrategy: 'round_robin',
      priority: 5,
    }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  test('DEFEITO: legado NÃO encontra a fila mas a definição persistida é desativada (fila sai da listagem)', async () => {
    // Medido em 2026-10-14 (QA Mesh, cenário `business-core-biz-queues`): o serviço
    // legado opera num Map EM MEMÓRIA, que o reinício da API esvazia. A fila existia
    // SÓ no banco; o deleteQueue legado devolvia success=false e a desativação —
    // condicionada a `result.success` — NÃO rodava. A fila continuava `active=true` e
    // REAPARECIA na listagem (que mescla memória + banco): "Fila não foi removida: a
    // fila continua na listagem após DELETE". Foram 253 filas de teste acumuladas.
    const deps = makeDeps({
      deleteQueue: jest.fn(() => ({ success: false, message: 'Fila não encontrada' })),
      queueDefinitionService: {
        listQueues: jest.fn(() => []),
        deactivateQueue: jest.fn(async () => ({ success: true, deactivated: true })),
      },
    });
    const service = createQueueService({ deps });
    const controller = createQueueController({ service, deps });
    const req = makeReq({ params: { queueName: 'qa_flow_queue_x' }, url: '/queues/qa_flow_queue_x' });
    const res = {};

    await controller.remove(req, res);

    expect(deps.queueDefinitionService.deactivateQueue).toHaveBeenCalledWith('tenant-1', 'qa_flow_queue_x');
    // A remoção efetiva aconteceu (a fila sai da listagem): o resultado é sucesso,
    // reportar falha aqui seria mentir sobre o efeito real.
    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({ success: true }));
  });

  test('não reporta sucesso quando NADA foi removido (sem legado e sem definição persistida)', async () => {
    const deps = makeDeps({
      deleteQueue: jest.fn(() => ({ success: false, message: 'Fila não encontrada' })),
      queueDefinitionService: {
        listQueues: jest.fn(() => []),
        deactivateQueue: jest.fn(async () => ({ success: true, deactivated: false })),
      },
    });
    const service = createQueueService({ deps });
    const controller = createQueueController({ service, deps });
    const req = makeReq({ params: { queueName: 'inexistente' }, url: '/queues/inexistente' });
    const res = {};

    await controller.remove(req, res);

    expect(deps.sendJson).toHaveBeenCalledWith(res, expect.any(Number), expect.objectContaining({ success: false }));
  });

  test('controller create preserva auditoria e status 201', async () => {
    const deps = makeDeps({
      parseJsonBody: jest.fn(async () => ({ name: 'VIP' })),
      createQueue: jest.fn(() => ({ success: true, queueName: 'VIP', message: 'Fila criada' })),
    });
    const service = createQueueService({ deps });
    const controller = createQueueController({ service, deps });
    const req = makeReq();
    const res = {};

    await controller.create(req, res);

    expect(deps.logAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'queue_create', resourceId: 'VIP' }));
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, expect.objectContaining({ success: true, queueName: 'VIP' }));
  });
});
