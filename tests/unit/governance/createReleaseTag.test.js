'use strict';

/**
 * Testes do script de tag imutável de release (scripts/create-release-tag.sh)
 * contra um repo git temporário com remote BARE local (sem rede):
 *
 *   - tag nova → criada (anotada) e pushada, target == commit;
 *   - re-run com o mesmo commit → idempotente, sucesso sem recriar;
 *   - tag existente apontando para OUTRO commit → RELEASE_TAG_CONFLICT (exit 1);
 *   - commit default resolvido do dist/release/*.manifest.json mais recente.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'create-release-tag.sh');

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * O cenário usa um remote BARE em filesystem (não publica nada). Desde a Fase 3 o porteiro exige
 * autorização + GO DEFINITIVO por padrão; a única dispensa é o modo local de teste EXPLÍCITO
 * (`RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW` = caminho exato do destino de push configurado).
 */
function runScript(cwd, args) {
  const remoteBare = path.join(path.dirname(cwd), 'remote.git');
  const result = spawnSync('bash', [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    // `GIT_CONFIG_COUNT=0` descarta injeção de configuração git do processo pai (o porteiro a recusa).
    env: { ...process.env, RAP_RELEASE_TAG_LOCAL_REMOTE_ALLOW: remoteBare, CI: '', NODE_ENV: 'test', GIT_CONFIG_COUNT: '0' },
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function remoteTagTarget(work, tag) {
  // ls-remote do remote bare; deref ^{} tem prioridade (tag anotada).
  const out = git(work, ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  let target = null;
  for (const line of out.split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    if (ref === `refs/tags/${tag}^{}`) target = sha;
    else if (ref === `refs/tags/${tag}` && !target) target = sha;
  }
  return target;
}

describe('create-release-tag.sh — tag imutável de release (repo temporário, remote bare)', () => {
  let dir;
  let work;
  let commit1;
  let commit2;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-release-tag-'));
    execFileSync('git', ['init', '--bare', path.join(dir, 'remote.git')], { stdio: 'ignore' });
    work = path.join(dir, 'work');
    execFileSync('git', ['init', work], { stdio: 'ignore' });
    git(work, ['config', 'user.email', 'qa@example.com']);
    git(work, ['config', 'user.name', 'QA Bot']);
    fs.writeFileSync(path.join(work, 'file.txt'), 'v1\n');
    git(work, ['add', 'file.txt']);
    git(work, ['commit', '-m', 'commit 1']);
    commit1 = git(work, ['rev-parse', 'HEAD']);
    git(work, ['remote', 'add', 'origin', path.join(dir, 'remote.git')]);
    git(work, ['push', 'origin', 'HEAD:refs/heads/main']);
    fs.writeFileSync(path.join(work, 'file.txt'), 'v2\n');
    git(work, ['add', 'file.txt']);
    git(work, ['commit', '-m', 'commit 2']);
    commit2 = git(work, ['rev-parse', 'HEAD']);
    git(work, ['push', 'origin', 'HEAD:refs/heads/main']);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('tag nova → tag anotada criada e pushada, target == commit', () => {
    const result = runScript(work, ['rel-1', commit1]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('tag anotada rel-1 criada');
    expect(remoteTagTarget(work, 'rel-1')).toBe(commit1);
    // Tag ANOTADA: o objeto local é do tipo 'tag', não 'commit'.
    expect(git(work, ['cat-file', '-t', 'refs/tags/rel-1'])).toBe('tag');
  });

  test('re-run com o mesmo commit → idempotente (exit 0, sem recriar)', () => {
    const result = runScript(work, ['rel-1', commit1]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('idempotente');
    expect(remoteTagTarget(work, 'rel-1')).toBe(commit1);
  });

  test('tag existente apontando para OUTRO commit → RELEASE_TAG_CONFLICT (exit 1)', () => {
    const result = runScript(work, ['rel-1', commit2]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('RELEASE_TAG_CONFLICT');
    // Tag remota intacta (imutável): ainda aponta para o commit original.
    expect(remoteTagTarget(work, 'rel-1')).toBe(commit1);
  });

  test('commit omitido → resolvido do dist/release/*.manifest.json mais recente', () => {
    const releaseDir = path.join(work, 'dist', 'release');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(releaseDir, 'r-agent2-20260908-000000.manifest.json'),
      JSON.stringify({ git_commit: commit2 }),
    );
    const result = runScript(work, ['rel-2']);
    expect(result.status).toBe(0);
    expect(result.output).toContain(`commit resolvido do manifest`);
    expect(remoteTagTarget(work, 'rel-2')).toBe(commit2);
  });

  test('conflito LOCAL: tag local em outro commit (remote sem a tag) → RELEASE_TAG_CONFLICT', () => {
    git(work, ['tag', '-a', 'rel-3', commit1, '-m', 'tag local conflitante']);
    const result = runScript(work, ['rel-3', commit2]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('RELEASE_TAG_CONFLICT');
  });

  test('commit malformado → exit 1', () => {
    const result = runScript(work, ['rel-4', 'abc123']);
    expect(result.status).toBe(1);
    expect(result.output).toContain('malformado');
  });
});

/**
 * VÍNCULO DE CONTEÚDO (defeito medido em 2026-11-04, release r-agent2-20261104-000924).
 *
 * O guard comparava o SHA BRUTO do commit tagueado com `sourceCommit` do run. O ciclo
 * canônico, porém, produz commits de EVIDÊNCIA depois de congelar o run (converge →
 * selo → packaging) sem tocar a superfície provada, então o `sourceFingerprint`
 * permanece idêntico — e a tag do PRÓPRIO caminho oficial era recusada.
 *
 * A regra correta: o commit tagueado pode avançar o run APENAS se o fingerprint de
 * conteúdo for o mesmo; fingerprint diferente continua recusado (fail-closed).
 */
describe('create-release-tag.sh — vínculo por sourceFingerprint (não por sha bruto)', () => {
  let dir;
  let work;
  let runCommit;
  let evidenceCommit;
  let otherCommit;
  let runFingerprint;

  function fingerprintAt(commit) {
    return execFileSync(
      process.execPath,
      [path.join(__dirname, '..', '..', '..', 'scripts', 'governance', 'source-fingerprint-at-commit.js'), commit],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  }

  function writeRunContext(sourceCommit, sourceFingerprint) {
    fs.mkdirSync(path.join(work, 'governance'), { recursive: true });
    fs.writeFileSync(
      path.join(work, 'governance', '.current-run.json'),
      `${JSON.stringify({ runId: 'rap-governed-test', sourceCommit, sourceFingerprint }, null, 2)}\n`,
    );
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-release-tag-fp-'));
    execFileSync('git', ['init', '--bare', path.join(dir, 'remote.git')], { stdio: 'ignore' });
    work = path.join(dir, 'work');
    execFileSync('git', ['init', work], { stdio: 'ignore' });
    git(work, ['config', 'user.email', 'qa@example.com']);
    git(work, ['config', 'user.name', 'QA Bot']);
    git(work, ['remote', 'add', 'origin', path.join(dir, 'remote.git')]);

    // `lib/` é uma SOURCE_ROOT do fingerprint-chain: muda o fingerprint.
    fs.mkdirSync(path.join(work, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(work, 'lib', 'mod.js'), "'use strict';\nmodule.exports = 1;\n");
    git(work, ['add', 'lib/mod.js']);
    git(work, ['commit', '-m', 'run source']);
    runCommit = git(work, ['rev-parse', 'HEAD']);
    runFingerprint = fingerprintAt(runCommit);

    // Commit SÓ de evidência: fora da superfície provada ⇒ fingerprint idêntico.
    fs.mkdirSync(path.join(work, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(work, 'reports', 'evidence.json'), '{"pass":true}\n');
    git(work, ['add', 'reports/evidence.json']);
    git(work, ['commit', '-m', 'evidence only']);
    evidenceCommit = git(work, ['rev-parse', 'HEAD']);

    // Commit que ALTERA a fonte provada ⇒ fingerprint diferente.
    fs.writeFileSync(path.join(work, 'lib', 'mod.js'), "'use strict';\nmodule.exports = 2;\n");
    git(work, ['add', 'lib/mod.js']);
    git(work, ['commit', '-m', 'source change']);
    otherCommit = git(work, ['rev-parse', 'HEAD']);

    git(work, ['push', 'origin', 'HEAD:refs/heads/main']);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('commit de EVIDÊNCIA após o run (mesmo fingerprint) → tag permitida', () => {
    writeRunContext(runCommit, runFingerprint);
    const result = runScript(work, ['rel-evidence', evidenceCommit]);
    expect(result.status).toBe(0);
    expect(result.output).toContain('apenas com evidência');
    expect(remoteTagTarget(work, 'rel-evidence')).toBe(evidenceCommit);
  });

  test('commit que MUDA a fonte provada (fingerprint diferente) → recusado', () => {
    writeRunContext(runCommit, runFingerprint);
    const result = runScript(work, ['rel-drift', otherCommit]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('sourceFingerprint diverge');
    // Nada foi criado: a tag do conteúdo divergente não existe.
    expect(git(work, ['tag', '-l', 'rel-drift'])).toBe('');
  });

  test('commit idêntico ao do run continua passando pelo caminho direto', () => {
    writeRunContext(runCommit, runFingerprint);
    const result = runScript(work, ['rel-same', runCommit]);
    expect(result.status).toBe(0);
    expect(remoteTagTarget(work, 'rel-same')).toBe(runCommit);
  });
});
