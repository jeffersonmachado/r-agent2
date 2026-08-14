'use strict';

/**
 * Regressão da corrida de idempotência em webhookService.upsertWebhookToDb.
 *
 * Dois persists concorrentes do mesmo webhook passam pelo findByPk e o 2º
 * INSERT colide com a PK (23505). O serviço deve tratar como upsert:
 * re-fetch + update do registro já persistido.
 */

const mockFindByPk = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockGetSequelize = jest.fn(() => ({}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: () => mockGetSequelize(),
}));

jest.mock('../../api/db/models', () => ({
  Webhook: () => ({
    findByPk: (...args) => mockFindByPk(...args),
    create: (...args) => mockCreate(...args),
  }),
}));

const { upsertWebhookToDb } = require('../../api/services/webhookService');

function makeUniqueError() {
  const err = new Error('duplicate key');
  err.name = 'SequelizeUniqueConstraintError';
  err.original = { code: '23505' };
  err.parent = { code: '23505' };
  return err;
}

describe('webhookService.upsertWebhookToDb — corrida de idempotência', () => {
  beforeEach(() => {
    // `resetMocks: true` apaga implementações; restaura aqui.
    mockFindByPk.mockReset();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockGetSequelize.mockImplementation(() => ({}));
    mockUpdate.mockResolvedValue(undefined);
  });

  const webhook = {
    id: 'wh-1',
    tenantId: 'system',
    url: 'https://exemplo.com/hook',
    events: ['event_ledger.login'],
    secret: 's3cret',
    active: true,
  };

  test('captura violação de PK e faz update do registro existente (raced)', async () => {
    const racedRow = { id: 'wh-1', update: mockUpdate };

    mockFindByPk
      .mockResolvedValueOnce(null)      // pré-insert
      .mockResolvedValueOnce(racedRow); // re-fetch no catch
    mockCreate.mockRejectedValueOnce(makeUniqueError());

    await expect(upsertWebhookToDb(webhook)).resolves.toBeUndefined();

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockFindByPk).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('propaga erro não-único sem mascarar', async () => {
    mockFindByPk.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(new Error('db_down'));

    await expect(upsertWebhookToDb(webhook)).rejects.toThrow('db_down');
    expect(mockFindByPk).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('quando já existe, apenas atualiza (sem create)', async () => {
    const existing = { id: 'wh-1', update: mockUpdate };
    mockFindByPk.mockResolvedValueOnce(existing);

    await upsertWebhookToDb(webhook);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
