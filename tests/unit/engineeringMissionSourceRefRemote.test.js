'use strict';

/**
 * Regressão da resolução da LINHA PRINCIPAL usada como fonte da missão.
 *
 * Defeito real medido no CI (run 39585223390, job "Integração real do Engenheiro"): 21 de 40
 * suítes reprovaram com `não foi possível resolver o commit de origem "main"` (44 ocorrências).
 * A causa é a suposição de que a linha principal existe como branch LOCAL. Num checkout de CI
 * (e em clone raso / worktree destacado) ela pode existir apenas como `refs/remotes/origin/main`
 * — o commit existe no repositório, mas `rev-parse main` falha.
 *
 * O que este arquivo trava:
 *  1. `readMainCommit` resolve o commit quando ele só existe como ref RASTREADA;
 *  2. continua FAIL-CLOSED: ref inexistente em qualquer forma devolve `null` (nada de inventar
 *     commit, nada de assumir HEAD);
 *  3. o ref local tem precedência sobre o rastreado (a linha principal local é a verdade quando
 *     ela existe).
 *
 * O repositório de prova é REAL: um `origin` bare + um clone raso sem a branch local.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const missionSourceService = require('../../api/services/engineeringMission/missionSourceService');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

describe('readMainCommit — fonte da missão quando a linha principal só existe no remoto', () => {
  let raiz = null;
  let originBare = null;
  let clone = null;
  let commitMain = null;

  beforeAll(() => {
    raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-source-refs-'));
    originBare = path.join(raiz, 'origin.git');
    const trabalho = path.join(raiz, 'trabalho');
    clone = path.join(raiz, 'clone-raso');

    git(raiz, 'init', '--bare', '-q', originBare);
    git(raiz, 'init', '-q', trabalho);
    git(trabalho, 'config', 'user.email', 'teste@example.invalid');
    git(trabalho, 'config', 'user.name', 'teste');
    git(trabalho, 'checkout', '-q', '-b', 'main');
    fs.writeFileSync(path.join(trabalho, 'arquivo.txt'), 'conteudo\n');
    git(trabalho, 'add', 'arquivo.txt');
    git(trabalho, 'commit', '-q', '-m', 'commit da linha principal');
    commitMain = git(trabalho, 'rev-parse', 'HEAD');
    git(trabalho, 'remote', 'add', 'origin', originBare);
    git(trabalho, 'push', '-q', 'origin', 'main');
    // O bare nasce com HEAD em `master`; apontar para `main` é o que faz o clone raso
    // materializar `refs/remotes/origin/main` (como no GitHub, cuja linha principal é `main`).
    git(originBare, 'symbolic-ref', 'HEAD', 'refs/heads/main');

    // Clone RASO com uma branch qualquer: NÃO cria `main` local, só `origin/main`.
    git(raiz, 'clone', '--depth=1', '-q', originBare, clone);
    git(clone, 'checkout', '-q', '-b', 'dev/engineering-hardening');
    // Apaga a branch local `main` para reproduzir o clone de CI (só a ref rastreada sobrevive).
    git(clone, 'branch', '-q', '-D', 'main');
    expect(() => git(clone, 'rev-parse', '--verify', 'refs/heads/main')).toThrow();
    expect(git(clone, 'rev-parse', '--verify', 'refs/remotes/origin/main')).toBe(commitMain);
  });

  afterAll(() => {
    if (raiz) fs.rmSync(raiz, { recursive: true, force: true });
  });

  it('resolve o commit a partir de origin/main quando não existe branch local', async () => {
    await expect(missionSourceService.readMainCommit('main', { cwd: clone })).resolves.toBe(commitMain);
  });

  it('fail-closed: ref que não existe em nenhuma forma devolve null', async () => {
    await expect(missionSourceService.readMainCommit('linha-inexistente', { cwd: clone })).resolves.toBeNull();
  });

  it('a branch local tem PRECEDÊNCIA quando existe (não troca a verdade local pelo remoto)', async () => {
    // Avança a main local em um commit que o remoto não tem.
    const trabalho2 = path.join(raiz, 'trabalho2');
    git(raiz, 'clone', '-q', originBare, trabalho2);
    git(trabalho2, 'config', 'user.email', 'teste@example.invalid');
    git(trabalho2, 'config', 'user.name', 'teste');
    fs.writeFileSync(path.join(trabalho2, 'outro.txt'), 'x\n');
    git(trabalho2, 'add', 'outro.txt');
    git(trabalho2, 'commit', '-q', '-m', 'commit local nao empurrado');
    const commitLocal = git(trabalho2, 'rev-parse', 'HEAD');
    expect(commitLocal).not.toBe(commitMain);
    git(trabalho2, 'checkout', '-q', '-b', 'dev/x');
    await expect(missionSourceService.readMainCommit('main', { cwd: trabalho2 })).resolves.toBe(commitLocal);
  });
});
