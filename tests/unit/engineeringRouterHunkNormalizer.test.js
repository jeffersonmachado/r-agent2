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

// DEFEITO MEDIDO (2026-10-08) — arquivo alvo SEM newline final.
//
// O unified diff carrega o marcador `\ No newline at end of file` logo após a linha (removida,
// adicionada ou de contexto) que não termina em newline. O marcador NÃO é linha de conteúdo: não
// pertence ao lado "old" nem ao lado "new". Antes desta correção ele caía no ramo de contexto do
// contador (não começa com '+', '-' nem ' ') e inflava AMBOS os lados em +1 — medido em diff REAL
// do `git diff`: `@@ -1 +1 @@` virava `@@ -1,3 +1,3 @@`. Como `applyPatch` normaliza antes do
// `git apply`, um patch SEMANTICAMENTE CORRETO era recusado como "corrupt patch", queimando a
// tentativa (PATCH_APPLY_FAILED) e disparando reroute indevido de modelo.
describe('engineeringRouter/hunkNormalizer — arquivo sem newline final (defeito medido)', () => {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const NO_NEWLINE_DIFF = [
    'diff --git a/src/legacy.js b/src/legacy.js',
    '--- a/src/legacy.js',
    '+++ b/src/legacy.js',
    '@@ -1 +1 @@',
    '-module.exports = 1',
    '\\ No newline at end of file',
    '+module.exports = 2',
    '\\ No newline at end of file',
    '',
  ].join('\n');

  const initRepoComArquivoSemNewline = () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hunk-no-newline-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'src'));
    // SEM newline final: é a precondição do marcador no diff.
    fs.writeFileSync(path.join(repo, 'src', 'legacy.js'), 'module.exports = 1', 'utf8');
    execFileSync('git', ['add', '-A'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
    return repo;
  };

  test('o marcador `\\ No newline at end of file` NÃO conta como linha de conteúdo', () => {
    const result = normalizeHunkHeaders(NO_NEWLINE_DIFF);
    expect(result).toContain('@@ -1 +1 @@');
    expect(result).not.toContain('@@ -1,3 +1,3 @@');
    // O marcador é PRESERVADO (sem ele o git recusa o patch).
    expect(result).toContain('\\ No newline at end of file');
    expect((result.match(/No newline at end of file/g) || []).length).toBe(2);
  });

  test('o texto normalizado é de fato aplicável — provado com git apply --check real', () => {
    const repo = initRepoComArquivoSemNewline();
    try {
      const patchFile = path.join(repo, 'no-newline.diff');
      fs.writeFileSync(patchFile, normalizeHunkHeaders(NO_NEWLINE_DIFF), 'utf8');
      expect(() => execFileSync('git', ['apply', '--check', patchFile], { cwd: repo, stdio: 'pipe' })).not.toThrow();
      // Aplicação real: o conteúdo muda e o arquivo permanece SEM newline final.
      execFileSync('git', ['apply', patchFile], { cwd: repo, stdio: 'pipe' });
      expect(fs.readFileSync(path.join(repo, 'src', 'legacy.js'), 'utf8')).toBe('module.exports = 2');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('controle negativo: com o header inflado (comportamento antigo) o git RECUSA', () => {
    const repo = initRepoComArquivoSemNewline();
    try {
      const patchFile = path.join(repo, 'inflado.diff');
      fs.writeFileSync(patchFile, NO_NEWLINE_DIFF.replace('@@ -1 +1 @@', '@@ -1,3 +1,3 @@'), 'utf8');
      expect(() => execFileSync('git', ['apply', '--check', patchFile], { cwd: repo, stdio: 'pipe' })).toThrow();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('é IDENTIDADE em diff real do `git diff` (fixpoint) — nada é reparado sem necessidade', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hunk-fixpoint-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: repo });
      execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repo });
      execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
      fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n', 'utf8');
      fs.writeFileSync(path.join(repo, 'b.txt'), 'no-newline', 'utf8');
      execFileSync('git', ['add', '-A'], { cwd: repo });
      execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
      fs.writeFileSync(path.join(repo, 'a.txt'), 'y\n', 'utf8');
      fs.writeFileSync(path.join(repo, 'b.txt'), 'no-newline-2', 'utf8');

      const realDiff = execFileSync('git', ['diff'], { cwd: repo, encoding: 'utf8' });
      expect(realDiff).toContain('\\ No newline at end of file');
      expect(normalizeHunkHeaders(realDiff)).toBe(realDiff);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('entrada vazia continua vazia e texto sem newline final não ganha newline inventado', () => {
    expect(normalizeHunkHeaders('')).toBe('');
    expect(normalizeHunkHeaders('sem newline')).toBe('sem newline');
  });
});
