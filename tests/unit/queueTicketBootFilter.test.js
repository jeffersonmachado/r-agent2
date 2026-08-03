'use strict';

const { Op } = require('sequelize');

describe('queueTicketPersistenceRuntime - boot com filtro de retenção', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('boot carrega apenas tickets ativos ou fechados dentro da janela de 7 dias', async () => {
    const findAll = jest.fn().mockResolvedValue([
      { id: 'ticket-active', status: 'waiting' },
      { id: 'ticket-closed-recent', status: 'closed' },
    ]);

    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => ({ constructor: { Op } }),
    }));
    jest.doMock('../../api/db/models', () => ({
      Ticket: () => ({ findAll }),
    }));

    const { initializeRuntimeCache } = require('../../api/services/queue/queueTicketPersistenceRuntime');

    const tickets = new Map();
    const queues = new Map();
    const addTicketToQueueIndex = jest.fn();

    await initializeRuntimeCache({
      tickets,
      queues,
      fromDbRow: (row) => ({ id: row.id, status: row.status, queue: 'default' }),
      addTicketToQueueIndex,
    });

    expect(findAll).toHaveBeenCalledTimes(1);
    const query = findAll.mock.calls[0][0];
    expect(query).toHaveProperty('where');
    expect(Array.isArray(query.where[Op.or])).toBe(true);
    expect(query.where[Op.or]).toHaveLength(2);
    // Tickets ativos (status != closed)
    expect(query.where[Op.or][0]).toEqual({ status: { [Op.ne]: 'closed' } });
    // Fechados recentes (dentro da janela de retenção de 7 dias)
    const closedClause = query.where[Op.or][1];
    expect(closedClause.status).toBe('closed');
    const cutoff = closedClause.updated_at[Op.gte];
    expect(cutoff).toBeInstanceOf(Date);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs((Date.now() - cutoff.getTime()) - sevenDaysMs)).toBeLessThan(5000);

    expect(tickets.size).toBe(2);
    expect(tickets.has('ticket-active')).toBe(true);
    expect(tickets.has('ticket-closed-recent')).toBe(true);
    expect(addTicketToQueueIndex).toHaveBeenCalledTimes(2);
  });

  test('boot sem banco disponível não executa query', async () => {
    jest.doMock('../../api/db/sequelize', () => ({
      getSequelize: () => null,
    }));
    jest.doMock('../../api/db/models', () => ({
      Ticket: () => ({ findAll: jest.fn() }),
    }));

    const { initializeRuntimeCache } = require('../../api/services/queue/queueTicketPersistenceRuntime');

    const tickets = new Map([['x', { id: 'x' }]]);
    await initializeRuntimeCache({
      tickets,
      queues: new Map(),
      fromDbRow: (r) => r,
      addTicketToQueueIndex: jest.fn(),
    });

    // Sem DB: cache local preservado, nenhuma query executada
    expect(tickets.has('x')).toBe(true);
  });
});
