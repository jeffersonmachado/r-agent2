'use strict';

/**
 * Testa o tratamento de corrida de idempotência na persistência de ticket.
 *
 * `createTicket` e `autoAssignTicket` disparam `persistTicketBestEffort` de
 * forma concorrente para o mesmo ticket. Ambos passam pelo `findByPk` (nulo) e
 * o segundo INSERT colide com `tickets_pkey` (SequelizeUniqueConstraintError /
 * 23505). `upsertTicketToDb` deve tratar a violação como upsert: re-fetch e
 * update do registro já persistido, em vez de logar falha/abortar.
 */

const mockFindByPk = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => ({}),
}));

jest.mock('../../api/db/models', () => ({
  Ticket: () => ({
    findByPk: (...args) => mockFindByPk(...args),
    create: (...args) => mockCreate(...args),
  }),
}));

const { upsertTicketToDb } = require('../../api/services/queue/queueTicketPersistenceRuntime');

function makeUniqueError() {
  const err = new Error('duplicate key');
  err.name = 'SequelizeUniqueConstraintError';
  err.original = { code: '23505', detail: 'Key (id) already exists.', constraint: 'tickets_pkey' };
  err.parent = { code: '23505' };
  return err;
}

const samplePayload = {
  id: 'default-1-abc',
  tenant_key: 'system',
  session_id: 'whatsapp_5511999990000',
  queue: 'default',
  status: 'waiting',
};

describe('queueTicketPersistenceRuntime.upsertTicketToDb — corrida de idempotência', () => {
  beforeEach(() => {
    // `resetMocks: true` apaga implementações de escopo de módulo; restaura aqui.
    mockFindByPk.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockUpdate.mockResolvedValue(undefined);
  });

  test('captura violação de PK e faz update do registro existente (raced)', async () => {
    const racedRow = { id: 'default-1-abc', update: mockUpdate };

    mockFindByPk
      .mockResolvedValueOnce(null)      // pré-insert
      .mockResolvedValueOnce(racedRow); // re-fetch dentro do catch
    mockCreate.mockRejectedValueOnce(makeUniqueError());

    await expect(upsertTicketToDb({ id: 'default-1-abc' }, () => samplePayload)).resolves.toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockFindByPk).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('propaga erro não-único sem mascarar', async () => {
    mockFindByPk.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(new Error('db_down'));

    await expect(upsertTicketToDb({ id: 'default-2-xyz' }, () => samplePayload)).rejects.toThrow('db_down');
    expect(mockFindByPk).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('quando o ticket já existe, apenas atualiza (sem create)', async () => {
    const existing = { id: 'default-3-xyz', update: mockUpdate };
    mockFindByPk.mockResolvedValueOnce(existing);

    await upsertTicketToDb({ id: 'default-3-xyz' }, () => samplePayload);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
