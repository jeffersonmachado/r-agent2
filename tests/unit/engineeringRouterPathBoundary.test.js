'use strict';

const { checkPathBoundary, resolvePathSegments } = require('../../engine/engineeringRouter/pathBoundary');

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

  // ERV1-CLOSE-010 (teste adversarial de segurança) — achado real: `checkPathBoundary` fazia
  // match do allowedPaths glob via STRING CRUA, sem nunca resolver `..` — um caminho como
  // `tests/fixtures/engineering-router-sandbox/../../../etc/passwd` batia no glob
  // `tests/fixtures/engineering-router-sandbox/**` (o `**` "engolia" literalmente o
  // `../../../etc/passwd` como texto) e o boundary check retornava `ok:true` para um escape
  // real. `git apply` de fato rejeita qualquer path com `..` (defesa em profundidade incidental
  // no pipeline real), mas a autoridade que o Task Contract afirma garantir dava falso-positivo.
  describe('path traversal (achado real, corrigido nesta versão)', () => {
    const contract = { allowedPaths: ['tests/fixtures/engineering-router-sandbox/**'] };

    test('resolvePathSegments colapsa .. como o filesystem resolveria', () => {
      expect(resolvePathSegments('a/b/../c')).toBe('a/c');
      expect(resolvePathSegments('a/./b')).toBe('a/b');
      expect(resolvePathSegments('a/b/..')).toBe('a');
    });

    test('resolvePathSegments retorna null quando o caminho sobe acima da raiz', () => {
      expect(resolvePathSegments('a/../../b')).toBeNull();
      expect(resolvePathSegments('../etc/passwd')).toBeNull();
    });

    test('travessia que escapa para fora do allowedPaths é rejeitada (nunca aceita por match de string crua)', () => {
      const result = checkPathBoundary(['tests/fixtures/engineering-router-sandbox/../../../etc/passwd'], contract);
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PATCH_OUTSIDE_ALLOWED_SCOPE');
    });

    test('travessia profunda o bastante para subir acima da raiz do repositório é rejeitada com PATH_ESCAPES_ROOT', () => {
      const result = checkPathBoundary(['tests/fixtures/engineering-router-sandbox/../../../../../../etc/passwd'], contract);
      expect(result.ok).toBe(false);
      expect(result.violations[0].reason).toBe('PATH_ESCAPES_ROOT');
    });

    test('.. legítimo que permanece DENTRO do escopo continua funcionando (nunca um falso-positivo)', () => {
      const result = checkPathBoundary(['tests/fixtures/engineering-router-sandbox/subdir/../mathUtils.js'], contract);
      expect(result.ok).toBe(true);
    });

    test('forbiddenPaths continua vencendo mesmo depois da resolução de ..', () => {
      const result = checkPathBoundary(['tests/fixtures/engineering-router-sandbox/subdir/../secret.env'], {
        allowedPaths: ['tests/fixtures/engineering-router-sandbox/**'],
        forbiddenPaths: ['tests/fixtures/engineering-router-sandbox/secret.env'],
      });
      expect(result.ok).toBe(false);
      expect(result.violations[0].reason).toBe('FORBIDDEN_PATH');
    });
  });
});
