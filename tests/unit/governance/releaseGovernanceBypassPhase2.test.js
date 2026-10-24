'use strict';

/**
 * FASE 2 / MISSÃO C — GOVERNANÇA DE RELEASE SEM BYPASS (inventário + ataques fail-closed).
 *
 * O que este arquivo trava:
 *   1. TODO caminho que PUBLICA precisa de porteiro: `scripts/docker-push.sh` e
 *      `scripts/docker-push-remote.sh` empurravam imagens para um registry sem consultar a decisão
 *      de release (o bloqueio só existia no workflow de CI — `npm run deploy:push` publicava com a
 *      governança em NO_GO). Agora exigem autorização explícita + GO definitivo ANTES do build.
 *   2. O workflow de release não pode ser reestruturado de forma que o gate deixe de depender do
 *      preflight de âncoras, da atestação do run e dos jobs de validação.
 *   3. O CONSUMIDOR da atestação (o `node -e` inline do job `release-gate`) recusa atestação
 *      ausente, de outro commit, de outro run, forjada (ok/kind) e sem âncoras — o script é
 *      EXTRAÍDO do YAML e EXECUTADO, não reescrito no teste.
 *   4. O bloco de verificação de resultados dos jobs recusa `skipped`, `cancelled`, `failure`
 *      (matrix parcialmente aprovada) e só libera com `success` nos três.
 *   5. `provision-closure-anchors.js --check` falha fechado com âncora ausente, inválida ou
 *      inventário divergente.
 *
 * Nenhum cenário cria tag, release, publish ou deploy reais: o `docker` é um FAKE no PATH que
 * apenas registra a invocação, e os cenários de atestação usam JSON forjado em diretório temporário.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'release-governance.yml');
const DOC = yaml.load(fs.readFileSync(WORKFLOW, 'utf8'));

const tempDirs = [];
const novoDir = (prefixo) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
  tempDirs.push(dir);
  return dir;
};
afterAll(() => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });

const jobDoGate = () => DOC.jobs['release-gate'];
const passoPorNome = (job, trecho) => job.steps.find((s) => String(s.name || '').includes(trecho));

// ---------------------------------------------------------------------------
// 1. PORTEIRO DE PUBLICAÇÃO — docker push não publica sem GO definitivo
// ---------------------------------------------------------------------------

/** `docker` falso: registra a invocação e nunca fala com registry nenhum. */
function dockerFalso() {
  const dir = novoDir('docker-fake-');
  const marcador = path.join(dir, 'invocacoes.txt');
  fs.writeFileSync(marcador, '', 'utf8');
  const bin = path.join(dir, 'docker');
  fs.writeFileSync(bin, `#!/bin/sh\necho "$@" >> "${marcador}"\nexit 0\n`, { mode: 0o755 });
  return { dir, marcador };
}

function rodarScript(relativo, { env = {}, args = [] } = {}) {
  const fake = dockerFalso();
  const r = spawnSync('bash', [path.join(ROOT, relativo), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      PATH: `${fake.dir}:${process.env.PATH}`,
      RAP_PUBLISH_AUTHORIZED: '',
      ...env,
    },
  });
  return { ...r, invocacoes: fs.readFileSync(fake.marcador, 'utf8'), saida: `${r.stdout}${r.stderr}` };
}

