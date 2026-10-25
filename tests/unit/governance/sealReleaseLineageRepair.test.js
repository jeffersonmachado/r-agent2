'use strict';

/**
 * P1 — REPARO DE LINEAGE NO SELO: ALLOWLIST, NUNCA `git add -A` (missão 2026-10-25 §5).
 *
 * DEFEITO MEDIDO em `scripts/governance/seal-release.sh` (`phase_verify_delivery`): quando o juiz
 * estrito reprovava a entrega, o reparo executava
 *
 *     node scripts/governance/stamp-report-lineage.js
 *     git add -A
 *     git commit -m "fix(governance): re-stampa lineage clobberado pela varredura agregada"
 *     git push origin "$branch_atual"
 *
 * Todo o conteúdo sujo do worktree entrava num commit com mensagem de reparo de lineage e era
 * empurrado. Os testes abaixo cobrem a decisão (unidade) e o comportamento em repositório git REAL
 * com remoto local descartável (integração) — nada toca o remoto de verdade.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  avaliarWorktreeParaReparo,
  parseStatusPorcelain,
  listarAllowlistDeReparo,
} = require('../../../scripts/governance/lib/lineage-repair');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const SELO = path.join(RAIZ, 'scripts', 'governance', 'seal-release.sh');

const ALLOW = ['governance/final-proof-report.json', 'governance/final-readiness-report.json', 'governance/.current-run.json'];

describe('reparo de lineage — decisão por allowlist (unidade)', () => {
  test('worktree sujo com arquivo NÃO autorizado ⇒ recusa nomeada e nada staged', () => {
    const status = [
      ' M governance/final-proof-report.json',
      ' M api/services/algo.js',
    ].join('\n');
    const d = avaliarWorktreeParaReparo(status, ALLOW);
    expect(d.ok).toBe(false);
    expect(d.staged).toBe(false);
    expect(d.motivo).toContain('WORKTREE_COM_ARQUIVO_NAO_AUTORIZADO');
    expect(d.naoAutorizados).toEqual(['api/services/algo.js']);
  });

  test('somente arquivos da allowlist sujos ⇒ permite reparo e informa o que commitar', () => {
    const status = [' M governance/final-proof-report.json', ' M governance/.current-run.json'].join('\n');
    const d = avaliarWorktreeParaReparo(status, ALLOW);
    expect(d.ok).toBe(true);
    expect(d.staged).toBe(true);
    expect(d.paraCommitar).toEqual(['governance/.current-run.json', 'governance/final-proof-report.json']);
  });

  test('worktree limpo ⇒ NADA_A_REPARAR (sem commit vazio)', () => {
    const d = avaliarWorktreeParaReparo('', ALLOW);
    expect(d).toEqual({ ok: true, motivo: 'NADA_A_REPARAR', naoAutorizados: [], paraCommitar: [], staged: false });
  });

  test('arquivo NÃO rastreado nunca é autorizado, mesmo com nome parecido', () => {
    const d = avaliarWorktreeParaReparo('?? governance/final-proof-report.json.bak', ALLOW);
    expect(d.ok).toBe(false);
    expect(d.naoAutorizados).toEqual(['governance/final-proof-report.json.bak']);
  });

  test('rename conta os DOIS lados (origem e destino precisam ser autorizados)', () => {
    const d = avaliarWorktreeParaReparo('R  governance/antigo.json -> governance/final-proof-report.json', ALLOW);
    expect(d.ok).toBe(false);
    expect(d.naoAutorizados).toContain('governance/antigo.json');
  });

  test('parseStatusPorcelain ignora linhas vazias e preserva espaços em nomes', () => {
    expect(parseStatusPorcelain('\n M arquivo com espaço.json\n')).toEqual([
      { status: ' M', caminho: 'arquivo com espaço.json' },
    ]);
  });

  test('allowlist deriva da MESMA taxonomia canônica e inclui o ponteiro do run', () => {
    const lista = listarAllowlistDeReparo();
    expect(lista.length).toBeGreaterThan(10);
    expect(lista).toContain('governance/.current-run.json');
    const { listAuthoritativeArtifacts } = require('../../../scripts/governance/lib/runtime-evidence-artifacts');
    for (const artefato of listAuthoritativeArtifacts()) expect(lista).toContain(artefato);
  });
});

describe('reparo de lineage — comportamento em repositório git real (remoto local descartável)', () => {
  let tmp;
  let work;
  let remoto;

  const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  // `status --porcelain` NÃO pode passar por trim: o espaço à esquerda faz parte do formato XY.
  const gitBruto = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seal-repair-'));
    remoto = path.join(tmp, 'remoto.git');
    git(tmp, ['init', '--bare', '-q', remoto]);
    work = path.join(tmp, 'work');
    fs.mkdirSync(work, { recursive: true });
    git(work, ['init', '-q']);
    git(work, ['config', 'user.email', 'teste@exemplo.invalid']);
    git(work, ['config', 'user.name', 'Teste']);
    git(work, ['remote', 'add', 'origin', remoto]);
    git(work, ['checkout', '-q', '-b', 'dev/teste']);

    fs.mkdirSync(path.join(work, 'governance'), { recursive: true });
    fs.writeFileSync(path.join(work, 'governance', 'final-proof-report.json'), '{"v":1}\n');
    fs.writeFileSync(path.join(work, 'api.js'), 'module.exports = 1;\n');
    git(work, ['add', '.']);
    git(work, ['commit', '-q', '-m', 'base']);
    git(work, ['push', '-q', '-u', 'origin', 'dev/teste']);
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  /** Executa o MESMO procedimento do selo (allowlist + stage seletivo + commit + push da branch atual). */
  function repararComoNoSelo() {
    const status = gitBruto(work, ['status', '--porcelain=v1']);
    const decisao = avaliarWorktreeParaReparo(status, ['governance/final-proof-report.json', 'governance/.current-run.json']);
    if (!decisao.ok || !decisao.staged) return { decisao, commitou: false, push: false };
    for (const caminho of decisao.paraCommitar) git(work, ['add', '--', caminho]);
    if (git(work, ['diff', '--cached', '--name-only']) === '') return { decisao, commitou: false, push: false };
    git(work, ['commit', '-q', '-m', 'fix(governance): re-stampa lineage']);
    const branch = git(work, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch !== 'main' && branch !== 'master' && branch !== 'HEAD') git(work, ['push', '-q', 'origin', branch]);
    return { decisao, commitou: true, push: true };
  }

  test('arquivo NÃO autorizado sujo ⇒ nenhum commit, remoto intacto', () => {
    const antes = git(remoto, ['rev-parse', 'dev/teste']);
    fs.appendFileSync(path.join(work, 'governance', 'final-proof-report.json'), '{"v":2}\n');
    fs.appendFileSync(path.join(work, 'api.js'), 'module.exports = 2;\n');

    const r = repararComoNoSelo();
    expect(r.decisao.ok).toBe(false);
    expect(r.commitou).toBe(false);
    expect(git(remoto, ['rev-parse', 'dev/teste'])).toBe(antes);

    // limpa o arquivo não autorizado para o próximo cenário
    git(work, ['checkout', '--', 'api.js']);
  });

  test('somente allowlist suja ⇒ commit toca APENAS o arquivo autorizado e o remoto avança', () => {
    const antes = git(remoto, ['rev-parse', 'dev/teste']);
    const r = repararComoNoSelo();
    expect(r.decisao.ok).toBe(true);
    expect(r.commitou).toBe(true);

    const arquivosDoCommit = git(work, ['show', '--name-only', '--pretty=format:', 'HEAD']).split('\n').filter(Boolean);
    expect(arquivosDoCommit).toEqual(['governance/final-proof-report.json']);
    expect(git(remoto, ['rev-parse', 'dev/teste'])).not.toBe(antes);
  });

  test('reparo nunca empurra `main` — só a branch corrente', () => {
    const executaveis = fs.readFileSync(SELO, 'utf8')
      .split('\n')
      .filter((linha) => !linha.trim().startsWith('#'))
      .join('\n');
    expect(executaveis).not.toMatch(/git push origin main/);
    expect(executaveis).toContain('git push origin "$branch_atual"');
  });

  test('o selo não usa mais `git add -A` no reparo e delega a allowlist ao helper', () => {
    const fonte = fs.readFileSync(SELO, 'utf8');
    // `phase_verify_delivery` é a ÚLTIMA fase do arquivo (vem depois de phase_publish/consolidate/
    // certify), então o recorte vai dela até o fim do script.
    const trecho = fonte.slice(fonte.indexOf('phase_verify_delivery()'))
      .split('\n')
      .filter((linha) => !linha.trim().startsWith('#'))
      .join('\n');
    expect(trecho).not.toContain('git add -A');
    expect(trecho).toContain('lineage-repair.js');
    expect(trecho).toContain('git add --');
  });
});
