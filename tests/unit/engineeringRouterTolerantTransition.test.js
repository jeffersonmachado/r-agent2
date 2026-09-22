'use strict';

/**
 * ER-V1-FINAL-005 — Durable Resume (unidade: tolerantTransition).
 *
 * RED reproduzido (achado real): `transitionTask(taskId, X).catch(() => {})` aparecia em 3
 * pontos do loop real (CODING/TESTING/REVIEWING), com o comentário "já pode estar em CODING
 * numa retomada — não é fatal". O `.catch` engolia QUALQUER erro de transitionTask — não só o
 * caso legítimo de retomada (task já exatamente no estado de destino), mas também: task já
 * TERMINAL por outro caminho (cancelamento concorrente, outro runner concluiu), task removida
 * do banco (`not_found`), erro real de conexão. O loop continuava operando sobre uma task cujo
 * estado real já não fazia sentido, sem nenhum sinal do que aconteceu.
 *
 * Este teste isola `tolerantTransition` com mocks do `engineeringTaskService` — determinístico,
 * sem banco real, cobrindo as 4 decisões possíveis da função.
 */

jest.mock('../../api/services/engineeringRouter/engineeringTaskService', () => ({
  transitionTask: jest.fn(),
  getTask: jest.fn(),
}));

const engineeringTaskService = require('../../api/services/engineeringRouter/engineeringTaskService');
const { tolerantTransition } = require('../../api/services/engineeringRouter/engineeringRouterService');
const { FAILURE_CODES } = require('../../engine/engineeringRouter/constants');

function invalidTransitionError() {
  const err = new Error('Transição de estado inválida');
  err.code = FAILURE_CODES.INVALID_STATE_TRANSITION;
  return err;
}

describe('ER-V1-FINAL-005 — tolerantTransition', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('transição bem-sucedida: retorna direto, nunca consulta getTask', async () => {
    engineeringTaskService.transitionTask.mockResolvedValue({ id: 't1', status: 'CODING' });
    const result = await tolerantTransition('t1', 'CODING');
    expect(result).toEqual({ id: 't1', status: 'CODING' });
    expect(engineeringTaskService.getTask).not.toHaveBeenCalled();
  });

  test('retomada real: transição falha mas o estado ATUAL já é exatamente o destino → tolera e retorna o estado real', async () => {
    engineeringTaskService.transitionTask.mockRejectedValue(invalidTransitionError());
    engineeringTaskService.getTask.mockResolvedValue({ id: 't1', status: 'CODING' });
    const result = await tolerantTransition('t1', 'CODING');
    expect(result).toEqual({ id: 't1', status: 'CODING' });
  });

  test('task já em estado TERMINAL diferente do destino (cancelamento concorrente) → lança TASK_ALREADY_TERMINAL_DURING_RESUME com o status real', async () => {
    engineeringTaskService.transitionTask.mockRejectedValue(invalidTransitionError());
    engineeringTaskService.getTask.mockResolvedValue({ id: 't1', status: 'CANCELLED' });
    await expect(tolerantTransition('t1', 'CODING')).rejects.toMatchObject({
      code: 'TASK_ALREADY_TERMINAL_DURING_RESUME',
      currentStatus: 'CANCELLED',
    });
  });

  test('task já em GREEN (terminou por outro runner) durante tentativa de retomada para TESTING → lança TASK_ALREADY_TERMINAL_DURING_RESUME', async () => {
    engineeringTaskService.transitionTask.mockRejectedValue(invalidTransitionError());
    engineeringTaskService.getTask.mockResolvedValue({ id: 't1', status: 'GREEN' });
    await expect(tolerantTransition('t1', 'TESTING')).rejects.toMatchObject({
      code: 'TASK_ALREADY_TERMINAL_DURING_RESUME',
      currentStatus: 'GREEN',
    });
  });

  test('estado real diferente do destino e NÃO terminal (cenário não coberto por retomada conhecida) → propaga o erro original, nunca mascara', async () => {
    const original = invalidTransitionError();
    engineeringTaskService.transitionTask.mockRejectedValue(original);
    engineeringTaskService.getTask.mockResolvedValue({ id: 't1', status: 'ROUTED' });
    await expect(tolerantTransition('t1', 'REVIEWING')).rejects.toBe(original);
  });

  test('task sumiu do banco (not_found) durante a retomada → propaga o erro original, nunca mascara', async () => {
    const original = invalidTransitionError();
    engineeringTaskService.transitionTask.mockRejectedValue(original);
    engineeringTaskService.getTask.mockResolvedValue(null);
    await expect(tolerantTransition('t1', 'CODING')).rejects.toBe(original);
  });

  test('erro que NÃO é INVALID_STATE_TRANSITION (ex.: erro real de conexão) → sempre propaga, nunca consulta getTask nem tolera', async () => {
    const dbError = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    engineeringTaskService.transitionTask.mockRejectedValue(dbError);
    await expect(tolerantTransition('t1', 'CODING')).rejects.toBe(dbError);
    expect(engineeringTaskService.getTask).not.toHaveBeenCalled();
  });
});