describe('C — publicação de imagens exige autorização e GO definitivo', () => {
  test('C1 — `docker-push.sh` sem RAP_PUBLISH_AUTHORIZED não invoca docker nenhum', () => {
    const r = rodarScript('scripts/docker-push.sh');
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/publication-gate/);
    expect(r.saida).toMatch(/RAP_PUBLISH_AUTHORIZED/);
    expect(r.invocacoes.trim()).toBe('');
  });

  test('C2 — `docker-push.sh` autorizado mas SEM decisão GO continua bloqueado (não publica)', () => {
    const r = rodarScript('scripts/docker-push.sh', { env: { RAP_PUBLISH_AUTHORIZED: '1' } });
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/decisão canônica de release não é GO definitivo/);
    expect(r.invocacoes.trim()).toBe('');
  });

  test('C3 — `docker-push-remote.sh` tem o mesmo porteiro (nenhum caminho de publicação sem gate)', () => {
    const semAutorizacao = rodarScript('scripts/docker-push-remote.sh');
    expect(semAutorizacao.status).not.toBe(0);
    expect(semAutorizacao.saida).toMatch(/publication-gate/);
    expect(semAutorizacao.invocacoes.trim()).toBe('');
    const autorizadoSemGo = rodarScript('scripts/docker-push-remote.sh', { env: { RAP_PUBLISH_AUTHORIZED: '1' } });
    expect(autorizadoSemGo.status).not.toBe(0);
    expect(autorizadoSemGo.invocacoes.trim()).toBe('');
  });

  test('C3b — o porteiro roda ANTES do build (nenhum `docker build` chega a acontecer)', () => {
    const r = rodarScript('scripts/docker-push.sh', { env: { RAP_PUBLISH_AUTHORIZED: '1' } });
    expect(r.invocacoes).not.toMatch(/build/);
  });
});

// ---------------------------------------------------------------------------
// 1b. TAG DE RELEASE — push para remote REAL exige o mesmo porteiro (achado 1 da revisão)
// ---------------------------------------------------------------------------

/**
 * Cenário de tag: repositório local com `origin` bare. O remote é um CAMINHO de filesystem, logo
 * não é publicação externa — mas o porteiro tem de ser acionado quando a URL efetiva do remote é
 * externa (`git@…`, `https://…`), que é o caso que publica de verdade.
 */
function cenarioDeTag() {
  const base = novoDir('tag-');
  const remoto = path.join(base, 'origin.git');
  const repo = path.join(base, 'repo');
  // Ambiente git saneado: o processo pai pode injetar `safe.bareRepository=explicit` por
  // `GIT_CONFIG_COUNT/KEY_n/VALUE_n`, o que faz TODO comando sobre o repositório BARE de prova
  // falhar com "cannot use bare repository" (mesma técnica de `clean-checkout-verify.js`).
  const git = (cwd, ...args) => require('child_process').execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_COUNT: '0' },
  }).trim();
  git(base, 'init', '--bare', '-q', remoto);
  git(base, 'init', '-q', repo);
  git(repo, 'config', 'user.email', 'teste@example.invalid');
  git(repo, 'config', 'user.name', 'teste');
  git(repo, 'checkout', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'conteudo\n', 'utf8');
  git(repo, 'add', 'a.txt');
  git(repo, 'commit', '-q', '-m', 'base');
  const commit = git(repo, 'rev-parse', 'HEAD');
  return { base, remoto, repo, commit, git };
}

function rodarTag(cenario, env, remote) {
  const r = spawnSync('bash', [path.join(ROOT, 'scripts', 'create-release-tag.sh'), 'v-teste-1', cenario.commit], {
    cwd: cenario.repo,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, RAP_RELEASE_TAG_REMOTE: remote, RAP_PUBLISH_AUTHORIZED: '', ...env },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

describe('C — tag de release não é empurrada para remote externo sem decisão GO', () => {
  test('C3c — remote EXTERNO (URL ssh) sem autorização ⇒ BLOCKED e nada é empurrado', () => {
    const cenario = cenarioDeTag();
    // `--add` de uma URL externa fictícia: nenhuma conexão é feita, o porteiro barra antes do push.
    cenario.git(cenario.repo, 'remote', 'add', 'externo', 'git@example.invalid:org/repo.git');
    const r = rodarTag(cenario, {}, 'externo');
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/publication-gate|RAP_PUBLISH_AUTHORIZED/);
    expect(cenario.git(cenario.remoto, 'tag').trim()).toBe('');
  });

  test('C3d — remote EXTERNO com autorização mas SEM decisão GO continua bloqueado', () => {
    const cenario = cenarioDeTag();
    cenario.git(cenario.repo, 'remote', 'add', 'externo', 'git@example.invalid:org/repo.git');
    const r = rodarTag(cenario, { RAP_PUBLISH_AUTHORIZED: '1' }, 'externo');
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/decisão canônica de release não é GO definitivo/);
    expect(cenario.git(cenario.remoto, 'tag').trim()).toBe('');
  });

  test('C3e — remote LOCAL (bare em filesystem) NÃO é publicação: caminho feliz continua funcionando', () => {
    const cenario = cenarioDeTag();
    cenario.git(cenario.repo, 'remote', 'add', 'local', cenario.remoto);
    const r = rodarTag(cenario, {}, 'local');
    expect(r.status).toBe(0);
    expect(cenario.git(cenario.remoto, 'tag').trim()).toBe('v-teste-1');
  });

  test('C3f — `phase_publish` revalida a decisão canônica (o `--from publish` não pula a certificação)', () => {
    const fonte = fs.readFileSync(path.join(ROOT, 'scripts', 'governance', 'seal-release.sh'), 'utf8');
    const bloco = fonte.slice(fonte.indexOf('phase_publish()'));
    expect(bloco.slice(0, 1500)).toContain('assert-canonical-release-decision.js');
    expect(bloco.slice(0, 2000)).toMatch(/publicação BLOQUEADA/);
  });
});

