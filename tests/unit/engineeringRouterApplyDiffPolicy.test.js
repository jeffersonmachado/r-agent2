'use strict';

/**
 * tests/unit/engineeringRouterApplyDiffPolicy.test.js
 *
 * Regressão do DEFEITO MEDIDO em 2026-10-08 (missão ca56cbdc / task 7fb9cf2a): o texto aplicado no
 * sandbox era o CANONICALIZADO, mas o que seguia para a promoção era o CRU → a promoção morria com
 * `PROMOTION_EXPECTED_TREE_APPLY_FAILED: patch fragment without header at line 3` e a missão ficava
 * DEGRADED com REGRESSION PASS e GOVERNANCE PASS.
 *
 * O patch usado aqui é EMULADO de forma fiel: gerado por `git diff` REAL (corpo sempre coerente) e
 * depois com os headers `index`/`---`/`+++` REMOVIDOS — o defeito exato que o `diffCanonicalizer`
 * documenta como sistemático no coder `qwen3-coder-flash`. A prova é `git apply --check` de
 * verdade contra um repositório temporário, não comparação de string.
 *
 * NOTA DE HONESTIDADE: o texto não é byte-a-byte o patch da task 7fb9cf2a (esse está preservado em
 * `engineering_attempts.patch_diff`); é o MESMO defeito, no MESMO arquivo e no MESMO formato, com
 * corpo gerado pelo git para que o teste seja reproduzível.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { resolveApplyDiff } = require('../../engine/engineeringRouter/applyDiffPolicy');

const ALVO = 'api/services/engineeringMission/missionReplanService.js';
const LINHA_ALTERADA = 114;

/** Conteúdo determinístico de base: a linha 114 é a que o patch do modelo altera. */
function conteudoBase() {
  return Array.from({ length: 130 }, (_, i) => {
    const n = i + 1;
    if (n === LINHA_ALTERADA) return '    return { applied: false, outcome, recorded };';
    if (n === LINHA_ALTERADA - 1) return '  if (!kind) {';
    if (n === LINHA_ALTERADA + 1) return '  }';
    return `// linha ${n}`;
  }).join('\n') + '\n';
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: 'pipe' }).toString();
}

/** Repositório temporário com o arquivo-alvo já commitado. */
function buildRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'applydiff-policy-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir });
  const abs = path.join(dir, ALVO);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudoBase(), 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  return { dir, abs };
}

/**
 * Emula o defeito do modelo: `git diff` REAL e depois remoção de `index`/`---`/`+++`, deixando
 * `diff --git` seguido direto do `@@`.
 */
function patchSemHeaders() {
  const { dir, abs } = buildRepo();
  try {
    fs.writeFileSync(abs, conteudoBase().replace(
      '    return { applied: false, outcome, recorded };',
      '    return { applied: true, outcome, recorded };',
    ), 'utf8');
    return git(['diff'], dir)
      .split('\n')
      .filter((l) => !l.startsWith('index ') && !l.startsWith('--- ') && !l.startsWith('+++ '))
      .join('\n');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `git apply --check` do patch contra um repositório NOVO com o mesmo conteúdo de base. */
function gitApplyCheck(patchText) {
  const { dir } = buildRepo();
  try {
    const patchFile = path.join(dir, 'proposta.patch');
    fs.writeFileSync(patchFile, patchText, 'utf8');
    try {
      execFileSync('git', ['apply', '--check', patchFile], { cwd: dir, stdio: 'pipe' });
      return { ok: true, stderr: '' };
    } catch (err) {
      return { ok: false, stderr: String((err.stderr && err.stderr.toString()) || err.message) };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('applyDiffPolicy — QUAL texto é realmente aplicado (fonte única)', () => {
  let SEM_HEADERS;

  beforeAll(() => { SEM_HEADERS = patchSemHeaders(); });

  test('o patch do modelo (sem `---`/`+++`) é REALMENTE recusado pelo git — reprodução do defeito', () => {
    const check = gitApplyCheck(SEM_HEADERS);

    expect(check.ok).toBe(false);
    expect(check.stderr).toMatch(/patch fragment without header/i);
  });

  test('revalidação aprovada ⇒ devolve o CANONICALIZADO e o git aceita (era o que faltava na promoção)', () => {
    const resolved = resolveApplyDiff(SEM_HEADERS, { revalidate: () => ({ ok: true }) });

    expect(resolved.applied).toBe(true);
    expect(resolved.canonicalization.revalidationOk).toBe(true);
    expect(resolved.diff).toContain(`--- a/${ALVO}`);
    expect(resolved.diff).toContain(`+++ b/${ALVO}`);

    expect(gitApplyCheck(resolved.diff).ok).toBe(true);
    expect(gitApplyCheck(SEM_HEADERS).ok).toBe(false);
  });

  test('revalidação REPROVADA ⇒ devolve o cru (canonicalização nunca transforma inválido em aprovado)', () => {
    const resolved = resolveApplyDiff(SEM_HEADERS, {
      revalidate: () => ({ ok: false, code: 'PATCH_INVALID_FORMAT' }),
    });

    expect(resolved.applied).toBe(false);
    expect(resolved.diff).toBe(SEM_HEADERS);
    expect(resolved.canonicalization.revalidationOk).toBe(false);
    expect(resolved.canonicalization.revalidationCode).toBe('PATCH_INVALID_FORMAT');
  });

  test('fail-closed: sem revalidação E sem declaração explícita ⇒ cru', () => {
    const semNada = resolveApplyDiff(SEM_HEADERS);
    expect(semNada.applied).toBe(false);
    expect(semNada.diff).toBe(SEM_HEADERS);

    // `assumeAlreadyApplied` é DECLARAÇÃO EXPLÍCITA (retomada de attempt DONE), nunca default.
    const retomada = resolveApplyDiff(SEM_HEADERS, { assumeAlreadyApplied: true });
    expect(retomada.applied).toBe(true);
    expect(gitApplyCheck(retomada.diff).ok).toBe(true);
  });

  test('patch que já declara os headers permanece INTACTO (nada é reparado)', () => {
    const { dir, abs } = buildRepo();
    let completo;
    try {
      fs.writeFileSync(abs, conteudoBase().replace(
        '    return { applied: false, outcome, recorded };',
        '    return { applied: true, outcome, recorded };',
      ), 'utf8');
      completo = git(['diff'], dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const resolved = resolveApplyDiff(completo, { revalidate: () => ({ ok: true }) });
    expect(resolved.applied).toBe(false);
    expect(resolved.canonicalization).toBeNull();
    expect(resolved.diff).toBe(completo);
    expect(gitApplyCheck(completo).ok).toBe(true);
  });

  test('ambíguo (rename) NÃO é canonicalizado — segue cru, mesmo com revalidação aprovada', () => {
    const ambíguo = [
      'diff --git a/a.js b/b.js',
      'rename from a.js',
      'rename to b.js',
      '@@ -1,2 +1,2 @@',
      ' x',
      '-y',
      '+z',
      '',
    ].join('\n');

    const resolved = resolveApplyDiff(ambíguo, { revalidate: () => ({ ok: true }) });
    expect(resolved.applied).toBe(false);
    expect(resolved.diff).toBe(ambíguo);
  });
});
