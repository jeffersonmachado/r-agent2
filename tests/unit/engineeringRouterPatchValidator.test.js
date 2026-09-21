'use strict';

const { validatePatch, parseUnifiedDiff } = require('../../engine/engineeringRouter/patchValidator');

const VALID_DIFF = `diff --git a/src/foo.js b/src/foo.js
index 1234567..89abcde 100644
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,3 @@
 function foo() {
-  return 1;
+  return 2;
 }
`;

describe('engineeringRouter/patchValidator', () => {
  test('rejeita texto que não é um unified diff (descrição em linguagem natural)', () => {
    const result = validatePatch('mude o arquivo X desta maneira: troque o valor de retorno para 2', { contract: {} });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_INVALID_FORMAT');
  });

  test('aceita um unified diff válido dentro do escopo autorizado', () => {
    const result = validatePatch(VALID_DIFF, { contract: { allowedPaths: ['src/**'] } });
    expect(result.ok).toBe(true);
    expect(result.touchedPaths).toEqual(['src/foo.js']);
  });

  test('rejeita patch fora do escopo autorizado', () => {
    const result = validatePatch(VALID_DIFF, { contract: { allowedPaths: ['scripts/governance/**'] } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_OUTSIDE_ALLOWED_SCOPE');
  });

  test('rejeita alteração binária', () => {
    const binaryDiff = `diff --git a/logo.png b/logo.png\nindex 111..222 100644\nGIT binary patch\nliteral 10\nabc\n`;
    const result = validatePatch(binaryDiff, { contract: {} });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'PATCH_BINARY_CHANGE')).toBe(true);
  });

  test('rejeita delete não autorizado por padrão', () => {
    const deleteDiff = `diff --git a/src/old.js b/src/old.js\ndeleted file mode 100644\nindex 111..000\n--- a/src/old.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n`;
    const result = validatePatch(deleteDiff, { contract: {} });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'PATCH_UNEXPECTED_DELETE')).toBe(true);
  });

  test('permite delete quando o contrato autoriza allowDeletes', () => {
    const deleteDiff = `diff --git a/src/old.js b/src/old.js\ndeleted file mode 100644\nindex 111..000\n--- a/src/old.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-a\n-b\n`;
    const result = validatePatch(deleteDiff, { contract: { allowDeletes: true, allowedPaths: ['src/**'] } });
    expect(result.ok).toBe(true);
  });

  test('rejeita patch tocando arquivo de secret mesmo dentro do escopo', () => {
    const envDiff = `diff --git a/.env b/.env\nindex 111..222 100644\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-A=1\n+A=2\n`;
    const result = validatePatch(envDiff, { contract: { allowedPaths: ['.env'] } });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'PATCH_FORBIDDEN_FILE')).toBe(true);
  });

  test('rejeita patch maior que o limite de tamanho', () => {
    const result = validatePatch(VALID_DIFF, { contract: { allowedPaths: ['src/**'] }, maxPatchSizeBytes: 10 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('PATCH_TOO_LARGE');
  });

  test('parseUnifiedDiff extrai arquivos e contagem de hunks', () => {
    const parsed = parseUnifiedDiff(VALID_DIFF);
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].newPath).toBe('src/foo.js');
    expect(parsed.files[0].hunkCount).toBe(1);
  });
});