// ---------------------------------------------------------------------------
// 2. ESTRUTURA DO WORKFLOW — o gate não pode ser desacoplado dos controles
// ---------------------------------------------------------------------------

describe('C — estrutura do workflow de release', () => {
  test('C4 — o `release-gate` depende de TODOS os controles (core, regression, atestação)', () => {
    const needs = jobDoGate().needs;
    expect(needs).toEqual(expect.arrayContaining(['governance-core', 'governance-regression', 'anchors-attestation']));
  });

  test('C5 — nenhum passo de validação dos jobs de gate usa `continue-on-error: true`', () => {
    for (const nome of ['governance-core', 'anchors-attestation', 'release-gate']) {
      const job = DOC.jobs[nome];
      expect(job).toBeDefined();
      for (const passo of job.steps || []) {
        const nome = String(passo.name || '');
        // Passos de UPLOAD de evidência são publicados mesmo quando o gate falha (é o que permite
        // diagnosticar): `continue-on-error` neles não afrouxa validação nenhuma.
        const ehDiagnostico = /upload|artifact|diagn[oó]stico/i.test(nome);
        const ehValidacao = /valid|gate|check|provision|verificar|exigir|revalidar|preflight/i.test(nome);
        if (ehDiagnostico || !ehValidacao) continue;
        expect({ job: nome, passo: passo.name, coe: passo['continue-on-error'] }).toEqual({ job: nome, passo: passo.name, coe: undefined });
      }
    }
  });

  test('C6 — o gate consome a atestação do run E revalida as âncoras por conta própria', () => {
    const gate = jobDoGate();
    const download = gate.steps.find((s) => String(s.uses || '').includes('download-artifact'));
    expect(download).toBeDefined();
    expect(download.with.name).toBe('closure-anchors-attestation');
    const revalidacao = passoPorNome(gate, 'Revalidar âncoras');
    expect(String(revalidacao.run)).toContain('provision-closure-anchors.js --check');
  });

  test('C7 — o workflow de governança NUNCA publica (sem tag/push/publish/deploy)', () => {
    const texto = fs.readFileSync(WORKFLOW, 'utf8');
    expect(texto).not.toMatch(/git\s+tag\s+-[a-z]*a?/);
    expect(texto).not.toMatch(/git\s+push/);
    expect(texto).not.toMatch(/docker\s+push/);
    expect(texto).not.toMatch(/npm\s+publish/);
    expect(texto).not.toMatch(/gh\s+release\s+create/);
  });
});

// ---------------------------------------------------------------------------
// 3. CONSUMIDOR DA ATESTAÇÃO — extraído do YAML e EXECUTADO com JSON forjado
// ---------------------------------------------------------------------------

