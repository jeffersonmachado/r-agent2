'use strict';

/**
 * Prova BIDIRECIONAL do gravador de checkpoint (`tools/audit/checkpoint.js`):
 *
 *  - direção 1: teste verde  => checkpoint é escrito;
 *  - direção 2: teste vermelho => checkpoint é RECUSADO e o arquivo NÃO é tocado.
 *
 * A direção 2 é a que importa: sem ela o gravador poderia "registrar sucesso" a
 * partir de teste falho, ou seja, fabricar evidência — exatamente o que o
 * checkpoint existe para impedir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const FERRAMENTA = path.join(RAIZ, 'tools/audit/checkpoint.js');
const EVIDENCIA = path.join(RAIZ, 'AI_MEMORY/evidence/checkpoints.md');

/** Roda a ferramenta num diretório temporário que imita um repo git. */
function rodarEmSandbox({ testes }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ckpt-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
  fs.mkdirSync(path.join(dir, 'AI_MEMORY/evidence'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['commit', '-qm', 'base'], { cwd: dir });
  spawnSync('git', ['checkout', '-qb', 'dev/engineering-hardening'], { cwd: dir });

  // A ferramenta resolve ROOT como `__dirname/../..`, então precisa viver em
  // tools/audit/ dentro do sandbox: cópia real, sem shim.
  fs.mkdirSync(path.join(dir, 'tools/audit'), { recursive: true });
  fs.copyFileSync(FERRAMENTA, path.join(dir, 'tools/audit/checkpoint.js'));

  const cli = [path.join(dir, 'tools/audit/checkpoint.js'), '--title', 'probe', '--problem', 'probe'];
  for (const t of testes) cli.push('--tests', t);
  const r = spawnSync(process.execPath, cli, { cwd: dir, encoding: 'utf8' });

  const destino = path.join(dir, 'AI_MEMORY/evidence/checkpoints.md');
  return { dir, exitCode: r.status, stdout: r.stdout || '', stderr: r.stderr || '', destino, existe: fs.existsSync(destino) };
}

describe('tools/audit/checkpoint.js — prova bidirecional', () => {
  test('teste verde => escreve o checkpoint com o commit-base e os testes executados', () => {
    const r = rodarEmSandbox({ testes: ['node -e "process.exit(0)"'] });
    expect(r.exitCode).toBe(0);
    expect(r.existe).toBe(true);
    const conteudo = fs.readFileSync(r.destino, 'utf8');
    expect(conteudo).toContain('## CKPT ');
    // O título informado é registrado; a FLAG de CLI não é (não é conteúdo).
    expect(conteudo).toContain('— probe');
    expect(conteudo).toMatch(/\| `node -e "process\.exit\(0\)"` \| 0 \|/);
    expect(conteudo).toContain('SHA de base');
    expect(conteudo).toContain('Problema corrigido');
    fs.rmSync(r.dir, { recursive: true, force: true });
  });

  test('teste VERMELHO => recusa e NÃO escreve nada (impossível fabricar checkpoint verde)', () => {
    const r = rodarEmSandbox({ testes: ['node -e "process.exit(3)"'] });
    expect(r.exitCode).toBe(1);
    expect(r.existe).toBe(false);
    expect(r.stderr).toContain('RECUSADO');
    expect(r.stderr).toContain('Nada foi escrito');
    fs.rmSync(r.dir, { recursive: true, force: true });
  });

  test('misto (um verde e um vermelho) => recusa: basta um vermelho', () => {
    const r = rodarEmSandbox({ testes: ['node -e "process.exit(0)"', 'node -e "process.exit(1)"'] });
    expect(r.exitCode).toBe(1);
    expect(r.existe).toBe(false);
    fs.rmSync(r.dir, { recursive: true, force: true });
  });

  test('sem --tests => recusa (checkpoint sem teste não é checkpoint)', () => {
    const r = rodarEmSandbox({ testes: [] });
    expect(r.exitCode).toBe(2);
    expect(r.existe).toBe(false);
    expect(r.stderr).toContain('checkpoint sem teste');
    fs.rmSync(r.dir, { recursive: true, force: true });
  });

  test('o arquivo de evidência real do repositorio nao e tocado por esta suite', () => {
    // Guarda: a prova roda em sandbox; se algum teste escrevesse no arquivo
    // versionado, o worktree ficaria sujo sem que o autor percebesse.
    const antes = fs.existsSync(EVIDENCIA) ? fs.readFileSync(EVIDENCIA, 'utf8') : null;
    const r = rodarEmSandbox({ testes: ['node -e "process.exit(0)"'] });
    fs.rmSync(r.dir, { recursive: true, force: true });
    const depois = fs.existsSync(EVIDENCIA) ? fs.readFileSync(EVIDENCIA, 'utf8') : null;
    expect(depois).toBe(antes);
  });
});
