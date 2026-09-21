'use strict';

const { checkPathBoundary } = require('../../engine/engineeringRouter/pathBoundary');

describe('engineeringRouter/pathBoundary', () => {
  test('permite caminho dentro do allowedPaths com glob **', () => {
    const result = checkPathBoundary(['scripts/governance/validate-x.js'], { allowedPaths: ['scripts/governance/**'] });
    expect(result.ok).toBe(true);
  });

  test('rejeita caminho fora do allowedPaths', () => {
    const result = checkPathBoundary(['frontend/src/App.jsx'], { allowedPaths: ['scripts/governance/**', 'qa-mesh/**'] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_OUTSIDE_ALLOWED_SCOPE');
    expect(result.violations[0]).toEqual(expect.objectContaining({ path: 'frontend/src/App.jsx' }));
  });

  test('forbiddenPaths sempre vence sobre allowedPaths', () => {
    const result = checkPathBoundary(['scripts/governance/secret.js'], {
      allowedPaths: ['scripts/governance/**'],
      forbiddenPaths: ['scripts/governance/secret.js'],
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0].reason).toBe('FORBIDDEN_PATH');
  });

  test('sem allowedPaths definido, qualquer caminho passa exceto forbidden', () => {
    const result = checkPathBoundary(['qualquer/coisa.js'], { forbiddenPaths: ['segredo/**'] });
    expect(result.ok).toBe(true);
  });

  test('exemplo real da missão: task autorizada só em governance/qa-mesh não pode tocar frontend/verticals', () => {
    const contract = { allowedPaths: ['scripts/governance/**', 'qa-mesh/**', 'tests/governance/**'] };
    const attempt1 = checkPathBoundary(['scripts/governance/novo-validador.js'], contract);
    const attempt2 = checkPathBoundary(['frontend/src/pages/Foo.jsx'], contract);
    const attempt3 = checkPathBoundary(['verticals/beauty/service.js'], contract);
    expect(attempt1.ok).toBe(true);
    expect(attempt2.ok).toBe(false);
    expect(attempt3.ok).toBe(false);
  });
});