function rodarConsumidorAtestacao(conteudo, env = {}) {
  const passo = passoPorNome(jobDoGate(), 'Exigir atestação');
  const dir = novoDir('attest-');
  const pasta = path.join(dir, 'anchor-attestation');
  fs.mkdirSync(pasta, { recursive: true });
  if (conteudo !== null) {
    fs.writeFileSync(path.join(pasta, 'anchor-attestation.json'), JSON.stringify(conteudo), 'utf8');
  }
  const script = path.join(dir, 'passo.sh');
  fs.writeFileSync(script, String(passo.run), 'utf8');
  const r = spawnSync('bash', [script], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      RUNNER_TEMP: dir,
      GITHUB_SHA: 'a'.repeat(40),
      GITHUB_RUN_ID: '999001',
      ...env,
    },
  });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

const atestacaoValida = () => ({
  kind: 'closure-anchors-attestation',
  ok: true,
  commit: 'a'.repeat(40),
  runId: '999001',
  ancoras: { fechamento: '1'.repeat(64), aprovacao: '2'.repeat(64), inventario: '3'.repeat(64) },
});

describe('C — consumidor da atestação do preflight (script real do workflow)', () => {
  test('C8 — atestação AUSENTE ⇒ bloqueia', () => {
    const r = rodarConsumidorAtestacao(null);
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/SEM_ATESTACAO_DE_PREFLIGHT/);
  });

  test('C9 — atestação de OUTRO commit ⇒ bloqueia (COMMIT)', () => {
    const r = rodarConsumidorAtestacao({ ...atestacaoValida(), commit: 'b'.repeat(40) });
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/ATESTACAO_INVALIDA:.*COMMIT/);
  });

  test('C10 — atestação de OUTRO run ⇒ bloqueia (RUN)', () => {
    const r = rodarConsumidorAtestacao({ ...atestacaoValida(), runId: '123456' });
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/ATESTACAO_INVALIDA:.*RUN/);
  });

  test('C11 — atestação ADULTERADA (ok:false ou kind trocado) ⇒ bloqueia', () => {
    const semOk = rodarConsumidorAtestacao({ ...atestacaoValida(), ok: false });
    expect(semOk.status).not.toBe(0);
    expect(semOk.saida).toMatch(/ATESTACAO_INVALIDA:.*OK/);
    const kindErrado = rodarConsumidorAtestacao({ ...atestacaoValida(), kind: 'qualquer-coisa' });
    expect(kindErrado.status).not.toBe(0);
    expect(kindErrado.saida).toMatch(/ATESTACAO_INVALIDA:.*KIND/);
  });

  test('C12 — atestação sem as três âncoras ⇒ bloqueia (ANCORAS)', () => {
    const r = rodarConsumidorAtestacao({ ...atestacaoValida(), ancoras: { fechamento: '1'.repeat(64) } });
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/ATESTACAO_INVALIDA:.*ANCORAS/);
  });

  test('C13 — atestação válida do MESMO commit e run ⇒ libera', () => {
    const r = rodarConsumidorAtestacao(atestacaoValida());
    expect(r.status).toBe(0);
    expect(r.saida).toMatch(/atestação do preflight válida/);
  });
});

// ---------------------------------------------------------------------------
// 4. RESULTADO DOS JOBS ANTERIORES — job pulado/cancelado/matrix parcial
// ---------------------------------------------------------------------------

function rodarVerificacaoDeResultados({ core, regr, atest }) {
  const passo = passoPorNome(jobDoGate(), 'Verificar resultado dos jobs anteriores');
  const dir = novoDir('needs-');
  const script = String(passo.run)
    .replace(/\$\{\{\s*needs\.governance-core\.result\s*\}\}/g, core)
    .replace(/\$\{\{\s*needs\.governance-regression\.result\s*\}\}/g, regr)
    .replace(/\$\{\{\s*needs\.anchors-attestation\.result\s*\}\}/g, atest);
  const arquivo = path.join(dir, 'needs.sh');
  fs.writeFileSync(arquivo, script, 'utf8');
  const r = spawnSync('bash', [arquivo], { encoding: 'utf8', timeout: 60000 });
  return { status: r.status, saida: `${r.stdout}${r.stderr}` };
}

