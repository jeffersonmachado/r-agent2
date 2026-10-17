'use strict';

/**
 * SEMÂNTICA DE EFEITO DO REPLAN (defeito medido 2026-10-17).
 *
 * `maybeReplanAfterSourceFailure` devolvia `replanned: true` mesmo quando
 * `resumeOriginalMission` respondia `resumed: false` (missão não executável por
 * política/aprovação) ou lançava. O chamador então logava "missão replanejada" e
 * seguia sem `replacementTaskId` — sucesso declarado sem efeito, a mesma classe
 * de falso verde que o Bug Closure First combate.
 *
 * Encontrado executando `tests/integration/missionSourceStaleReplanFullRouterE2E`
 * sob carga: `replan.replanned === true` com `replacementTaskId === null`.
 */

const { replanExecutou } = require('../../../api/services/engineeringMission/bugLoopCoordinatorService');

describe('replan — declaração segue EFEITO, não tentativa', () => {
  it('resume que NÃO executou ⇒ replanned falso (mesmo com tentativa consumida)', () => {
    expect(replanExecutou({ resumed: false, decision: 'NOT_EXECUTABLE', reason: 'APPROVAL_REQUIRED' })).toBe(false);
  });

  it('exceção capturada (resumed nulo) ⇒ replanned falso', () => {
    expect(replanExecutou(null)).toBe(false);
    expect(replanExecutou(undefined)).toBe(false);
  });

  it('objeto vazio não é sucesso', () => {
    expect(replanExecutou({})).toBe(false);
  });

  it('resume executado ⇒ replanned verdadeiro (controle positivo)', () => {
    expect(replanExecutou({ resumed: true, replacementTaskId: 'task-1', status: 'GREEN' })).toBe(true);
  });
});
