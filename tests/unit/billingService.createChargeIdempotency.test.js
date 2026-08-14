'use strict';

/**
 * Testa o tratamento de corrida de idempotência em billingService.createCharge.
 *
 * Quando dois requests concorrentes tentam criar a mesma cobrança (mesmo
 * idempotency_key), o findOne inicial retorna null para ambos e o segundo
 * `Tx.create` lança SequelizeUniqueConstraintError (23505). O serviço deve
 * capturar a violação e retornar a transação já persistida como idempotente,
 * em vez de propagar o erro.
 */

const mockFindOne = jest.fn();
const mockCreate = jest.fn();
const mockGetSequelize = jest.fn(() => ({}));

jest.mock('../../api/db/sequelize', () => ({
  getSequelize: (...args) => mockGetSequelize(...args),
}));

jest.mock('../../api/db/models', () => ({
  BillingTransaction: () => ({
    findOne: (...args) => mockFindOne(...args),
    create: (...args) => mockCreate(...args),
  }),
  BillingSubscription: () => ({ create: jest.fn(), findOne: jest.fn() }),
  VerticalSessionBundle: () => ({ findOne: jest.fn() }),
}));

const mockNormalizeProvider = jest.fn((p) => p || 'sandbox');
const mockCreateCustomer = jest.fn(async () => ({ id: 'cust-1' }));
const mockCreateSingleCharge = jest.fn(async () => ({
  transactionId: 'ext-1',
  status: 'pending',
  paymentUrl: 'https://sandbox.local/pay/ext-1',
  raw: {},
}));

jest.mock('../../api/integrations/paymentProvider', () => ({
  normalizeProvider: (...args) => mockNormalizeProvider(...args),
  createCustomer: (...args) => mockCreateCustomer(...args),
  createSingleCharge: (...args) => mockCreateSingleCharge(...args),
}));

jest.mock('../../api/services/vertical/billingOrchestrationService', () => ({
  updateBillingStatus: jest.fn(async () => ({})),
  reactivateMembership: jest.fn(async () => ({})),
  blockMembership: jest.fn(async () => ({})),
}));

jest.mock('../../api/services/notificationService', () => ({
  enqueueNotification: jest.fn(async () => ({})),
}));

const { createCharge } = require('../../api/services/billingService');

function makeUniqueError() {
  const err = new Error('duplicate key');
  err.name = 'SequelizeUniqueConstraintError';
  err.original = { code: '23505' };
  err.parent = { code: '23505' };
  return err;
}

describe('billingService.createCharge — corrida de idempotência', () => {
  beforeEach(() => {
    // `resetMocks: true` no jest.config.cjs apaga implementações de escopo de
    // módulo antes de cada teste; reestabelece aqui as necessárias.
    mockGetSequelize.mockImplementation(() => ({}));
    mockNormalizeProvider.mockImplementation((p) => p || 'sandbox');
    mockCreateCustomer.mockImplementation(async () => ({ id: 'cust-1' }));
    mockCreateSingleCharge.mockImplementation(async () => ({
      transactionId: 'ext-1',
      status: 'pending',
      paymentUrl: 'https://sandbox.local/pay/ext-1',
      raw: {},
    }));
    mockFindOne.mockReset();
    mockCreate.mockReset();
  });

  test('captura SequelizeUniqueConstraintError e retorna transação existente como idempotente', async () => {
    const existingRow = {
      id: 'bt-existing',
      tenant_key: 'system',
      status: 'pending',
      toJSON() { return this; },
    };

    // Primeiro findOne (pré-insert): nada existe.
    mockFindOne.mockResolvedValueOnce(null);
    // Insert concorrente: violação de unicidade.
    mockCreate.mockRejectedValueOnce(makeUniqueError());
    // Re-fetch dentro do catch: retorna a transação persistida pelo concorrente.
    mockFindOne.mockResolvedValueOnce({ toJSON: () => existingRow });

    const result = await createCharge({
      tenantId: 'system',
      vertical: 'beauty',
      type: 'one_time',
      amount: 79,
      currency: 'BRL',
      provider: 'sandbox',
      idempotencyKey: 'business-qa:FOOD-FLOW-ORDER-PAYMENT:charge',
    });

    expect(result.idempotent).toBe(true);
    expect(result.transaction.id).toBe('bt-existing');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // O re-fetch usa o mesmo tenant + idempotency_key.
    expect(mockFindOne).toHaveBeenCalledTimes(2);
    expect(mockFindOne.mock.calls[1][0]).toMatchObject({
      where: { tenant_key: 'system', idempotency_key: 'business-qa:FOOD-FLOW-ORDER-PAYMENT:charge' },
    });
  });

  test('propaga erro não-único sem mascarar', async () => {
    mockFindOne.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(new Error('db_down'));

    await expect(createCharge({
      tenantId: 'system',
      vertical: 'beauty',
      type: 'one_time',
      amount: 79,
      provider: 'sandbox',
      idempotencyKey: 'k',
    })).rejects.toThrow('db_down');
  });
});