describe('C — verificação dos resultados dos jobs', () => {
  const casos = [
    ['C14 — job PULADO (skipped) em governance-core', { core: 'skipped', regr: 'success', atest: 'success' }, /governance-core falhou \(skipped\)/],
    ['C15 — job CANCELADO (cancelled)', { core: 'success', regr: 'cancelled', atest: 'success' }, /governance-regression falhou \(cancelled\)/],
    ['C16 — MATRIX parcialmente aprovada (atestação success, core failure)', { core: 'failure', regr: 'success', atest: 'success' }, /governance-core falhou \(failure\)/],
  ];
  for (const [nome, resultados, esperado] of casos) {
    test(nome, () => {
      const r = rodarVerificacaoDeResultados(resultados);
      expect(r.status).not.toBe(0);
      expect(r.saida).toMatch(esperado);
      expect(r.saida).not.toMatch(/Release autorizado/);
    });
  }

  test('C17 — atestação ausente/falha bloqueia mesmo com os demais verdes', () => {
    const r = rodarVerificacaoDeResultados({ core: 'success', regr: 'success', atest: 'failure' });
    expect(r.status).not.toBe(0);
    expect(r.saida).toMatch(/atestação das âncoras ausente\/falha/);
  });

  test('C18 — todos success ⇒ libera', () => {
    const r = rodarVerificacaoDeResultados({ core: 'success', regr: 'success', atest: 'success' });
    expect(r.status).toBe(0);
    expect(r.saida).toMatch(/Release autorizado/);
  });
});

// ---------------------------------------------------------------------------
// 5. PREFLIGHT DE ÂNCORAS — ausente, inválida, divergente
// ---------------------------------------------------------------------------

function rodarCheckAncoras(env) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'governance', 'provision-closure-anchors.js'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      RAP_CLOSURE_TRUST_ANCHOR_SHA256: '',
      RAP_APPROVAL_TRUST_ANCHOR_SHA256: '',
      RAP_CLOSURE_INVENTORY_SHA256: '',
      ...env,
    },
  });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch (_) { json = null; }
  return { status: r.status, json, saida: `${r.stdout}${r.stderr}` };
}

describe('C — preflight de âncoras falha fechado', () => {
  test('C19 — âncoras AUSENTES ⇒ exit != 0 com os três achados', () => {
    const r = rodarCheckAncoras({});
    expect(r.status).not.toBe(0);
    expect(r.json.ok).toBe(false);
    expect(r.json.achados.length).toBeGreaterThanOrEqual(3);
    expect(r.json.achados.join(' ')).toMatch(/RAP_CLOSURE_TRUST_ANCHOR_SHA256/);
    expect(r.json.achados.join(' ')).toMatch(/RAP_APPROVAL_TRUST_ANCHOR_SHA256/);
  });

  test('C20 — âncora INVÁLIDA (não é sha256 hex) ⇒ exit != 0', () => {
    const r = rodarCheckAncoras({
      RAP_CLOSURE_TRUST_ANCHOR_SHA256: 'nao-e-uma-ancora',
      RAP_APPROVAL_TRUST_ANCHOR_SHA256: '2'.repeat(64),
      RAP_CLOSURE_INVENTORY_SHA256: '3'.repeat(64),
    });
    expect(r.status).not.toBe(0);
    expect(r.json.ok).toBe(false);
    expect(r.json.achados.join(' ')).toMatch(/ausente\/inválida/);
  });

  test('C21 — âncora DIVERGENTE do inventário atual ⇒ exit != 0 (a fila mudou)', () => {
    const r = rodarCheckAncoras({
      RAP_CLOSURE_TRUST_ANCHOR_SHA256: '1'.repeat(64),
      RAP_APPROVAL_TRUST_ANCHOR_SHA256: '2'.repeat(64),
      RAP_CLOSURE_INVENTORY_SHA256: 'f'.repeat(64),
    });
    expect(r.status).not.toBe(0);
    expect(r.json.ok).toBe(false);
    expect(r.json.achados.join(' ')).toMatch(/a fila mudou|!= digest atual/);
  });
});
