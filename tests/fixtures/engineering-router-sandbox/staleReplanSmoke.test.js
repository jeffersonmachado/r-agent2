'use strict';

/**
 * Fixture do E2E `missionSourceStaleReplanFullRouterE2E`.
 *
 * Por que este arquivo existe: o comando de teste declarado no contrato da task precisa (a) estar
 * na allowlist do Router (`npx jest ...`) e (b) PASSAR de verdade tanto na base antiga (M1, antes
 * do patch da task A) quanto na fonte já avançada (M2). A fixture `mathUtils.test.js` é RED por
 * design (exige `add`, que só existe depois do patch) e por isso não serve como comando de teste
 * de uma task que precisa chegar a PROMOTING.
 *
 * Este teste afirma apenas o estado que JÁ existe em qualquer commit da fixture — é um verificador
 * neutro de sanidade, não um teste da correção. Vive em `tests/fixtures/engineering-router-sandbox/`,
 * que está em `testPathIgnorePatterns` do Jest: nunca roda como parte da suíte normal.
 */

const { multiply } = require('./mathUtils');

describe('stale-replan smoke fixture (verificador neutro de sanidade)', () => {
  test('multiply continua funcionando em qualquer commit da fixture', () => {
    expect(multiply(2, 3)).toBe(6);
    expect(multiply(0, 5)).toBe(0);
  });
});
