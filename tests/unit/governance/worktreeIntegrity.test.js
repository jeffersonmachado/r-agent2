'use strict';

/**
 * Guarda de integridade do worktree — regressão da MUTILAÇÃO RECORRENTE.
 *
 * Contexto medido (2026-10-09 x2, 2026-10-20): o worktree foi encontrado três
 * vezes com dezenas de arquivos "modificados" que eram cópias DEGRADADAS de
 * HEAD — guardas apagadas, funções reimplementadas e casos de teste removidos.
 * A suíte continuava verde justamente porque os testes que reprovariam a perda
 * tinham sido apagados junto.
 *
 * Estes testes constroem repositórios git reais em diretório temporário: a
 * guarda precisa ser medida contra `git diff`, nunca contra uma simulação.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { evaluateWorktree, isProtected } = require('../../../governance/worktree-integrity');

function sh(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-integrity-'));
  sh(dir, ['init', '-q']);
  sh(dir, ['config', 'user.email', 'guard@test.local']);
  sh(dir, ['config', 'user.name', 'Guard Test']);
  sh(dir, ['config', 'commit.gpgsign', 'false']);
  return dir;
}

function write(cwd, relPath, content) {
  const abs = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function commitAll(cwd, message = 'base') {
  sh(cwd, ['add', '-A']);
  sh(cwd, ['commit', '-q', '-m', message]);
}

function codesOf(report) {
  return report.violations.map((v) => v.code);
}

describe('guarda de integridade do worktree', () => {
  let dirs;

  beforeEach(() => {
    dirs = [];
  });

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function repo() {
    const dir = makeRepo();
    dirs.push(dir);
    return dir;
  }

  test('worktree idêntico à base é PASS', () => {
    const dir = repo();
    write(dir, 'tests/unit/exemplo.test.js', "it('existe', () => {});\n");
    commitAll(dir);

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('PASS');
    expect(report.filesChanged).toBe(0);
  });

  test('mudança legítima (adiciona função e teste) continua PASS', () => {
    const dir = repo();
    write(dir, 'lib/calculo.js', "function soma(a, b) {\n  return a + b;\n}\nmodule.exports = { soma };\n");
    write(dir, 'tests/unit/calculo.test.js', "const { soma } = require('../../lib/calculo');\nit('soma', () => { expect(soma(1, 2)).toBe(3); });\n");
    commitAll(dir);

    write(dir, 'lib/calculo.js', "function soma(a, b) {\n  return a + b;\n}\nfunction subtrai(a, b) {\n  return a - b;\n}\nmodule.exports = { soma, subtrai };\n");
    write(dir, 'tests/unit/calculo.test.js', "const { soma, subtrai } = require('../../lib/calculo');\nit('soma', () => { expect(soma(1, 2)).toBe(3); });\nit('subtrai', () => { expect(subtrai(3, 1)).toBe(2); });\n");

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('PASS');
    expect(report.filesChanged).toBe(2);
  });

  test('teste removido reprova com TEST_CASE_REMOVAL (o falso verde clássico)', () => {
    const dir = repo();
    write(dir, 'tests/unit/alvo.test.js', "it('a', () => {});\nit('b', () => {});\nit('c', () => {});\n");
    commitAll(dir);

    write(dir, 'tests/unit/alvo.test.js', "it('a', () => {});\n");

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('FAIL');
    expect(codesOf(report)).toContain('TEST_CASE_REMOVAL');
    const violation = report.violations.find((v) => v.code === 'TEST_CASE_REMOVAL');
    expect(violation.removedTests).toBe(2);
    expect(violation.addedTests).toBe(0);
  });

  test('função de escopo de módulo removida reprova com SYMBOL_REMOVAL', () => {
    const dir = repo();
    write(dir, 'api/servico.js', 'function carregarCredencial() {\n  return 1;\n}\nfunction outra() {\n  return 2;\n}\nmodule.exports = { carregarCredencial, outra };\n');
    commitAll(dir);

    write(dir, 'api/servico.js', 'function outra() {\n  return 2;\n}\nmodule.exports = { outra };\n');

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('FAIL');
    expect(codesOf(report)).toContain('SYMBOL_REMOVAL');
    const violation = report.violations.find((v) => v.code === 'SYMBOL_REMOVAL');
    expect(violation.symbols).toContain('carregarCredencial');
  });

  test('variável local removida NÃO vira violação (ruído destrói a guarda)', () => {
    const dir = repo();
    write(dir, 'lib/funcao.js', 'function run() {\n  const transitorio = 1;\n  const streak = 2;\n  return transitorio + streak;\n}\nmodule.exports = { run };\n');
    commitAll(dir);

    write(dir, 'lib/funcao.js', 'function run() {\n  return 3;\n}\nmodule.exports = { run };\n');

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('PASS');
  });

  test('deleção pura em caminho protegido reprova com PURE_DELETION', () => {
    const dir = repo();
    const body = Array.from({ length: 30 }, (_, i) => `const linha${i} = ${i};`).join('\n');
    write(dir, 'governance/guardas.js', `${body}\nmodule.exports = { linha0 };\n`);
    commitAll(dir);

    // Mantém a linha final idêntica: o diff vira deleção PURA (nenhuma adição),
    // que é a assinatura exata do worktree mutilado.
    write(dir, 'governance/guardas.js', 'module.exports = { linha0 };\n');

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('FAIL');
    expect(codesOf(report)).toContain('PURE_DELETION');
  });

  test('arquivo protegido apagado reprova com FILE_DELETED', () => {
    const dir = repo();
    write(dir, 'tests/unit/importante.test.js', "it('guarda', () => {});\n");
    commitAll(dir);

    fs.rmSync(path.join(dir, 'tests/unit/importante.test.js'));

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('FAIL');
    expect(codesOf(report)).toContain('FILE_DELETED');
  });

  test('diff dominado por deleção reprova com DELETION_DOMINANT', () => {
    const dir = repo();
    const body = Array.from({ length: 150 }, (_, i) => `const valor${i} = ${i};`).join('\n');
    write(dir, 'lib/grande.js', `${body}\n`);
    commitAll(dir);

    write(dir, 'lib/grande.js', 'const valor0 = 0;\n');

    const report = evaluateWorktree({ cwd: dir, baseRef: 'HEAD' });
    expect(report.verdict).toBe('FAIL');
    expect(codesOf(report)).toContain('DELETION_DOMINANT');
  });

  test('waiver COM motivo move a violação para waived e libera', () => {
    const dir = repo();
    write(dir, 'tests/unit/alvo.test.js', "it('a', () => {});\nit('b', () => {});\n");
    commitAll(dir);
    write(dir, 'tests/unit/alvo.test.js', "it('a', () => {});\n");

    const report = evaluateWorktree({
      cwd: dir,
      baseRef: 'HEAD',
      waiver: [{ path: 'tests/unit/alvo.test.js', reason: 'teste obsoleto removido em deprecacao aprovada' }],
    });

    expect(report.verdict).toBe('PASS');
    expect(report.violations).toHaveLength(0);
    expect(report.waived).toHaveLength(1);
    expect(report.waived[0].waiverReason).toContain('deprecacao aprovada');
  });

  test('waiver SEM motivo é ignorado (fail-closed)', () => {
    const dir = repo();
    write(dir, 'tests/unit/alvo.test.js', "it('a', () => {});\nit('b', () => {});\n");
    commitAll(dir);
    write(dir, 'tests/unit/alvo.test.js', "it('a', () => {});\n");

    const report = evaluateWorktree({
      cwd: dir,
      baseRef: 'HEAD',
      waiver: [{ path: 'tests/unit/alvo.test.js', reason: '' }],
    });

    expect(report.verdict).toBe('FAIL');
    expect(report.waived).toHaveLength(0);
  });

  test('classificação de caminho protegido', () => {
    expect(isProtected('tests/unit/x.test.js')).toBe(true);
    expect(isProtected('scripts/governance/gate.js')).toBe(true);
    expect(isProtected('governance/proof-engine/index.js')).toBe(true);
    expect(isProtected('jest.config.cjs')).toBe(true);
    expect(isProtected('frontend/src/pages/Pagina.jsx')).toBe(false);
    expect(isProtected('lib/util.js')).toBe(false);
  });
});
