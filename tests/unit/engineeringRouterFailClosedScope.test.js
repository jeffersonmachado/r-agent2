'use strict';

/**
 * ER-V1-FINAL-003 — Fail-Closed Scope.
 *
 * RED reproduzido (achado real, não hipotético): `checkPathBoundary` tratava
 * `allowedPaths` vazio/ausente como "tudo permitido" — uma task sem NENHUM caminho declarado
 * (esquecimento, bug de geração do Task Contract, contrato malformado) tocava qualquer arquivo
 * do repositório, sem nenhum aviso. Reprodução real via `validatePatch`: um patch tocando
 * `api/server.js` com `contract: {allowedPaths: [], risk: 'HIGH'}` retornava `ok:true`.
 *
 * Corrigido: `allowedPaths` vazio/ausente é SEMPRE `NO_PATCH_SCOPE` (reject), mesmo com
 * `forbiddenPaths` vazio, mesmo risk baixo. Única exceção: `scope === 'REPOSITORY_WIDE'` E
 * `explicitPolicyAuthorization === true` — autorização explícita e deliberada, nunca inferida.
 */

const { checkPathBoundary } = require('../../engine/engineeringRouter/pathBoundary');
const { validatePatch } = require('../../engine/engineeringRouter/patchValidator');

const SIMPLE_DIFF_FOR = (file) => `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -1,1 +1,2 @@
 x
+y
`;

describe('ER-V1-FINAL-003 — Fail-Closed Scope', () => {
  describe('checkPathBoundary', () => {
    test('allowedPaths=[] + patch api/file.js → REJECT (NO_PATCH_SCOPE)', () => {
      const result = checkPathBoundary(['api/file.js'], { allowedPaths: [] });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('allowedPaths ausente (undefined) + patch qualquer → REJECT (NO_PATCH_SCOPE)', () => {
      const result = checkPathBoundary(['api/file.js'], {});
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('allowedPaths=["api/foo/**"] + patch api/foo/a.js → PASS', () => {
      const result = checkPathBoundary(['api/foo/a.js'], { allowedPaths: ['api/foo/**'] });
      expect(result.ok).toBe(true);
    });

    test('allowedPaths=["api/foo/**"] + patch api/bar/a.js → REJECT (fora do escopo declarado)', () => {
      const result = checkPathBoundary(['api/bar/a.js'], { allowedPaths: ['api/foo/**'] });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('PATCH_OUTSIDE_ALLOWED_SCOPE');
    });

    test('REPOSITORY_WIDE sem explicitPolicyAuthorization → REJECT (NO_PATCH_SCOPE)', () => {
      const result = checkPathBoundary(['api/file.js'], { allowedPaths: [], scope: 'REPOSITORY_WIDE' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('REPOSITORY_WIDE com explicitPolicyAuthorization=true → segue a policy (equivalente a allowedPaths=["**"])', () => {
      const result = checkPathBoundary(['qualquer/arquivo/profundo.js'], {
        allowedPaths: [],
        scope: 'REPOSITORY_WIDE',
        explicitPolicyAuthorization: true,
      });
      expect(result.ok).toBe(true);
    });

    test('scope=REPOSITORY_WIDE sozinho (sem explicitPolicyAuthorization=true) não basta → REJECT', () => {
      const result = checkPathBoundary(['api/file.js'], {
        allowedPaths: [],
        scope: 'REPOSITORY_WIDE',
        explicitPolicyAuthorization: false,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('explicitPolicyAuthorization=true sem scope=REPOSITORY_WIDE não basta → REJECT', () => {
      const result = checkPathBoundary(['api/file.js'], {
        allowedPaths: [],
        scope: 'MEDIUM',
        explicitPolicyAuthorization: true,
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('REPOSITORY_WIDE autorizado ainda respeita forbiddenPaths', () => {
      const result = checkPathBoundary(['secrets/real.env'], {
        allowedPaths: [],
        scope: 'REPOSITORY_WIDE',
        explicitPolicyAuthorization: true,
        forbiddenPaths: ['secrets/**'],
      });
      expect(result.ok).toBe(false);
      expect(result.violations[0].reason).toBe('FORBIDDEN_PATH');
    });
  });

  describe('validatePatch (integração real com a allowlist estrutural)', () => {
    test('risk=HIGH sem allowedPaths → REJECT', () => {
      const result = validatePatch(SIMPLE_DIFF_FOR('api/server.js'), { contract: { allowedPaths: [], risk: 'HIGH' } });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('risk=CRITICAL sem allowedPaths → REJECT', () => {
      const result = validatePatch(SIMPLE_DIFF_FOR('api/server.js'), { contract: { allowedPaths: [], risk: 'CRITICAL' } });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('risk=LOW sem allowedPaths TAMBÉM é REJECT — fail-closed não depende do risco declarado', () => {
      const result = validatePatch(SIMPLE_DIFF_FOR('api/server.js'), { contract: { allowedPaths: [], risk: 'LOW' } });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('NO_PATCH_SCOPE');
    });

    test('risk=CRITICAL com allowedPaths explícito e positivo → PASS', () => {
      const result = validatePatch(SIMPLE_DIFF_FOR('api/server.js'), {
        contract: { allowedPaths: ['api/server.js'], risk: 'CRITICAL' },
      });
      expect(result.ok).toBe(true);
    });

    test('risk=CRITICAL com REPOSITORY_WIDE autorizado explicitamente → PASS mesmo sem allowedPaths', () => {
      const result = validatePatch(SIMPLE_DIFF_FOR('api/server.js'), {
        contract: { allowedPaths: [], risk: 'CRITICAL', scope: 'REPOSITORY_WIDE', explicitPolicyAuthorization: true },
      });
      expect(result.ok).toBe(true);
    });
  });
});
