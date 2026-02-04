/**
 * Testes unitários do PhysicalQueueService (Filas físicas v1)
 */

describe('physicalQueueService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('createTicket cria senha (status waiting) e cria fila default quando não existe', async () => {
    const queueFindOne = jest.fn(async () => null);
    const queueCreate = jest.fn(async (payload) => ({ id: payload.id }));

    const ticketCreate = jest.fn(async (payload) => ({
      toJSON: () => payload,
    }));

    jest.doMock('../../api/db/models', () => ({
      PhysicalQueue: () => ({ findOne: queueFindOne, create: queueCreate }),
      PhysicalTicket: () => ({ create: ticketCreate }),
      PhysicalTicketSequence: () => ({ sequelize: null }),
    }));

    // eslint-disable-next-line global-require
    const { createTicket } = require('../../api/services/physicalQueueService');

    const t = await createTicket({ tenantId: 'tenant-1', locationId: 'loja-1' });
    expect(t.tenant_key).toBe('tenant-1');
    expect(t.status).toBe('waiting');
    expect(String(t.ticket_number)).toHaveLength(3);
    expect(queueCreate).toHaveBeenCalledTimes(1); // fila default "Geral"
    expect(ticketCreate).toHaveBeenCalledTimes(1);
  });

  test('getPanelState retorna waiting + lastCalled', async () => {
    const queueFindAll = jest.fn(async () => ([
      { id: 'pq-1', toJSON: () => ({ id: 'pq-1' }) },
    ]));
    const ticketFindAll = jest.fn(async () => ([
      { id: 'pt-1', toJSON: () => ({ id: 'pt-1', ticket_number: '001', status: 'waiting' }) },
    ]));
    const ticketFindOne = jest.fn(async () => ({ id: 'pt-last', toJSON: () => ({ id: 'pt-last', ticket_number: '999', status: 'called' }) }));

    jest.doMock('../../api/db/models', () => ({
      PhysicalQueue: () => ({ findAll: queueFindAll }),
      PhysicalTicket: () => ({ findAll: ticketFindAll, findOne: ticketFindOne }),
      PhysicalTicketSequence: () => ({ sequelize: null }),
    }));

    // eslint-disable-next-line global-require
    const { getPanelState } = require('../../api/services/physicalQueueService');

    const state = await getPanelState({ tenantId: 'tenant-1', locationId: 'loja-1' });
    expect(state.queues).toHaveLength(1);
    expect(state.waiting).toHaveLength(1);
    expect(state.lastCalled).toMatchObject({ status: 'called' });
  });

  test('callNext atualiza o próximo para called e preenche station_id', async () => {
    const queueFindAll = jest.fn(async () => ([
      { id: 'pq-1', toJSON: () => ({ id: 'pq-1' }) },
    ]));
    const ticketFindAll = jest.fn(async () => ([
      { id: 'pt-1', toJSON: () => ({ id: 'pt-1', ticket_number: '001', status: 'waiting' }) },
    ]));
    const ticketFindOnePanel = jest.fn(async () => null); // lastCalled
    const row = {
      id: 'pt-1',
      update: jest.fn(async (patch) => {
        row.status = patch.status;
        row.station_id = patch.station_id;
      }),
      toJSON: () => ({ id: row.id, status: row.status, station_id: row.station_id }),
    };
    const ticketFindOne = jest.fn(async () => row);

    jest.doMock('../../api/db/models', () => ({
      PhysicalQueue: () => ({ findAll: queueFindAll }),
      PhysicalTicket: () => ({
        findAll: ticketFindAll,
        findOne: (args) => {
          // distingue chamada do lastCalled vs fetch por id
          if (args && args.where && args.where.status === 'called') return ticketFindOnePanel(args);
          return ticketFindOne(args);
        },
      }),
      PhysicalTicketSequence: () => ({ sequelize: null }),
    }));

    // eslint-disable-next-line global-require
    const { callNext } = require('../../api/services/physicalQueueService');

    const t = await callNext({ tenantId: 'tenant-1', locationId: 'loja-1', stationId: 'A1' });
    expect(t).toMatchObject({ status: 'called', station_id: 'A1' });
    expect(row.update).toHaveBeenCalled();
  });

  test('finishTicket marca como done e lança 404 quando ticket não existe', async () => {
    const row = {
      id: 'pt-1',
      update: jest.fn(async (patch) => {
        row.status = patch.status;
      }),
      toJSON: () => ({ id: row.id, status: row.status }),
    };
    const findOne = jest.fn(async ({ where }) => (where.id === 'pt-1' ? row : null));

    jest.doMock('../../api/db/models', () => ({
      PhysicalTicket: () => ({ findOne }),
      PhysicalTicketSequence: () => ({ sequelize: null }),
    }));

    // eslint-disable-next-line global-require
    const { finishTicket } = require('../../api/services/physicalQueueService');

    const done = await finishTicket({ tenantId: 'tenant-1', ticketId: 'pt-1' });
    expect(done.status).toBe('done');

    await expect(finishTicket({ tenantId: 'tenant-1', ticketId: 'pt-missing' }))
      .rejects
      .toMatchObject({ code: 'physical_ticket_not_found' });
  });
});

