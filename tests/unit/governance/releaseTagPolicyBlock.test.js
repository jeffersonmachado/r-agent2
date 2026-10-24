'use strict';

/**
 * `create-release-tag.sh` — bloqueio de POLÍTICA ≠ erro real.
 *
 * DEFEITO MEDIDO (2026-10-13): durante o ciclo `release:seal`, a fase `publish`
 * abortou com `✗ criação da tag falhou` (SEAL_EXIT=1). O log revelava a causa real
 * só para quem fosse lê-lo:
 *   `[guard-local] push de TAG bloqueado: refs/tags/… (autorizado apenas push de commits)`
 * Isto é o hook `.git/hooks/pre-push` do clone recusando push de tags — política
 * deliberada do repositório (o `AGENTS.md` diz que a tag é criada FORA do pipeline,
 * nunca com push automatizado). A mensagem genérica mandava procurar defeito de rede
 * ou permissão, quando o que faltava era uma DECISÃO HUMANA.
 *
 * O teste roda o script REAL contra um repositório temporário com um remote bare e
 * um hook `pre-push` que recusa tags — sem tocar no repositório de trabalho.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'create-release-tag.sh');
const TAG = 'r-agent2-test-tag';

/** Cria um repo temporário com 1 commit, um remote bare e o hook pedido. */
function montarCenario({ hookBloqueiaTag }) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-tag-'));
  const repo = path.join(base, 'repo');
  const remote = path.join(base, 'remote.git');
  fs.mkdirSync(repo);

  const git = (args, cwd = repo) => execFileSync('git', args, {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  });

  git(['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  git(['add', 'a.txt']);
  git(['commit', '-q', '-m', 'inicial']);
  const commit = git(['rev-parse', 'HEAD']).trim();

  execFileSync('git', ['init', '-q', '--bare', remote]);
  git(['remote', 'add', 'origin', remote]);

  if (hookBloqueiaTag) {
    const hooksDir = path.join(repo, '.git', 'hooks');
    fs.mkdirSync(hooksDir, { recursive: true });
    const hook = path.join(hooksDir, 'pre-push');
    fs.writeFileSync(hook, [
      '#!/usr/bin/env bash',
      'while read -r local_ref local_sha remote_ref remote_sha; do',
      '  [ -z "$remote_ref" ] && continue',
      '  case "$remote_ref" in',
      '    refs/tags/*)',
      '      echo "[guard-local] push de TAG bloqueado: $remote_ref (autorizado apenas push de commits)" >&2',
      '      exit 1',
      '      ;;',
      '  esac',
      'done',
      'exit 0',
      '',
    ].join('\n'));
    fs.chmodSync(hook, 0o755);
  }

  return { base, repo, remote, commit };
}

/**
 * O cenário usa um remote BARE em filesystem (não publica nada). Desde a Fase 3 o porteiro de
 * publicação exige autorização + GO DEFINITIVO por padrão, e a única dispensa é o modo local de
 * teste EXPLÍCITO (`RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW` = caminho exato do destino de push).
 * Isso é declarado aqui — antes a dispensa era implícita (heurística de URL), o que foi contornado.
 */
function rodarScript(cenario) {
  const r = spawnSync('bash', [SCRIPT, TAG, cenario.commit], {
    cwd: cenario.repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      RAP_RELEASE_TAG_REMOTE: 'origin',
      RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW: cenario.remote,
      CI: '',
      NODE_ENV: 'test',
    },
  });
  return { status: r.status, saida: `${r.stdout || ''}${r.stderr || ''}` };
}

function limpar(cenario) {
  fs.rmSync(cenario.base, { recursive: true, force: true });
}

describe('create-release-tag.sh — bloqueio de política versus erro real', () => {
  it('hook que bloqueia tags: exit 3 com mensagem ACIONÁVEL (não "erro de push")', () => {
    const cenario = montarCenario({ hookBloqueiaTag: true });
    try {
      const { status, saida } = rodarScript(cenario);
      expect(status).toBe(3);
      expect(saida).toContain('BLOQUEIO DE POLITICA LOCAL');
      expect(saida).toContain('NAO e erro de rede nem de permissao');
      // A mensagem precisa entregar o comando exato, senão o operador adivinha.
      expect(saida).toContain(`git push --no-verify origin refs/tags/${TAG}`);
      expect(saida).toContain('seal-release.sh --from publish');
      // E precisa deixar claro que a tag LOCAL já existe (nada foi perdido).
      expect(saida).toContain('JA EXISTE localmente');
      // A tag local realmente foi criada antes do push — o trabalho não se perde.
      const tagLocal = execFileSync('git', ['rev-parse', `${TAG}^{}`], { cwd: cenario.repo, encoding: 'utf8' }).trim();
      expect(tagLocal).toBe(cenario.commit);
    } finally {
      limpar(cenario);
    }
  });

  it('CONTROLE: sem o bloqueio, o caminho feliz publica e sai 0 (o gate não ficou sempre-vermelho)', () => {
    const cenario = montarCenario({ hookBloqueiaTag: false });
    try {
      const { status, saida } = rodarScript(cenario);
      expect(status).toBe(0);
      expect(saida).toContain('concluído');
      const remoteTag = execFileSync('git', ['ls-remote', '--tags', 'origin'], { cwd: cenario.repo, encoding: 'utf8' });
      expect(remoteTag).toContain(TAG);
      expect(remoteTag).toContain(cenario.commit);
    } finally {
      limpar(cenario);
    }
  });

  it('idempotência: rodar de novo com a tag já no remote sai 0 sem empurrar nada', () => {
    const cenario = montarCenario({ hookBloqueiaTag: false });
    try {
      expect(rodarScript(cenario).status).toBe(0);
      const segunda = rodarScript(cenario);
      expect(segunda.status).toBe(0);
      expect(segunda.saida).toContain('idempotente');
    } finally {
      limpar(cenario);
    }
  });

  it('o script documenta os TRÊS códigos de saída (0/1/3) — o 3 é contrato, não acidente', () => {
    const codigo = fs.readFileSync(SCRIPT, 'utf8');
    expect(codigo).toContain('Exit 3 = BLOQUEIO DE POLITICA LOCAL');
    expect(codigo).toContain('exit 3');
  });
});
