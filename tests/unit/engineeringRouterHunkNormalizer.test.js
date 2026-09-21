'use strict';

const { normalizeHunkHeaders } = require('../../engine/engineeringRouter/hunkNormalizer');

const VALID_DIFF = `diff --git a/src/foo.js b/src/foo.js
--- a/src/foo.js
+++ b/src/foo.js
@@ -1,3 +1,3 @@
 function foo() {
-  return 1;
+  return 2;
 }
`;

// Achado real do pilot V1: o CODER declarou "+1,18" no header mas só escreveu 16 linhas de
// conteúdo real no corpo do hunk (a contagem incluía, por engano, a própria linha "+++" do
// cabeçalho do arquivo) — `git apply` rejeitava com "patch corrompido", mesmo com o conteúdo
// perfeitamente aplicável.
const WRONG_COUNT_DIFF = `diff --git a/tests/unit/foo.test.js b/tests/unit/foo.test.js
new file mode 100644
index 0000000..c3b4f1a
--- /dev/null
+++ b/tests/unit/foo.test.js
@@ -0,0 +1,18 @@
+const { TYPE_COMPATIBILITY } = require('../../engine/utils/typeCompatibility');
+
+describe('TYPE_COMPATIBILITY', () => {
+  it('nao permite merge -> merge', () => {
+    expect(TYPE_COMPATIBILITY.merge).not.toContain('merge');
+  });
+
+  it('permite start -> message', () => {
+    expect(TYPE_COMPATIBILITY.start).toContain('message');
+  });
+
+  it('define end como no terminal sem destinos', () => {
+    expect(Array.isArray(TYPE_COMPATIBILITY.end)).toBe(true);
+    expect(TYPE_COMPATIBILITY.end).toEqual([]);
+  });
+});

`;

describe('engineeringRouter/hunkNormalizer', () => {
  test('não altera um diff cuja contagem de hunk já está correta', () => {
    const result = normalizeHunkHeaders(VALID_DIFF);
    expect(result).toContain('@@ -1,3 +1,3 @@');
  });

  test('recalcula a contagem de um hunk com header errado (achado real do pilot)', () => {
    const result = normalizeHunkHeaders(WRONG_COUNT_DIFF);
    // 16 linhas reais de "+" no corpo (a linha "+++" do cabeçalho de arquivo NÃO conta).
    expect(result).toContain('@@ -0,0 +1,16 @@');
    expect(result).not.toContain('+1,18');
  });

  test('o diff corrigido é de fato aplicável via git apply --check', () => {
    const { execFileSync } = require('child_process');
    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    const fixed = normalizeHunkHeaders(WRONG_COUNT_DIFF);
    const tmpFile = path.join(os.tmpdir(), `hunk-normalizer-test-${Date.now()}.diff`);
    fs.writeFileSync(tmpFile, fixed);
    try {
      // --check roda contra o índice/working tree do repositório atual, mas o arquivo é novo
      // (new file mode) e não toca em nada existente — seguro rodar aqui.
      execFileSync('git', ['apply', '--check', tmpFile], { cwd: path.resolve(__dirname, '..', '..') });
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  test('remove múltiplas quebras de linha finais redundantes sem alterar a contagem', () => {
    const withExtraTrailingNewlines = `${WRONG_COUNT_DIFF}\n\n\n`;
    const result = normalizeHunkHeaders(withExtraTrailingNewlines);
    expect(result).toContain('@@ -0,0 +1,16 @@');
  });

  test('preserva múltiplos hunks e múltiplos arquivos', () => {
    const multiFile = `diff --git a/a.js b/a.js
--- a/a.js
+++ b/a.js
@@ -1,2 +1,2 @@
-old
+new
 context
diff --git a/b.js b/b.js
--- a/b.js
+++ b/b.js
@@ -1,1 +1,1 @@
-x
+y
`;
    const result = normalizeHunkHeaders(multiFile);
    expect(result).toContain('@@ -1,2 +1,2 @@');
    expect(result).toContain('@@ -1 +1 @@');
    expect((result.match(/diff --git/g) || []).length).toBe(2);
  });
});
