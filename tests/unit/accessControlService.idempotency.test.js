'use strict';

/**
 * Testa o tratamento de corrida de idempotência em accessControlService.
 *
 * `ensureSubject` e `upsertMembership` usam check-then-insert: duas requests
 * concorrentes (ex.: cenário `business-f1` com POST /api/fitness/student em
 * paralelo e sufixo de segundo) podem ambas passar pelo `find*` e disparar
 * `create*` com o mesmo ID, gerando SequelizeUniqueConstraintError (23505).
 * O serviço deve capturar a violação e retornar o registro já persistido.
 */

const mockFindSubject = jest.fn();
const mockCreateSubject = jest.fn();
const mockFindMembership = jest.fn();
const mockCreateMembership = jest.fn();
const mockEmitEvent = jest.fn();

jest.mock('../../api/modules/access-control/accessControlRepository', () => ({
  findSubject: (...args) => mockFindSubject(...args),
  createSubject: (...args) => mockCreateSubject(...args),
  findMembership: (...args) => mockFindMembership(...args),
  createMembership: (...args) => mockCreateMembership(...args),
}));

jest.mock('../../api/services/websocketService', () => ({
  emitEvent: (...args) => mockEmitEvent(...args),
}));

const accessControlService = require('../../api/modules/access-control/accessControlService');

function makeUniqueError() {
  const err = new Error('duplicate key');
  err.name = 'SequelizeUniqueConstraintError';
  err.original = { code: '23505' };
  err.parent = { code: '23505' };
  return err;
}

describe('accessControlService — corrida de idempotência', () => {
  beforeEach(() => {
    // `resetMocks: true` no jest.config.cjs apaga implementações de escopo de
    // módulo antes de cada teste; restaura os comportamentos base aqui.
    mockFindSubject.mockResolvedValue(null);
    mockCreateSubject.mockReset();
    mockFindMembership.mockResolvedValue(null);
    mockCreateMembership.mockReset();
    mockEmitEvent.mockReset();
  });

  test('upsertMembership captura violação de unicidade e retorna a membership existente', async () => {
    const racedRow = {
      id: 'qa-fitness-membership-x',
      tenant_key: 'system',
      subject_id: 's1',
      vertical: 'fitness',
      status: 'active',
    };

    mockCreateMembership.mockRejectedValueOnce(makeUniqueError());
    // findMembership: pré-insert (null) + re-fetch dentro do catch (existente).
    mockFindMembership
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(racedRow);

    const result = await accessControlService.upsertMembership({
      tenantId: 'system',
      subjectId: 's1',
      membershipId: 'qa-fitness-membership-x',
      vertical: 'fitness',
    });

    expect(result.id).toBe('qa-fitness-membership-x');
    expect(mockCreateMembership).toHaveBeenCalledTimes(1);
    expect(mockFindMembership).toHaveBeenCalledTimes(2);
    // O broadcast de criação só ocorre em criação real, não no caminho de corrida.
    expect(mockEmitEvent).not.toHaveBeenCalled();
  });

  test('upsertMembership propaga erro não-único sem mascarar', async () => {
    mockCreateMembership.mockRejectedValueOnce(new Error('db_down'));

    await expect(accessControlService.upsertMembership({
      tenantId: 'system',
      subjectId: 's1',
      membershipId: 'qa-fitness-membership-x',
    })).rejects.toThrow('db_down');
  });

  test('ensureSubject captura violação de unicidade e retorna o subject existente', async () => {
    const racedSubject = {
      id: 'qa-fitness-student-x',
      tenant_key: 'system',
      customer_id: null,
      status: 'active',
    };

    mockCreateSubject.mockRejectedValueOnce(makeUniqueError());
    // findSubject: pré-insert (null) + re-fetch dentro do catch (existente).
    mockFindSubject
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(racedSubject);

    const result = await accessControlService.ensureSubject({
      tenantId: 'system',
      subjectId: 'qa-fitness-student-x',
    });

    expect(result.id).toBe('qa-fitness-student-x');
    expect(mockCreateSubject).toHaveBeenCalledTimes(1);
    expect(mockFindSubject).toHaveBeenCalledTimes(2);
  });

  test('ensureSubject propaga erro não-único sem mascarar', async () => {
    mockCreateSubject.mockRejectedValueOnce(new Error('db_down'));

    await expect(accessControlService.ensureSubject({
      tenantId: 'system',
      subjectId: 'qa-fitness-student-x',
    })).rejects.toThrow('db_down');
  });
});
