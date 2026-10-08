'use strict';

/**
 * Canonicalização determinística de headers de arquivo ausentes (HUMAN_EXTERNAL_BOOTSTRAP 2026-10-07).
 * Matriz exigida pela autorização: positivos E negativos, incluindo os casos que NÃO podem mudar.
 */

const assert = require('node:assert');
const { canonicalizeMissingFileHeaders } = require('../../engine/engineeringRouter/diffCanonicalizer');
const { validatePatch, parseUnifiedDiff } = require('../../engine/engineeringRouter/patchValidator');

const TASK_CONTRACT = { allowedPaths: ['api/**', 'tests/**', 'engine/**'], forbiddenPaths: [] };

const CORPO = [
  '-\'use strict\';',
  '+\'use strict\';',
  ' ',
  ' const x = 1;',
];

const blocoSemHeaders = (path = 'api/services/engineeringMission/missionReplanService.js') => [
  `diff --git a/${path} b/${path}`,
  '@@ -1,5 +1,5 @@',
  ...CORPO,
].join('\n') + '\n';

const blocoComHeaders = (path = 'api/services/engineeringMission/missionReplanService.js') => [
  `diff --git a/${path} b/${path}`,
  'index 2d9c1b8..a4d0f2e 100644',
  `--- a/${path}`,
  `+++ b/${path}`,
  '@@ -1,5 +1,5 @@',
  ...CORPO,
].join('\n') + '\n';

