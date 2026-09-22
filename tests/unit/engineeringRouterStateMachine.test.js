'use strict';

const { canTransition, assertTransition, isTerminal } = require('../../engine/engineeringRouter/stateMachine');

describe('engineeringRouter/stateMachine', () => {
  test('fluxo feliz completo é permitido', () => {
    // ER-V1-SEAL-002: GOVERNANCE não vai mais direto para GREEN — passa por PROMOTING
    // (candidate commit ainda não criado) e POST_PROMOTION_VERIFY (candidate criado, smoke
    // pendente) antes de GREEN, dando ao reconciliador um estado persistido distinto para cada
    // ponto de crash possível no trecho mais crítico do loop (nunca promover duas vezes).
    const path = ['CREATED', 'CLASSIFIED', 'ROUTED', 'CODING', 'TESTING', 'REVIEWING', 'REGRESSION', 'GOVERNANCE', 'PROMOTING', 'POST_PROMOTION_VERIFY', 'GREEN'];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
    }
  });

  test('loop RED->FIX: TESTING pode voltar para CODING', () => {
    expect(canTransition('TESTING', 'CODING')).toBe(true);
  });

  test('review reject: REVIEWING pode voltar para CODING', () => {
    expect(canTransition('REVIEWING', 'CODING')).toBe(true);
  });

  test('rejeita pular etapas (CREATED -> GREEN direto)', () => {
    expect(canTransition('CREATED', 'GREEN')).toBe(false);
    expect(() => assertTransition('CREATED', 'GREEN')).toThrow();
  });

  test('estados terminais não têm transições de saída', () => {
    expect(canTransition('GREEN', 'CODING')).toBe(false);
    expect(canTransition('RED', 'CODING')).toBe(false);
    expect(canTransition('CANCELLED', 'CODING')).toBe(false);
  });

  test('assertTransition lança erro com code INVALID_STATE_TRANSITION', () => {
    try {
      assertTransition('GREEN', 'RED');
      throw new Error('não deveria chegar aqui');
    } catch (err) {
      expect(err.code).toBe('INVALID_STATE_TRANSITION');
    }
  });

  test('isTerminal identifica os 4 estados terminais', () => {
    expect(isTerminal('GREEN')).toBe(true);
    expect(isTerminal('RED')).toBe(true);
    expect(isTerminal('BLOCKED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('CODING')).toBe(false);
  });
});
