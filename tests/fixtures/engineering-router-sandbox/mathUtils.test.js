'use strict';

/**
 * Fixture E2E do Engineering Model Router V1 (ver ENGINE ROUTER_V1 baseline).
 *
 * Este teste é RED por design: `mathUtils.js` não exporta `add`. Ele NUNCA deve rodar como
 * parte de `npm run test:unit`/`npx jest` normal — está listado em
 * `jest.config.cjs#testPathIgnorePatterns`. Ele só é executado dentro de um workspace git
 * isolado (worktree) que a suíte de integração `tests/integration/engineeringRouterFullLoopE2E.test.js`
 * cria e corrige via patch real, para provar o loop RED→FIX→REVIEW→GREEN ponta a ponta.
 */

const { multiply, add } = require('./mathUtils');

describe('mathUtils sandbox fixture (Engineering Model Router V1)', () => {
  test('multiply já funciona', () => {
    expect(multiply(2, 3)).toBe(6);
  });

  test('add deveria somar dois números (RED até o patch do CODER ser aplicado)', () => {
    expect(typeof add).toBe('function');
    expect(add(2, 3)).toBe(5);
  });
});
