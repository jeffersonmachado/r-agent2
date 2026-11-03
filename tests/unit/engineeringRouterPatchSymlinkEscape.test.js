'use strict';

/**
 * §8 ISOLAMENTO ADVERSARIAL — escape por SYMLINK no patch.
 *
 * DEFEITO MEDIDO (2026-10-21): `validatePatch` aceitava um diff com `new file mode 120000`.
 * Nesse modo o CONTEÚDO do arquivo é o ALVO do link, então:
 *   - o caminho tocado (`tests/fixtures/link`) está dentro de `allowedPaths` — a fronteira de
 *     path, que compara NOME, não vê nada;
 *   - `git apply` aceita e materializa um symlink REAL (`lstat().isSymbolicLink() === true`)
 *     apontando para `/etc/shadow` ou `../../.env`;
 *   - toda verificação posterior (diff canônico, tree hash, smoke) trata o caminho como
 *     arquivo comum e portanto também não vê nada.
 *
 * Medição que originou o guard (sonda descartável, reproduzida aqui em teste):
 *   { caso: 'symlink /etc/shadow', gitApply: 'ok', isSymlink: true, target: '/etc/shadow',
 *     validadorAceitou: true }
 *
 * Correção: `PATCH_SYMLINK_FORBIDDEN` recusa QUALQUER symlink no patch, fail-closed, com
 * autorização apenas por campo explícito de contrato (`symlinkAuthorization: true`).
 */

const { validatePatch, parseUnifiedDiff, touchedPathsOf } = require('../../engine/engineeringRouter/patchValidator');
const { FAILURE_CODES } = require('../../engine/engineeringRouter/constants');

const ALLOWED = { allowedPaths: ['tests/fixtures/**'] };

function symlinkDiff(path, target, { withIndexMode = false } = {}) {
  const linhas = [
    `diff --git a/${path} b/${path}`,
    'new file mode 120000',
  ];
  if (withIndexMode) linhas.push('index 0000000..1234567');
  linhas.push(
    '--- /dev/null',
    `+++ b/${path}`,
    '@@ -0,0 +1,1 @@',
    `+${target}`,
    '\\ No newline at end of file',
  );
  return linhas.join('\n');
}

function normalFileDiff(path, content) {
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    '@@ -0,0 +1,1 @@',
    `+${content}`,
  ].join('\n');
}

describe('§8 isolamento adversarial — symlink no patch', () => {
  test('symlink absoluto para /etc/shadow é RECUSADO', () => {
    const diff = symlinkDiff('tests/fixtures/link1', '/etc/shadow');
    const r = validatePatch(diff, { contract: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FAILURE_CODES.PATCH_SYMLINK_FORBIDDEN);
    // o path tocado está DENTRO do escopo: é justamente por isso que a fronteira de path
    // sozinha não bastava.
    expect(r.touchedPaths).toEqual(['tests/fixtures/link1']);
  });

  test('symlink relativo escapando do repositório (../../.env) é RECUSADO', () => {
    const diff = symlinkDiff('tests/fixtures/link2', '../../.env');
    const r = validatePatch(diff, { contract: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FAILURE_CODES.PATCH_SYMLINK_FORBIDDEN);
  });

  test('modo declarado só no `index <sha>..<sha> 120000` também é RECUSADO', () => {
    const diff = symlinkDiff('tests/fixtures/link3', '/etc/passwd', { withIndexMode: false })
      .replace('new file mode 120000\n', '')
      .replace('diff --git a/tests/fixtures/link3 b/tests/fixtures/link3', 'diff --git a/tests/fixtures/link3 b/tests/fixtures/link3\nindex 1111111..2222222 120000');
    const r = validatePatch(diff, { contract: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FAILURE_CODES.PATCH_SYMLINK_FORBIDDEN);
  });

  test('NÃO é falso-positivo: arquivo texto normal continua aceito', () => {
    const r = validatePatch(normalFileDiff('tests/fixtures/ctrl.txt', 'ok'), { contract: ALLOWED });
    expect(r.ok).toBe(true);
    expect(r.touchedPaths).toEqual(['tests/fixtures/ctrl.txt']);
  });

  test('conteúdo que PARECE caminho mas é arquivo comum não é confundido com symlink', () => {
    // Um arquivo comum cujo texto é "/etc/shadow" é inofensivo — o que perigoso é o MODO.
    const r = validatePatch(normalFileDiff('tests/fixtures/texto.txt', '/etc/shadow'), { contract: ALLOWED });
    expect(r.ok).toBe(true);
  });

  test('autorização explícita de contrato é o ÚNICO caminho de aceitação (auditável)', () => {
    const diff = symlinkDiff('tests/fixtures/link4', '/etc/shadow');
    const r = validatePatch(diff, { contract: { ...ALLOWED, symlinkAuthorization: true } });
    expect(r.ok).toBe(true);
  });

  test('o parser expõe o modo e o alvo para auditoria (não esconde o que recusou)', () => {
    const parsed = parseUnifiedDiff(symlinkDiff('tests/fixtures/link5', '../../.env'));
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].gitMode).toBe('120000');
    expect(parsed.files[0].isSymlink).toBe(true);
    expect(touchedPathsOf(parsed)).toEqual(['tests/fixtures/link5']);
  });

  test('CONVERSÃO de arquivo existente em symlink (old mode 100644 → new mode 120000) é RECUSADA', () => {
    // Variante que não cria arquivo novo: o patch TRANSFORMA um arquivo rastreado em symlink.
    // Medido 2026-10-21: sem tratar `old mode`/`new mode` no parser, `isNew` não é marcado e o
    // guard de "arquivo novo" passaria batido.
    const diff = [
      'diff --git a/tests/fixtures/existente.txt b/tests/fixtures/existente.txt',
      'old mode 100644',
      'new mode 120000',
      'index 1111111..2222222',
      '--- a/tests/fixtures/existente.txt',
      '+++ b/tests/fixtures/existente.txt',
      '@@ -1 +1 @@',
      '-conteudo antigo',
      '+/etc/shadow',
    ].join('\n');
    const parsed = parseUnifiedDiff(diff);
    expect(parsed.files[0].gitMode).toBe('120000');
    expect(parsed.files[0].isSymlink).toBe(true);
    const r = validatePatch(diff, { contract: ALLOWED });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(FAILURE_CODES.PATCH_SYMLINK_FORBIDDEN);
  });

  test('arquivo EXECUTÁVEL (100755) não é symlink: continua aceito', () => {
    // Guarda contra excesso de zelo: o guard é sobre symlink, não sobre bit de execução.
    const diff = [
      'diff --git a/tests/fixtures/run.sh b/tests/fixtures/run.sh',
      'new file mode 100755',
      '--- /dev/null',
      '+++ b/tests/fixtures/run.sh',
      '@@ -0,0 +1,1 @@',
      '+echo oi',
    ].join('\n');
    const r = validatePatch(diff, { contract: ALLOWED });
    expect(r.ok).toBe(true);
  });
});
