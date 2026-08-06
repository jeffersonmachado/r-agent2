/**
 * Testes das queries filtradas do persistenceServices.
 *
 * Cobre:
 * - getFlow usa findByPk (sem varrer a tabela inteira por chamada de nó).
 * - getQueueTickets aplica filtro de fila/status no SQL.
 * - getQueueInfo faz UMA única query filtrada (sem varreduras extras da
 *   tabela de tickets por execução), preservando o formato de retorno.
 */

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: jest.fn(() => ({})),
}));

jest.mock('../../api/db/models', () => ({
  Flow: jest.fn(),
  Ticket: jest.fn(),
}));

jest.mock('../../api/utils/config', () => ({
  getAll: jest.fn(() => ({})),
  get: jest.fn((_path, fallback) => fallback),
}));

const { getSequelize } = require('../../api/db/sequelize');
const { Flow, Ticket } = require('../../api/db/models');
const {
  getFlow,
  getQueueTickets,
  getQueueInfo,
} = require('../../engine/services/persistenceServices');

function makeFlowRow(overrides = {}) {
  return {
    id: 'flow-1',
    tenant_key: 'tenant-1',
    name: 'Flow Um',
    data: { nodes: [{ id: 'start-1', type: 'start' }] },
    ...overrides,
  };
}

function makeTicketRow(overrides = {}) {
  return {
    id: 'ticket-1',
    tenant_key: 'tenant-1',
    session_id: 'sess-1',
    queue: 'suporte',
    status: 'open',
    assigned_to: null,
    phone_number: null,
    last_user_message: null,
    unread_count: 0,
    tags: [],
    category: null,
    messages: [],
    context: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('persistenceServices - queries filtradas', () => {
  let flowModel;
  let ticketModel;

  beforeEach(() => {
    // resetMocks:true — re-estabelecer implementações a cada teste
    getSequelize.mockReturnValue({});
    flowModel = {
      findByPk: jest.fn(),
      findAll: jest.fn(),
    };
    ticketModel = {
      findAll: jest.fn(),
    };
    Flow.mockReturnValue(flowModel);
    Ticket.mockReturnValue(ticketModel);
  });

  test('getFlow usa findByPk e NÃO faz findAll da tabela inteira', async () => {
    flowModel.findByPk.mockResolvedValue(makeFlowRow());

    const flow = await getFlow('flow-1');

    expect(flowModel.findByPk).toHaveBeenCalledTimes(1);
    expect(flowModel.findByPk).toHaveBeenCalledWith('flow-1');
    expect(flowModel.findAll).not.toHaveBeenCalled();
    // Formato de retorno preservado (data espalhado + id/tenantId/name)
    expect(flow).toMatchObject({
      id: 'flow-1',
      tenantId: 'tenant-1',
      name: 'Flow Um',
    });
    expect(flow.nodes).toHaveLength(1);
  });

  test('getFlow retorna null quando o fluxo não existe', async () => {
    flowModel.findByPk.mockResolvedValue(null);

    await expect(getFlow('inexistente')).resolves.toBeNull();
    expect(flowModel.findAll).not.toHaveBeenCalled();
  });

  test('getQueueTickets filtra por fila (e status) no SQL', async () => {
    ticketModel.findAll.mockResolvedValue([makeTicketRow()]);

    const tickets = await getQueueTickets('suporte', { status: 'open' });

    expect(ticketModel.findAll).toHaveBeenCalledTimes(1);
    expect(ticketModel.findAll).toHaveBeenCalledWith({
      where: { queue: 'suporte', status: 'open' },
    });
    // Formato de retorno preservado
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      id: 'ticket-1',
      tenantId: 'tenant-1',
      sessionId: 'sess-1',
      queue: 'suporte',
      status: 'open',
    });
  });

  test('getQueueTickets sem status filtra apenas pela fila', async () => {
    ticketModel.findAll.mockResolvedValue([]);

    await getQueueTickets('suporte');

    expect(ticketModel.findAll).toHaveBeenCalledWith({
      where: { queue: 'suporte' },
    });
  });

  test('getQueueInfo faz UMA única query filtrada e agrega em memória', async () => {
    ticketModel.findAll.mockResolvedValue([
      makeTicketRow({ id: 't1', status: 'open' }),
      makeTicketRow({ id: 't2', status: 'pending' }),
      makeTicketRow({ id: 't3', status: 'closed' }),
    ]);

    const info = await getQueueInfo('suporte');

    // Antes: getQueueTickets + getQueuesData = 2+ varreduras completas da tabela
    expect(ticketModel.findAll).toHaveBeenCalledTimes(1);
    expect(ticketModel.findAll).toHaveBeenCalledWith({
      where: { queue: 'suporte' },
    });
    expect(info).toEqual({
      exists: true,
      ticketCount: 3,
      activeTickets: 2,
      closedTickets: 1,
    });
  });

  test('getQueueInfo em fila vazia retorna exists=false sem queries extras', async () => {
    ticketModel.findAll.mockResolvedValue([]);

    const info = await getQueueInfo('fantasma');

    expect(ticketModel.findAll).toHaveBeenCalledTimes(1);
    expect(info).toEqual({
      exists: false,
      ticketCount: 0,
      activeTickets: 0,
      closedTickets: 0,
    });
  });
});
