'use strict';

/**
 * Fixture de spec JÁ SATISFEITA (decisão arquitetural 2026-10-29).
 *
 * Usada por `engineeringRouterSpecPreVerification.test.js` como o `testCommand` de uma spec cujo
 * cenário já passa no commit da fonte da missão. Existe para que a pré-verificação do Router tenha
 * um comando REAL, determinístico e verde dentro do sandbox — provar a decisão com um comando que
 * falha nunca provaria nada.
 *
 * Usa `multiply`, que JÁ existe no fixture: `add` é justamente o defeito que as suítes do laço de
 * bugs corrigem, então uma spec baseada em `add` estaria, por definição, não satisfeita.
 */

const path = require('path');
const { multiply } = require(path.join(__dirname, 'mathUtils'));

test('a operação exigida pela spec já está implementada (cenário satisfeito)', () => {
  expect(typeof multiply).toBe('function');
  expect(multiply(2, 3)).toBe(6);
});
