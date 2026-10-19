'use strict';

/**
 * Regressão do defeito medido no QA Mesh `mesh-2026-10-19T17-34-30-385Z`,
 * cenário `business-core-biz-queues` (domínio crítico `core`):
 *
 *   "Fila não foi removida: a fila continua na listagem após DELETE"
 *
 * Causa: a criação gravava a definição persistida em fire-and-forget
 * (`upsertQueue(...).catch(() => {})`). O fluxo do cenário é
 * criar → listar → detalhar → tickets → DELETE, tudo em ~24 ms. O DELETE
 * chegava ANTES de o upsert concluir; `deactivateQueue` não encontrava a
 * definição (nada a desativar) e o upsert pendente gravava `active: true`
 * DEPOIS do delete — a fila "ressuscitava" na listagem.
 *
 * O contrato que este teste trava, nos dois sentidos:
 *  1. a criação SÓ responde depois que a definição foi persistida;
 *  2. falha de persistência é EXPLÍCITA (success:false) e desfaz a memória —
 *     nunca passa em silêncio (`persistence_required`).
 */

const { createQueueService } = require('../../api/modules/queue/service');
const { createQueueController } = require('../../api/modules/queue/controller');

function makeDeps(overrides = {}) {
  return {
    listQueues: jest.fn(() => []),
    createQueue: jest.fn(() => ({ success: true, queueName: 'qa_queue_1', message: 'Fila criada com sucesso' })),
    deleteQueue: jest.fn(() => ({ success: true, message: 'Fila excluída com sucesso' })),
    getQueueInfo: jest.fn(() => ({ name: 'qa_queue_1', exists: true })),
    listQueue: jest.fn(() => []),
    queueDefinitionService: {
      listQueues: jest.fn(() => []),
      upsertQueue: jest.fn(async () => ({ success: true, queue: { name: 'qa_queue_1' } })),
      deactivateQueue: jest.fn(async () => ({ success: true, deactivated: true })),
    },
    logger: { error: jest.fn() },
    ...overrides,
  };
}

describe('createQueue — persistência antes da resposta (anti-corrida com DELETE)', () => {
  test('a criação espera o upsert concluir antes de retornar', async () => {
    const eventos = [];
    const deps = makeDeps({
      queueDefinitionService: {
        listQueues: jest.fn(() => []),
        upsertQueue: jest.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          eventos.push('upsert-concluido');
          return { success: true };
        }),
      },
    });
    const service = createQueueService({ deps });

    const resultado = await service.createQueue({ tenantId: 'system' }, 'qa_queue_1');
    eventos.push('criacao-retornou');

    expect(resultado.success).toBe(true);
    // Se o upsert fosse fire-and-forget a ordem seria a inversa.
    expect(eventos).toEqual(['upsert-concluido', 'criacao-retornou']);
  });

  test('falha de persistência é explícita e desfaz a fila em memória', async () => {
    const deps = makeDeps({
      queueDefinitionService: {
        listQueues: jest.fn(() => []),
        upsertQueue: jest.fn(async () => ({ success: false, error: 'db_unavailable' })),
      },
    });
    const service = createQueueService({ deps });

    const resultado = await service.createQueue({ tenantId: 'system' }, 'qa_queue_1');

    expect(resultado.success).toBe(false);
    expect(String(resultado.message)).toContain('db_unavailable');
    expect(deps.logger.error).toHaveBeenCalledWith(
      'Erro ao persistir definição da fila',
      expect.objectContaining({ queueName: 'qa_queue_1', error: 'db_unavailable' }),
    );
    // Rollback: a listagem (memória + banco) não pode anunciar a fila.
    expect(deps.deleteQueue).toHaveBeenCalledWith('qa_queue_1', true);
  });

  test('fila que já existe continua respondendo sucesso sem rollback', async () => {
    const deps = makeDeps({
      createQueue: jest.fn(() => ({ success: true, queueName: 'qa_queue_1', message: 'Fila já existe' })),
    });
    const service = createQueueService({ deps });

    const resultado = await service.createQueue({ tenantId: 'system' }, 'qa_queue_1');

    expect(resultado.message).toBe('Fila já existe');
    expect(deps.deleteQueue).not.toHaveBeenCalled();
    expect(deps.queueDefinitionService.upsertQueue).toHaveBeenCalled();
  });

  test('controller responde 400 quando a persistência falha (nunca 201 mentindo)', async () => {
    const deps = makeDeps({
      requireAuth: jest.fn(() => ({ valid: true })),
      requirePermission: jest.fn(() => ({ allowed: true })),
      sendJson: jest.fn(),
      badRequest: jest.fn(),
      hasJsonContentType: jest.fn(() => true),
      parseJsonBody: jest.fn(async () => ({ name: 'qa_queue_1' })),
      queueDefinitionService: {
        listQueues: jest.fn(() => []),
        upsertQueue: jest.fn(async () => ({ success: false, error: 'db_unavailable' })),
      },
    });
    const controller = createQueueController({ service: createQueueService({ deps }), deps });
    const res = {};
    const req = {
      tenantId: 'system',
      url: '/queues',
      headers: { 'content-type': 'application/json', 'user-agent': 'jest' },
      socket: { remoteAddress: '127.0.0.1' },
      agent: { id: 'agent-1', username: 'systemadmin' },
      params: {},
    };

    await controller.create(req, res);

    expect(deps.sendJson).not.toHaveBeenCalled();
    expect(deps.badRequest).toHaveBeenCalledWith(res, expect.stringContaining('db_unavailable'));
  });
});