describe('engineeringRouter/diffCanonicalizer', () => {
  describe('POSITIVOS', () => {
    it('ambos os headers ausentes e path inequívoco → canonicaliza', () => {
      const raw = blocoSemHeaders();
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, true);
      assert.deepStrictEqual(out.blocks[0].missingHeaders, ['---', '+++']);
      assert.deepStrictEqual(out.blocks[0].derivedHeaders, [
        '--- a/api/services/engineeringMission/missionReplanService.js',
        '+++ b/api/services/engineeringMission/missionReplanService.js',
      ]);
      // Os headers derivados aparecem ANTES do @@, e NENHUMA linha de conteúdo foi alterada.
      const linhas = out.text.split('\n');
      const idxHunk = linhas.findIndex((l) => l.startsWith('@@'));
      assert.strictEqual(linhas[idxHunk - 2], '--- a/api/services/engineeringMission/missionReplanService.js');
      assert.strictEqual(linhas[idxHunk - 1], '+++ b/api/services/engineeringMission/missionReplanService.js');
      assert.deepStrictEqual(linhas.slice(idxHunk + 1, idxHunk + 1 + CORPO.length), CORPO);
    });

    it('apenas o header --- ausente → derivado, desde que o +++ seja consistente', () => {
      const p = 'engine/engineeringRouter/foo.js';
      const raw = [
        `diff --git a/${p} b/${p}`,
        `+++ b/${p}`,
        '@@ -1,2 +1,2 @@',
        '-a',
        '+b',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, true);
      assert.deepStrictEqual(out.blocks[0].missingHeaders, ['---']);
      assert.deepStrictEqual(out.blocks[0].derivedHeaders, [`--- a/${p}`]);
    });

    it('apenas o header +++ ausente → derivado, desde que o --- seja consistente', () => {
      const p = 'tests/unit/x.test.js';
      const raw = [
        `diff --git a/${p} b/${p}`,
        `--- a/${p}`,
        '@@ -1,2 +1,2 @@',
        '-a',
        '+b',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, true);
      assert.deepStrictEqual(out.blocks[0].missingHeaders, ['+++']);
    });

    it('múltiplos arquivos → cada bloco tratado independentemente', () => {
      const p1 = 'engine/a.js';
      const p2 = 'engine/b.js';
      const raw = [
        `diff --git a/${p1} b/${p1}`,
        '@@ -1,1 +1,1 @@',
        '-a',
        '+b',
        `diff --git a/${p2} b/${p2}`,
        `--- a/${p2}`,
        `+++ b/${p2}`,
        '@@ -1,1 +1,1 @@',
        '-c',
        '+d',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, true);
      assert.strictEqual(out.blocks.length, 1);
      assert.strictEqual(out.blocks[0].path, p1);
      // O bloco já íntegro (p2) permanece byte a byte igual.
      assert.ok(out.text.includes(`--- a/${p2}\n+++ b/${p2}\n@@ -1,1 +1,1 @@`));
    });

    it('o patch canonicalizado passa a validação estrutural (fluxo obrigatório)', () => {
      const raw = blocoSemHeaders();
      const antes = validatePatch(raw, { contract: TASK_CONTRACT });
      const out = canonicalizeMissingFileHeaders(raw);
      const depois = validatePatch(out.text, { contract: TASK_CONTRACT });
      assert.strictEqual(antes.ok, true, 'a validação estrutural já aprovava o patch cru (defeito medido)');
      assert.strictEqual(depois.ok, true);
      assert.deepStrictEqual(depois.touchedPaths, antes.touchedPaths, 'paths tocados não podem mudar');
    });
  });

  describe('NEGATIVOS — não pode alterar nada', () => {
    it('headers presentes → nenhuma alteração', () => {
      const raw = blocoComHeaders();
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
      assert.strictEqual(out.text, raw);
    });

    it('paths a/b diferentes (rename) → rejeita derivação', () => {
      const raw = [
        'diff --git a/engine/old.js b/engine/new.js',
        '@@ -1,1 +1,1 @@',
        '-a',
        '+b',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
      assert.strictEqual(out.text, raw);
      assert.strictEqual(out.skipped.length, 1);
    });

    it('novo arquivo (new file mode) → NÃO assume headers', () => {
      const p = 'engine/novo.js';
      const raw = [
        `diff --git a/${p} b/${p}`,
        'new file mode 100644',
        '@@ -0,0 +1,1 @@',
        '+novo',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
      assert.strictEqual(out.text, raw);
    });

    it('arquivo deletado (deleted file mode) → NÃO assume headers', () => {
      const p = 'engine/velho.js';
      const raw = [
        `diff --git a/${p} b/${p}`,
        'deleted file mode 100644',
        '@@ -1,1 +0,0 @@',
        '-velho',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
    });

    it('binário → NÃO assume headers', () => {
      const p = 'engine/bin.dat';
      const raw = [
        `diff --git a/${p} b/${p}`,
        'Binary files a/engine/bin.dat and b/engine/bin.dat differ',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
    });

    it('header presente apontando para OUTRO path → ambíguo, não canonicaliza', () => {
      const p = 'engine/a.js';
      const raw = [
        `diff --git a/${p} b/${p}`,
        '--- a/engine/outro.js',
        '@@ -1,1 +1,1 @@',
        '-a',
        '+b',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
      assert.ok(out.skipped.some((s) => /path diferente/.test(s.reason)));
    });

    it('bloco sem hunk → nada a canonicalizar', () => {
      const p = 'engine/a.js';
      const raw = [`diff --git a/${p} b/${p}`].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
    });

    it('texto vazio / sem diff --git → nada a fazer', () => {
      assert.strictEqual(canonicalizeMissingFileHeaders('').applied, false);
      assert.strictEqual(canonicalizeMissingFileHeaders('   ').applied, false);
      assert.strictEqual(canonicalizeMissingFileHeaders('apenas texto').applied, false);
      assert.strictEqual(canonicalizeMissingFileHeaders(null).applied, false);
    });

    it('NUNCA altera linhas de conteúdo, hunks ou contagens', () => {
      const raw = blocoSemHeaders();
      const out = canonicalizeMissingFileHeaders(raw);
      // Removendo por POSIÇÃO as 2 linhas inseridas (imediatamente antes do @@), o restante
      // tem de ser byte a byte idêntico ao original.
      const linhas = out.text.split('\n');
      const idxHunk = linhas.findIndex((l) => l.startsWith('@@'));
      const reconstruido = [...linhas.slice(0, idxHunk - 2), ...linhas.slice(idxHunk)].join('\n');
      assert.strictEqual(reconstruido, raw);
    });
  });

  describe('NEGATIVOS — o defeito real continua sendo recusado pela validação', () => {
    it('corpo de hunk inválido continua rejeitado (canonicalizar headers não salva)', () => {
      const p = 'engine/a.js';
      const raw = [
        `diff --git a/${p} b/${p}`,
        '@@ -1,3 +1,4 @@',
        'const a = 1;',
        'const b = 2;',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, true, 'os headers de arquivo são deriváveis...');
      const depois = validatePatch(out.text, { contract: TASK_CONTRACT });
      assert.strictEqual(depois.ok, false, '...mas o CORPO inválido continua recusado');
      assert.strictEqual(depois.code, 'PATCH_BODY_MISSING_PREFIX');
    });

    it('patch sem nenhum hunk continua rejeitado depois da canonicalização', () => {
      const p = 'engine/a.js';
      const raw = [`diff --git a/${p} b/${p}`, `--- a/${p}`, `+++ b/${p}`].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, false);
      const v = validatePatch(raw, { contract: TASK_CONTRACT });
      assert.strictEqual(v.ok, false);
    });

    it('path fora do contrato continua rejeitado depois da canonicalização', () => {
      const p = 'segredos/x.js';
      const raw = [
        `diff --git a/${p} b/${p}`,
        '@@ -1,1 +1,1 @@',
        '-a',
        '+b',
      ].join('\n') + '\n';
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.applied, true);
      const v = validatePatch(out.text, { contract: TASK_CONTRACT });
      assert.strictEqual(v.ok, false, 'o contrato de paths continua valendo');
    });

    it('a canonicalização não inventa linhas: o número de linhas cresce exatamente em 2 por bloco', () => {
      const raw = blocoSemHeaders();
      const out = canonicalizeMissingFileHeaders(raw);
      assert.strictEqual(out.text.split('\n').length, raw.split('\n').length + 2);
      // parseUnifiedDiff deve continuar enxergando o mesmo arquivo e o mesmo hunk
      const antes = parseUnifiedDiff(raw);
      const depois = parseUnifiedDiff(out.text);
      assert.deepStrictEqual(depois.files.map((f) => [f.oldPath, f.newPath, f.hunkCount]), antes.files.map((f) => [f.oldPath, f.newPath, f.hunkCount]));
    });
  });
});
