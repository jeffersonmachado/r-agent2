'use strict';

/**
 * Contrato do núcleo puro de LRO (`api/services/lro/lroStateMachine.js`).
 *
 * Regras que este arquivo fixa (mandato LRO §4, §5, §10):
 *  - só as transições declaradas são legais; o resto é recusado com código;
 *  - estado terminal é IMUTÁVEL (mudança só por reconciliação explícita e auditada);
 *  - `COMPLETED` NÃO implica GO: o desfecho é campo separado e obrigatório;
 *  - progresso sem total conhecido é INDETERMINADO — nunca 100% presumido;
 *  - `WAITING_FEEDBACK` só existe com solicitação de decisão identificada;
 *  - classe de visibilidade é validada (PRODUCTION/SUPPORT/DEVELOPMENT).
 *
 * TDD: este contrato nasce antes da implementação.
 */

const {
  STATES,
  TERMINAL_STATES,
  canTransition,
  evaluateTransition,
  normalizeProgress,
  VALID_VISIBILITY_CLASSES,
  CODES,
} = require('../lroStateMachine');

describe('LRO — máquina de estados (puro)', () => {
  test('estados terminais são exatamente os quatro do contrato', () => {
    expect([...TERMINAL_STATES].sort()).toEqual(
      [STATES.COMPLETED, STATES.FAILED, STATES.CANCELLED, STATES.TIMED_OUT].sort(),
    );
  });

  test('transições legais do caminho feliz', () => {
    expect(canTransition(STATES.CREATED, STATES.QUEUED)).toBe(true);
    expect(canTransition(STATES.QUEUED, STATES.RUNNING)).toBe(true);
    expect(canTransition(STATES.RUNNING, STATES.WAITING_FEEDBACK)).toBe(true);
    expect(canTransition(STATES.WAITING_FEEDBACK, STATES.RUNNING)).toBe(true);
    expect(canTransition(STATES.RUNNING, STATES.COMPLETED)).toBe(true);
    expect(canTransition(STATES.RUNNING, STATES.PAUSED)).toBe(true);
    expect(canTransition(STATES.PAUSED, STATES.RUNNING)).toBe(true);
  });

  test('transições ilegais são recusadas com código', () => {
    expect(canTransition(STATES.CREATED, STATES.COMPLETED)).toBe(false);
    expect(canTransition(STATES.CREATED, STATES.RUNNING)).toBe(false);

    const r = evaluateTransition({ from: STATES.CREATED, to: STATES.RUNNING });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CODES.TRANSICAO_INVALIDA);
  });

  test('estado terminal é imutável — sem reconciliação explícita', () => {
    const r = evaluateTransition({
      from: STATES.COMPLETED,
      to: STATES.RUNNING,
      operation: { status: STATES.COMPLETED },
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CODES.TERMINAL_IMUTAVEL);

    const reconciliado = evaluateTransition({
      from: STATES.COMPLETED,
      to: STATES.RUNNING,
      operation: { status: STATES.COMPLETED },
      context: { reconciliation: { reason: 'reprocessamento autorizado', fence: 3 }, currentFence: 3 },
    });
    expect(reconciliado.ok).toBe(true);
    expect(reconciliado.reconciliation).toBe(true);
  });

  test('reconciliação sem motivo, ou com fence vencido, é recusada', () => {
    const semMotivo = evaluateTransition({
      from: STATES.FAILED, to: STATES.RUNNING,
      context: { reconciliation: { fence: 2 } }, currentFence: 2,
    });
    expect(semMotivo.ok).toBe(false);
    expect(semMotivo.code).toBe(CODES.RECONCILIACAO_SEM_MOTIVO);

    const fenceVelho = evaluateTransition({
      from: STATES.FAILED, to: STATES.RUNNING,
      context: { reconciliation: { reason: 'x', fence: 1 } }, currentFence: 2,
    });
    expect(fenceVelho.ok).toBe(false);
    expect(fenceVelho.code).toBe(CODES.RECONCILIACAO_FENCE_INVALIDO);
  });

  test('COMPLETED não implica GO: desfecho é obrigatório e separado do status', () => {
    const semDesfecho = evaluateTransition({ from: STATES.RUNNING, to: STATES.COMPLETED });
    expect(semDesfecho.ok).toBe(false);
    expect(semDesfecho.code).toBe(CODES.DESFECHO_AUSENTE);

    const noGo = evaluateTransition({
      from: STATES.RUNNING, to: STATES.COMPLETED, context: { outcome: 'NO_GO' },
    });
    expect(noGo.ok).toBe(true);
    expect(noGo.patch.status).toBe(STATES.COMPLETED);
    expect(noGo.patch.outcome).toBe('NO_GO');
    expect(noGo.warnings).toContain(CODES.COMPLETED_NAO_E_GO);

    const desfechoInvalido = evaluateTransition({
      from: STATES.RUNNING, to: STATES.COMPLETED, context: { outcome: 'GO_PARCIAL' },
    });
    expect(desfechoInvalido.ok).toBe(false);
    expect(desfechoInvalido.code).toBe(CODES.DESFECHO_INVALIDO);
  });

  test('WAITING_FEEDBACK exige solicitação de decisão identificada', () => {
    const sem = evaluateTransition({ from: STATES.RUNNING, to: STATES.WAITING_FEEDBACK });
    expect(sem.ok).toBe(false);
    expect(sem.code).toBe(CODES.FEEDBACK_SEM_SOLICITACAO);

    const com = evaluateTransition({
      from: STATES.RUNNING, to: STATES.WAITING_FEEDBACK, context: { feedbackRequestId: 'f1' },
    });
    expect(com.ok).toBe(true);
    expect(com.patch.feedback_request_id).toBe('f1');
  });

  test('progresso sem total é INDETERMINADO — nunca 100%', () => {
    expect(normalizeProgress({ current: 3, total: null, unit: 'scenario' })).toMatchObject({
      current: 3, total: null, percent: null, indeterminate: true,
    });
    expect(normalizeProgress({ current: 0, total: 0 })).toMatchObject({ indeterminate: true, percent: null });
    const certo = normalizeProgress({ current: 5, total: 10, unit: 'scenario' });
    expect(certo).toMatchObject({ current: 5, total: 10, percent: 50, indeterminate: false });
    // corrente acima do total não pode virar >100% silencioso
    expect(normalizeProgress({ current: 12, total: 10 }).percent).toBe(100);
  });

  test('classe de visibilidade é validada', () => {
    expect(VALID_VISIBILITY_CLASSES).toEqual(['PRODUCTION', 'SUPPORT', 'DEVELOPMENT']);
    const r = evaluateTransition({
      from: STATES.CREATED, to: STATES.QUEUED, context: { visibilityClass: 'PUBLIC' },
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CODES.VISIBILIDADE_INVALIDA);
  });

  test('estado desconhecido é recusado (nunca tratado como aberto silencioso)', () => {
    const r = evaluateTransition({ from: 'RUNNING_TALVEZ', to: STATES.RUNNING });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(CODES.ESTADO_DESCONHECIDO);
  });
});
