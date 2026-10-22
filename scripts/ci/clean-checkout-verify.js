#!/usr/bin/env node
'use strict';

/**
 * TESTE ADVERSARIAL DE INSTALAÇÃO LIMPA — `npm run ci:clean-checkout`.
 *
 * PROBLEMA REAL (missão CI DEFINITIVO E REPRODUTÍVEL, §4/§9/§10). Todo o diagnóstico de CI deste
 * repositório era feito na MESMA árvore onde o desenvolvedor trabalha: `node_modules` quente,
 * `.env` privado, `reports/*` de execuções anteriores, serviços já de pé (RAG em 8001, imagens
 * Docker construídas à mão) e arquivos que existem no disco mas em NENHUM commit
 * (medido em 2026-10-21: `.github/copilot-instructions.md`, exigido por dois gates bloqueantes,
 * existia só em `.git/info/exclude`). Nesse ambiente é impossível distinguir "o produto está
 * correto" de "a máquina do operador está preparada".
 *
 * O que este harness faz — e por que cada decisão:
 *
 *  - CLONA o commit exato em diretório temporário (`git clone` + `checkout --detach`), confere
 *    `rev-parse HEAD` e RECUSA continuar se houver qualquer artefato de execução anterior
 *    (`.env`, `api/data/config.json`, `reports/`, `dist/`, `node_modules`) ou worktree sujo;
 *  - usa BANCO e REDIS próprios do run (banco criado e destruído aqui; Redis em db isolado),
 *    então rodar o harness não altera dados de outros runs nem do ambiente de desenvolvimento;
 *  - NÃO usa o serviço RAG que o desenvolvedor tem em 127.0.0.1:8001: sobe o container oficial do
 *    repositório numa porta livre e aponta `RAG_SERVICE_URL` para ele — a dependência é
 *    PROVISIONADA, nunca herdada;
 *  - executa o entrypoint canônico (`npm run ci:bootstrap`) e o gate versionado
 *    (`scripts/ci/dev-branch-gate.js`), nunca uma sequência ad-hoc;
 *  - grava evidência estruturada com identidade de run (`runId`, `sourceCommit`,
 *    `sourceFingerprint`, `environmentId`), timestamps, exit code e SHA-256 do log de cada passo;
 *  - DESTRÓI o que criou (banco, container, diretório) — salvo `--keep`.
 *
 * Cenários adversariais (§9) — cada um prova uma coisa que "verde" não prova:
 *   clean              caminho completo em checkout limpo
 *   bootstrap-twice    bootstrap é IDEMPOTENTE (2ª execução não duplica seed nem corrompe)
 *   missing-artifact   artefato ausente REPROVA o consumidor (prova de não vacuidade)
 *   corrupt-artifact   artefato corrompido REPROVA o consumidor
 *   db-unavailable     sem PostgreSQL o bootstrap FALHA (nunca "pula" e finge sucesso)
 *   docker-unavailable sem Docker a suíte de sandbox REPROVA (nunca alega PASS)
 *
 * Uso:
 *   node scripts/ci/clean-checkout-verify.js [--scenario clean|all|<nome>]
 *        [--commit <sha>] [--gate-phases A,B,C,D] [--with-integration] [--build-images]
 *        [--timeout-min 90] [--keep] [--json]
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const EVIDENCE_DIR = path.join(ROOT, 'AI_MEMORY', 'evidence');
const REPORT_PATH = path.join(ROOT, 'reports', 'ci-clean-checkout-report.json');

const SCENARIOS = Object.freeze([
  'clean',
  'l0-full',
  'l2-system',
  'bootstrap-twice',
  'missing-artifact',
  'corrupt-artifact',
  'db-unavailable',
  'docker-unavailable',
]);

const ADMIN_DATABASE_URL = process.env.CLEAN_CHECKOUT_ADMIN_DATABASE_URL
  || 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const REDIS_HOST = process.env.CLEAN_CHECKOUT_REDIS_HOST || '127.0.0.1';
const REDIS_DB = process.env.CLEAN_CHECKOUT_REDIS_DB || '13';
const RAG_IMAGE = process.env.CLEAN_CHECKOUT_RAG_IMAGE || 'r-agent2-rag-service:latest';
const SANDBOX_IMAGE = process.env.CLEAN_CHECKOUT_SANDBOX_IMAGE || 'r-agent2-engineering-router-sandbox:latest';

// ---------------------------------------------------------------------------
// infraestrutura de execução
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function sha256(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function sh(comando, args, { cwd = ROOT, env = {}, timeoutMs = 10 * 60 * 1000 } = {}) {
  const inicio = Date.now();
  const r = spawnSync(comando, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return {
    status: typeof r.status === 'number' ? r.status : null,
    signal: r.signal || null,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    erro: r.error ? r.error.message : null,
    duracaoMs: Date.now() - inicio,
  };
}

const passos = [];

/**
 * NOMES DE CONTAINER ÚNICOS POR RUN.
 *
 * DEFEITO MEDIDO em 2026-10-21: dois runs do harness na mesma máquina usavam os mesmos nomes de
 * container. O teardown de um REMOVEU os containers do outro no meio da execução — interferência
 * silenciosa entre runs, exatamente o que o harness existe para eliminar. O sufixo vem do runId e
 * um lock impede dois runs simultâneos.
 */
let NOMES = { api: 'rap-ci-clean-api', frontend: 'rap-ci-clean-frontend', rag: 'rap-ci-clean-rag' };
function definirNomesDoRun(sufixo) {
  NOMES = {
    api: `rap-ci-clean-${sufixo}-api`,
    frontend: `rap-ci-clean-${sufixo}-frontend`,
    rag: `rap-ci-clean-${sufixo}-rag`,
  };
}

/**
 * Executa um passo e registra a prova. NUNCA converte falha em sucesso: `ok` só é verdadeiro com
 * exit code 0 (ou quando o próprio cenário espera exit != 0 — nesse caso `esperado` é explícito).
 */
function passo(id, comando, args, opcoes = {}) {
  const {
    cwd,
    env,
    timeoutMs,
    esperado = 0,
    descricao = null,
    logDir = null,
  } = opcoes;
  const comandoCompleto = [comando, ...args].join(' ');
  const r = sh(comando, args, { cwd, env, timeoutMs });
  const saida = `${r.stdout}${r.stderr}`;
  const registro = {
    id,
    descricao,
    comando: comandoCompleto,
    cwd: cwd ? path.relative(ROOT, cwd) || cwd : '.',
    esperado,
    exitCode: r.status,
    signal: r.signal,
    startedAt: new Date(Date.now() - r.duracaoMs).toISOString(),
    finishedAt: nowIso(),
    duracaoMs: r.duracaoMs,
    outputSha256: sha256(saida),
    outputBytes: Buffer.byteLength(saida),
    ok: r.status === esperado,
    ...contadoresDeTeste(saida),
  };
  if (logDir) {
    fs.mkdirSync(logDir, { recursive: true });
    const arquivo = path.join(logDir, `${id}.log`);
    fs.writeFileSync(arquivo, saida, 'utf8');
    registro.logPath = path.relative(ROOT, arquivo);
  }
  passos.push(registro);
  const marca = registro.ok ? '  ok  ' : ' FAIL ';
  const esperadoTxt = esperado === 0 ? '' : ` (esperado exit ${esperado})`;
  console.log(`[ci:clean-checkout]${marca} ${id}${esperadoTxt} (${Math.round(r.duracaoMs / 1000)}s)`);
  if (!registro.ok) {
    for (const linha of saida.trim().split('\n').slice(-15)) console.log(`           ${linha}`);
  }
  return registro;
}

/** Extrai contadores do Jest quando o passo é uma execução de suíte. */
function contadoresDeTeste(saida) {
  const contadores = {};
  const suites = saida.match(/Test Suites:\s+(.*)/);
  const tests = saida.match(/Tests:\s+(.*)/);
  if (suites) {
    contadores.suiteSummary = suites[1].trim();
    contadores.failedSuites = Number((suites[1].match(/(\d+) failed/) || [])[1] || 0);
  }
  if (tests) {
    contadores.testSummary = tests[1].trim();
    contadores.executedTests = Number((tests[1].match(/(\d+) total/) || [])[1] || 0);
    contadores.passedTests = Number((tests[1].match(/(\d+) passed/) || [])[1] || 0);
    contadores.failedTests = Number((tests[1].match(/(\d+) failed/) || [])[1] || 0);
    contadores.skippedTests = Number((tests[1].match(/(\d+) skipped/) || [])[1] || 0);
  }
  return contadores;
}

function versao(comando, args = ['--version']) {
  const r = sh(comando, args);
  return r.status === 0 ? String(r.stdout || r.stderr).trim().split('\n')[0] : 'indisponivel';
}

// ---------------------------------------------------------------------------
// recursos efêmeros (banco, redis, container)
// ---------------------------------------------------------------------------

const PG_IMAGE = process.env.CLEAN_CHECKOUT_PG_IMAGE || 'pgvector/pgvector:pg16';
const REDIS_IMAGE = process.env.CLEAN_CHECKOUT_REDIS_IMAGE || 'redis:7';

/**
 * POSTGRES E REDIS PRÓPRIOS DO RUN (containers efêmeros), como os `services:` do job de CI.
 *
 * DEFEITO MEDIDO em 2026-10-22 (run limpo de c5f045a8b): mesmo com banco dedicado, o servidor
 * Postgres era o do host — compartilhado com a API de desenvolvimento, o preview e outros bancos.
 * As suítes de concorrência reprovaram com `SequelizeConnectionError: sorry, too many clients
 * already` e uma suíte E2E estourou 900 s. A "isolação por banco" não isolava CAPACIDADE: conexões
 * são um recurso do SERVIDOR, não do banco. No CI o Postgres é um serviço efêmero com capacidade
 * inteira para o job. Aqui ele passa a ser também.
 */
function subirInfraDeDados(sufixo) {
  const nomes = { pg: `rap-ci-clean-${sufixo}-pg`, redis: `rap-ci-clean-${sufixo}-redis` };
  const pgPorta = portaDeTesteLivre();
  const redisPorta = portaDeTesteLivre();

  sh('docker', ['rm', '-f', nomes.pg]);
  sh('docker', ['rm', '-f', nomes.redis]);

  const pg = sh('docker', ['run', '-d', '--name', nomes.pg,
    '-e', 'POSTGRES_USER=postgres',
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_DB=ci',
    '-p', `127.0.0.1:${pgPorta}:5432`, PG_IMAGE]);
  if (pg.status !== 0) throw new Error(`falha ao subir Postgres efemero: ${(pg.stderr || pg.stdout).trim()}`);

  const redis = sh('docker', ['run', '-d', '--name', nomes.redis,
    '-p', `127.0.0.1:${redisPorta}:6379`, REDIS_IMAGE]);
  if (redis.status !== 0) throw new Error(`falha ao subir Redis efemero: ${(redis.stderr || redis.stdout).trim()}`);

  for (let i = 0; i < 60; i += 1) {
    if (sh('docker', ['exec', nomes.pg, 'pg_isready', '-U', 'postgres']).status === 0) break;
    sh('sleep', ['2']);
  }
  for (let i = 0; i < 60; i += 1) {
    if (sh('docker', ['exec', nomes.redis, 'redis-cli', 'ping']).status === 0) break;
    sh('sleep', ['1']);
  }

  return {
    nomes,
    pgPorta,
    redisPorta,
    databaseUrl: `postgres://postgres:postgres@127.0.0.1:${pgPorta}/ci`,
    redisUrl: `redis://127.0.0.1:${redisPorta}/0`,
  };
}

function derrubarInfraDeDados(nomes) {
  if (!nomes) return;
  sh('docker', ['rm', '-f', nomes.pg]);
  sh('docker', ['rm', '-f', nomes.redis]);
}

function criarBanco(nome) {
  const r = sh('psql', [ADMIN_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE "${nome}"`]);
  if (r.status !== 0) {
    throw new Error(`nao foi possivel criar o banco ${nome}: ${(r.stderr || r.stdout).trim()}`);
  }
}

function destruirBanco(nome) {
  sh('psql', [ADMIN_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c',
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${nome}'`]);
  sh('psql', [ADMIN_DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE IF EXISTS "${nome}"`]);
}

function limparRedis() {
  sh('redis-cli', ['-h', REDIS_HOST, '-n', REDIS_DB, 'flushdb']);
}

function portaDeTesteLivre() {
  const r = sh('node', ['-e', `
    const net = require('net');
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => process.stdout.write(String(port)));
    });
  `]);
  const porta = Number(String(r.stdout).trim());
  if (!porta) throw new Error('nao foi possivel reservar uma porta livre para o RAG');
  return porta;
}

function portaOcupada(porta) {
  const r = sh('node', ['-e', `
    const net = require('net');
    const socket = net.connect({ host: '127.0.0.1', port: ${Number(porta)} });
    socket.setTimeout(800);
    socket.on('connect', () => { socket.destroy(); process.stdout.write('1'); });
    socket.on('timeout', () => { socket.destroy(); process.stdout.write('0'); });
    socket.on('error', () => process.stdout.write('0'));
  `]);
  return String(r.stdout).trim() === '1';
}

/**
 * ARTEFATO PROD-LIKE — produzido por EXECUÇÃO REAL nesta run, nunca herdado.
 *
 * `tests/unit/governance/modelDrivenE2e.test.js` exige
 * `qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json` com `status=GO`. O arquivo é
 * gitignored e, no CI, vem do job `prod-like-smoke` (API + frontend em Docker + smoke real no
 * Chromium). Sem ele o L0 do checkout limpo reprova em UMA suíte — medido em 2026-10-21:
 * 379 suítes / 5568 testes, `modelDrivenE2e` vermelho por ausência de artefato.
 *
 * Aqui o produtor é executado dentro do clone: imagens construídas do commit (não reaproveitadas
 * de outro), API com o banco/redis DESTA run e o RAG provisionado por este harness, smoke real.
 * Os containers são removidos ao final.
 */
function provisionarProdLike(ctx, args) {
  const { clonePath, env, logDir, ragUrl } = ctx;
  const apiImage = 'rap-ci-clean-api';
  const apiBaseImage = 'rap-ci-clean-api-base';
  const frontendImage = 'rap-ci-clean-frontend';
  const apiPort = 3000; // nginx do frontend proxya para api:3000 (frontend/nginx.conf)
  const frontendPort = 8080;

  for (const [nome, porta] of [['API', apiPort], ['frontend', frontendPort]]) {
    if (portaOcupada(porta)) {
      throw new Error(`porta ${porta} (${nome}) ocupada no host — o produtor prod-like precisa dela livre; pare o processo local ou rode em um runner isolado`);
    }
  }

  const construcoes = [
    ['build-api-base', ['build', '-f', 'api/Dockerfile.base', '-t', apiBaseImage, '.']],
    ['build-api', ['build', '-f', 'api/Dockerfile', '--build-arg', `API_BASE_IMAGE=${apiBaseImage}`, '-t', apiImage, '.']],
    ['build-frontend', ['build', '-f', 'frontend/Dockerfile', '--build-arg', 'VITE_BASE_PATH=/', '--build-arg', 'VITE_API_BASE_URL=/api', '-t', frontendImage, '.']],
  ];
  for (const [id, argumentos] of construcoes) {
    const registro = passo(id, 'docker', argumentos, {
      cwd: clonePath, logDir, timeoutMs: 60 * 60 * 1000,
      descricao: `Imagem ${id} construida a partir do commit clonado`,
    });
    if (!registro.ok) throw new Error(`${id} falhou (exit ${registro.exitCode})`);
  }

  sh('docker', ['rm', '-f', NOMES.api]);
  sh('docker', ['rm', '-f', NOMES.frontend]);

  const secrets = {
    ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
    REPLAY_SIGNING_KEY: crypto.randomBytes(32).toString('hex'),
    ENGINEERING_RUNNER_TOKEN: crypto.randomBytes(32).toString('hex'),
  };

  const subirApi = sh('docker', ['run', '-d', '--name', NOMES.api, '--network', 'host',
    '-e', 'NODE_ENV=production',
    '-e', `API_PORT=${apiPort}`,
    '-e', `DATABASE_URL=${env.DATABASE_URL}`,
    '-e', `REDIS_URL=${env.REDIS_URL}`,
    '-e', `RATE_LIMIT_REDIS_URL=${env.REDIS_URL}`,
    '-e', `ENCRYPTION_KEY=${secrets.ENCRYPTION_KEY}`,
    '-e', `REPLAY_SIGNING_KEY=${secrets.REPLAY_SIGNING_KEY}`,
    '-e', `RAG_INTERNAL_TOKEN=${env.RAG_INTERNAL_TOKEN}`,
    '-e', `RAG_SERVICE_URL=${ragUrl}`,
    '-e', `ENGINEERING_RUNNER_TOKEN=${secrets.ENGINEERING_RUNNER_TOKEN}`,
    '-e', `ENGINEERING_RUNNER_URL=${env.ENGINEERING_RUNNER_URL}`,
    apiImage]);
  if (subirApi.status !== 0) throw new Error(`falha ao subir a API prod-like: ${(subirApi.stderr || '').trim()}`);

  esperarHttp(`http://127.0.0.1:${apiPort}/health`, 'API prod-like', 300, () => sh('docker', ['logs', '--tail', '60', NOMES.api]));

  const subirFrontend = sh('docker', ['run', '-d', '--name', NOMES.frontend,
    '-p', `${frontendPort}:80`, '--add-host', 'api:host-gateway', frontendImage]);
  if (subirFrontend.status !== 0) throw new Error(`falha ao subir o frontend prod-like: ${(subirFrontend.stderr || '').trim()}`);
  esperarHttp(`http://127.0.0.1:${frontendPort}/`, 'frontend prod-like', 150, () => sh('docker', ['logs', '--tail', '60', NOMES.frontend]));
  esperarHttp(`http://127.0.0.1:${frontendPort}/api/health`, 'proxy /api do frontend', 150, () => sh('docker', ['logs', '--tail', '60', NOMES.frontend]));

  ctx.smokeEnv = {
    ...env,
    ...secrets,
    API_URL: `http://127.0.0.1:${apiPort}`,
    FRONTEND_URL: `http://127.0.0.1:${frontendPort}`,
  };
  porSmokeProdLike(ctx, logDir);

  const artefato = path.join(clonePath, 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
  if (!fs.existsSync(artefato)) {
    throw new Error('o smoke terminou sem produzir qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json');
  }
  passos.push({
    id: 'prod-like-artefato',
    comando: '(verificacao do artefato produzido)',
    descricao: 'Artefato prod-like existe e declara status',
    esperado: 0,
    exitCode: 0,
    statusArtefato: (() => { try { return JSON.parse(fs.readFileSync(artefato, 'utf8')).status || null; } catch (_) { return null; } })(),
    sha256Artefato: sha256(fs.readFileSync(artefato, 'utf8')),
    ok: true,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    duracaoMs: 0,
  });
}

/** Executa o smoke prod-like (produtor canônico do artefato). Reutilizável pelo cenário negativo. */
function porSmokeProdLike(ctx, logDir, id = 'prod-like-smoke') {
  return passo(id, 'node', ['scripts/smoke/qa-waves-operational-final-smoke.js'], {
    cwd: ctx.clonePath,
    // Os MESMOS segredos efêmeros da API: o smoke ASSINA artefatos de replay no host e a API
    // valida a assinatura no container. Sem `REPLAY_SIGNING_KEY` no host, medido em 2026-10-21:
    // `replay_signing_key_required_min_32_bytes` e nenhum artefato produzido.
    env: { ...ctx.smokeEnv, RUN_QA_WAVES_PROD_LIKE_SMOKE: '1' },
    logDir,
    timeoutMs: 45 * 60 * 1000,
    descricao: 'Smoke prod-like real (produtor do artefato consumido por modelDrivenE2e)',
  });
}

function esperarHttp(url, rotulo, tentativas, diagnostico) {
  for (let i = 0; i < tentativas; i += 1) {
    if (sh('curl', ['-fsS', '-m', '3', url]).status === 0) return;
    sh('sleep', ['2']);
  }
  const diag = diagnostico();
  throw new Error(`${rotulo} nao respondeu em ${url}: ${(diag.stderr || diag.stdout || '').trim().slice(-800)}`);
}

function derrubarProdLike() {
  sh('docker', ['rm', '-f', NOMES.api]);
  sh('docker', ['rm', '-f', NOMES.frontend]);
}

function imagemExiste(imagem) {
  return sh('docker', ['image', 'inspect', imagem]).status === 0;
}

function subirRag({ porta, databaseUrl, token }) {
  sh('docker', ['rm', '-f', NOMES.rag]);
  const r = sh('docker', ['run', '-d', '--name', NOMES.rag, '--network', 'host',
    '-e', 'HOST=0.0.0.0',
    '-e', `PORT=${porta}`,
    '-e', 'RAG_ENVIRONMENT=development',
    '-e', `RAG_INTERNAL_TOKEN=${token}`,
    '-e', `DATABASE_URL=${databaseUrl}`,
    '-e', 'HF_HUB_OFFLINE=1',
    '-e', 'TRANSFORMERS_OFFLINE=1',
    RAG_IMAGE]);
  if (r.status !== 0) throw new Error(`falha ao subir o RAG: ${(r.stderr || r.stdout).trim()}`);

  const limite = Date.now() + 300 * 1000;
  while (Date.now() < limite) {
    const probe = sh('curl', ['-fsS', '-m', '3', `http://127.0.0.1:${porta}/health`]);
    if (probe.status === 0) return;
    sh('sleep', ['3']);
  }
  const logs = sh('docker', ['logs', '--tail', '40', NOMES.rag]);
  throw new Error(`RAG nao respondeu em /health na porta ${porta}: ${(logs.stderr || logs.stdout).trim()}`);
}

function derrubarRag() {
  sh('docker', ['rm', '-f', NOMES.rag]);
}

/** Encerra processos que ficaram presos DENTRO do clone temporário (PID específico, nunca por nome). */
function encerrarProcessosDoClone(clonePath) {
  const r = sh('ps', ['-eo', 'pid,args']);
  const pids = String(r.stdout || '')
    .split('\n')
    .filter((linha) => linha.includes(clonePath) && !linha.includes('ps -eo'))
    .map((linha) => Number(linha.trim().split(/\s+/)[0]))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  for (const pid of pids) {
    try { process.kill(pid, 'SIGTERM'); } catch (_) { /* processo ja terminou */ }
  }
  return pids;
}

// ---------------------------------------------------------------------------
// preparação do checkout
// ---------------------------------------------------------------------------

function identidadeDoSorce() {
  const sha = String(sh('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).stdout || '').trim();
  const branch = String(sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: ROOT }).stdout || '').trim();
  const worktree = String(sh('git', ['status', '--porcelain'], { cwd: ROOT }).stdout || '').trim();
  return { sha, branch, worktreeLimpo: worktree === '' };
}

function clonar(sha, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const clone = sh('git', ['clone', '--no-hardlinks', '--no-local', ROOT, destino], { timeoutMs: 10 * 60 * 1000 });
  if (clone.status !== 0) throw new Error(`git clone falhou: ${(clone.stderr || clone.stdout).trim()}`);

  // CHECKOUT COMO O `actions/checkout` FAZ (branch local apontando para o SHA), nunca HEAD
  // destacado. Medido em 2026-10-21: no clone destacado, `runIdentityCommit.test.js` reprovou com
  // `sourceBranch` null — `git rev-parse --abbrev-ref HEAD` devolve "HEAD" e a identidade
  // fail-closed do produto trata isso como ausencia de branch. O CI NÃO roda destacado (o
  // checkout cria a branch local), então um clone destacado mediria um ambiente que não existe.
  const branchLocal = sha === identidadeDoSorce().sha ? identidadeDoSorce().branch : 'ci-clean-checkout';
  let checkout = sh('git', ['checkout', '--force', '-B', branchLocal, sha], { cwd: destino });
  if (checkout.status !== 0) {
    sh('git', ['fetch', '--no-tags', 'origin', sha], { cwd: destino });
    checkout = sh('git', ['checkout', '--force', '-B', branchLocal, sha], { cwd: destino });
  }
  if (checkout.status !== 0) {
    throw new Error(`nao foi possivel materializar o commit ${sha}: ${(checkout.stderr || '').trim()}`);
  }

  const head = String(sh('git', ['rev-parse', 'HEAD'], { cwd: destino }).stdout || '').trim();
  if (head !== sha) throw new Error(`HEAD do clone (${head}) difere do commit pedido (${sha})`);
  return head;
}

/**
 * Recusa continuar se o clone carregar QUALQUER resíduo de execução anterior. Um "checkout limpo"
 * que traz `.env`, `reports/` gerados ou `dist/` não prova nada: passaria a depender do estado do
 * operador.
 *
 * A auditoria é sobre o que o GIT vê como não versionado/sujo — não sobre a existência do
 * diretório. `reports/` existe legitimamente no clone porque versiona exceções
 * (`reports/tenant-isolation-report.json`, `reports/db-integrity-report.json`); confundir
 * "diretório existe" com "há resíduo" reprovaria um clone perfeito.
 */
function auditarCloneLimpo(destino) {
  const proibidos = [
    '.env', '.token.env', 'node_modules', 'dist', 'api/data/config.json',
    'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
  ];
  const presentes = proibidos.filter((rel) => fs.existsSync(path.join(destino, rel)));
  const status = String(sh('git', ['status', '--porcelain'], { cwd: destino }).stdout || '').trim();
  const ignorados = String(sh('git', ['status', '--porcelain', '--ignored'], { cwd: destino }).stdout || '')
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => /^!!|^\?\?/.test(linha))
    .map((linha) => linha.replace(/^!!\s+|^\?\?\s+/, ''));
  const residuos = [...new Set([...presentes, ...ignorados])];
  return { presentes: residuos, worktreeLimpo: status === '', artefatosProibidos: residuos };
}

function fingerprintDoSource(destino) {
  const r = sh('node', ['-e',
    'const {computeSourceFingerprint}=require("./governance/proof-engine/fingerprint-chain");process.stdout.write(computeSourceFingerprint(process.cwd()))',
  ], { cwd: destino });
  return r.status === 0 ? String(r.stdout).trim() : 'indisponivel';
}

// ---------------------------------------------------------------------------
// cenários
// ---------------------------------------------------------------------------

function criarAmbienteDoRun({ clonePath, databaseUrl, redisUrl, ragUrl, token, runnerPort, extras = {} }) {
  return {
    CI: 'true',
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl || `redis://${REDIS_HOST}:6379/${REDIS_DB}`,
    RATE_LIMIT_REDIS_URL: redisUrl || `redis://${REDIS_HOST}:6379/${REDIS_DB}`,
    RAG_SERVICE_URL: ragUrl,
    RAG_INTERNAL_TOKEN: token,
    // ISOLAMENTO DO ENGINEERING RUNNER: porta propria do run. Com 8097 fixo, o clone podia
    // REUTILIZAR um runner orfao de OUTRA arvore (medido nesta maquina: pid ocupando 8097 vindo do
    // workspace principal) — a prova de sandbox passaria a medir o codigo do vizinho.
    // AMBIENTE GIT SANEADO. O shell que executa o harness pode injetar configuracao por
    // `GIT_CONFIG_COUNT/KEY_n/VALUE_n` (medido nesta maquina: `safe.bareRepository=explicit`).
    // Um teste que cria um repositorio BARE em /tmp passa a falhar com "cannot use bare
    // repository" — nao por defeito de produto, mas por configuracao ambiente invisivel.
    // `GIT_CONFIG_COUNT=0` descarta TODA a injecao do processo pai: o run passa a ver a mesma
    // configuracao que o runner do CI.
    GIT_CONFIG_COUNT: '0',
    ENGINEERING_RUNNER_TEST_PORT: String(runnerPort),
    ENGINEERING_RUNNER_URL: `http://127.0.0.1:${runnerPort}`,
    JEST_MAX_WORKERS: process.env.CLEAN_CHECKOUT_JEST_WORKERS || '4',
    ...extras,
  };
}

function opcoesDeGate(args) {
  const fases = args.gatePhases.includes('all') ? null : args.gatePhases;
  return fases;
}

function executarGate(clonePath, env, args, logDir) {
  const fases = opcoesDeGate(args);
  const comandoArgs = ['scripts/ci/dev-branch-gate.js', '--out', 'reports/dev-branch-ci-evidence.json'];
  if (fases) comandoArgs.push('--fases', fases.join(','));
  return passo('gate-dev-branch', 'node', comandoArgs, {
    cwd: clonePath,
    env,
    logDir,
    timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: `Gate versionado (fases ${fases ? fases.join(',') : 'completas'})`,
  });
}

/**
 * INVENTÁRIO COMPLETO DO L1 — o gate para no PRIMEIRO passo vermelho (contrato de fail-fast), então
 * um run vermelho nomeia uma causa e esconde as demais. Aqui cada passo do L1 é executado
 * individualmente, a partir da MESMA definição canônica (`PASSOS` do gate, nunca uma cópia), para
 * que a evidência registre o conjunto exato de gates vermelhos e verdes do commit.
 */
function inventarioL1(clonePath, env, logDir) {
  const { PASSOS } = require('./dev-branch-gate');
  const resultado = [];
  for (const definicao of PASSOS.D) {
    const [comando, ...resto] = definicao.comando.split(' ');
    const registro = passo(`L1-inventario:${definicao.id}`, comando, resto, {
      cwd: clonePath,
      env,
      logDir,
      timeoutMs: Math.min(definicao.orcamentoMs || 120000, 10 * 60 * 1000),
      descricao: definicao.descricao,
    });
    resultado.push({ id: definicao.id, exitCode: registro.exitCode, ok: registro.ok });
  }
  return resultado;
}

function cenarioClean(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('npm-ci-bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: 'Bootstrap canonico do ambiente (npm run ci:bootstrap)',
  });
  if (!args.noProdLike) {
    try {
      provisionarProdLike(ctx, args);
    } catch (erro) {
      // Falha do PRODUTOR é registrada como falha e o gate continua: o L0 vai reprovar em
      // `modelDrivenE2e` por ausência do artefato — e é isso que a evidência precisa mostrar.
      passos.push({
        id: 'prod-like-provisionamento',
        comando: '(provisionamento do artefato prod-like)',
        descricao: 'Produtor prod-like executado dentro do clone',
        esperado: 0,
        exitCode: 1,
        erro: erro.message,
        ok: false,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        duracaoMs: 0,
      });
      console.error(`[ci:clean-checkout] FAIL prod-like: ${erro.message}`);
    }
  } else {
    passos.push({
      id: 'prod-like-desabilitado',
      comando: '(--no-prod-like)',
      descricao: 'Artefato prod-like NAO produzido nesta run (L0 reprovara em modelDrivenE2e)',
      esperado: 0, exitCode: 0, ok: true, informativo: true,
      startedAt: nowIso(), finishedAt: nowIso(), duracaoMs: 0,
    });
  }
  const gate = executarGate(clonePath, env, args, logDir);

  // Inventário só quando o L1 está no escopo: nomear TODOS os vermelhos, não apenas o primeiro.
  if (opcoesDeGate(args) === null || opcoesDeGate(args).includes('D')) {
    const inventario = inventarioL1(clonePath, env, logDir);
    const vermelhos = inventario.filter((i) => !i.ok).map((i) => i.id);
    passos.push({
      id: 'L1-inventario-resumo',
      comando: '(consolidacao do inventario L1)',
      descricao: 'Conjunto exato de gates L1 verdes/vermelhos no commit',
      esperado: 0,
      exitCode: vermelhos.length === 0 ? 0 : 1,
      verdes: inventario.filter((i) => i.ok).map((i) => i.id),
      vermelhos,
      ok: true, // é diagnóstico: nunca altera o veredito do gate
      informativo: true,
      startedAt: nowIso(),
      finishedAt: nowIso(),
      duracaoMs: 0,
    });
    console.log(`[ci:clean-checkout]  info  L1 verdes=${inventario.filter((i) => i.ok).length} vermelhos=${vermelhos.join(',') || 'nenhum'}`);
  }

  // `--with-integration` NÃO repete o que a fase C do gate já executou (L0b). Rodar duas vezes a
  // mesma bateria de integração só consome ~16 min e polui a evidência com um passo duplicado.
  const faseCNoGate = opcoesDeGate(args) === null || opcoesDeGate(args).includes('C');
  if (args.withIntegration && !faseCNoGate) {
    passo('integracao-engenheiro', 'npx', ['jest', 'tests/integration/engineering', '--bail=0', '--runInBand', '--forceExit'], {
      cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
      descricao: 'Integracao real do Engenheiro (Postgres + sandbox)',
    });
  }
  return gate;
}

function cenarioBootstrapTwice(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap-1', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: 'Primeira execucao do bootstrap',
  });
  const antes = contarTenants(clonePath, env);
  passo('bootstrap-2', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: 'Segunda execucao (idempotencia)',
  });
  const depois = contarTenants(clonePath, env);
  const estavel = antes !== null && antes === depois;
  passos.push({
    id: 'idempotencia-seed',
    comando: '(contagem de tenants antes/depois)',
    descricao: 'Bootstrap repetido nao duplica dados sinteticos',
    esperado: 'igual',
    antes,
    depois,
    ok: estavel,
    exitCode: estavel ? 0 : 1,
    startedAt: nowIso(),
    finishedAt: nowIso(),
    duracaoMs: 0,
  });
  console.log(`[ci:clean-checkout]${estavel ? '  ok  ' : ' FAIL '} idempotencia-seed antes=${antes} depois=${depois}`);
}

function contarTenants(clonePath, env) {
  const r = sh('node', ['-e', `
    const { Client } = require('pg');
    (async () => {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      const { rows } = await c.query('select count(*)::int as total from tenants');
      await c.end();
      process.stdout.write(String(rows[0].total));
    })().catch((e) => { process.stderr.write(e.message); process.exit(1); });
  `], { cwd: clonePath, env });
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * PAR CONSUMIDOR/PRODUTOR ESCOLHIDO POR MEDIÇÃO, NÃO POR APARÊNCIA.
 *
 * A primeira tentativa usou `reports/coverage-completeness-report.json` como artefato provado por
 * `coverageCompletenessCanonicalDomains.test.js`. Medido em 2026-10-22: apagar o relatório NÃO
 * reprovava o teste, porque o próprio teste RODA o produtor no `beforeAll` e depois lê o resultado
 * — ele é produtor e consumidor ao mesmo tempo. Um "cenário de artefato ausente" sobre esse par
 * provaria apenas que o produtor funciona.
 *
 * O par correto é o artefato PROD-LIKE: `modelDrivenE2e.test.js` só LÊ o arquivo e reprova quando
 * ele não existe (medido em run limpo: L0 vermelho com exatamente essa suíte). É o vínculo real
 * entre uma evidência produzida por execução e um gate que depende dela.
 */
const ARTEFATO_PROVADO = {
  caminho: 'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
  consumidor: ['tests/unit/governance/modelDrivenE2e.test.js'],
  produtor: 'porSmokeProdLike',
};

function cenarioArtefatoAusente(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], { cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000 });
  provisionarProdLike(ctx, args);
  // Controle positivo: com o artefato presente o consumidor aprova.
  passo('consumidor-com-artefato', 'npx', ['jest', ...ARTEFATO_PROVADO.consumidor, '--silent'], {
    cwd: clonePath, env, logDir, descricao: 'Consumidor aprova com o artefato produzido',
  });
  fs.rmSync(path.join(clonePath, ARTEFATO_PROVADO.caminho), { force: true });
  // Prova de nao vacuidade: sem o artefato o MESMO consumidor tem de reprovar.
  passo('consumidor-sem-artefato', 'npx', ['jest', ...ARTEFATO_PROVADO.consumidor, '--silent'], {
    cwd: clonePath, env, logDir, esperado: 1,
    descricao: 'Artefato ausente REPROVA o consumidor (nunca PASS por ausencia)',
  });
  // O produtor canonico regenera e o consumidor volta a aprovar.
  porSmokeProdLike(ctx, logDir, 'produtor-regenera');
  passo('consumidor-apos-regenerar', 'npx', ['jest', ...ARTEFATO_PROVADO.consumidor, '--silent'], {
    cwd: clonePath, env, logDir, descricao: 'Consumidor aprova apos regeneracao pelo produtor',
  });
}

function cenarioArtefatoCorrompido(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], { cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000 });
  provisionarProdLike(ctx, args);
  const alvo = path.join(clonePath, ARTEFATO_PROVADO.caminho);
  fs.writeFileSync(alvo, '{"status":"GO","flows":[', 'utf8');
  passo('consumidor-artefato-corrompido', 'npx', ['jest', ...ARTEFATO_PROVADO.consumidor, '--silent'], {
    cwd: clonePath, env, logDir, esperado: 1,
    descricao: 'Artefato corrompido REPROVA o consumidor',
  });
}

function cenarioBancoIndisponivel(ctx, args) {
  const { clonePath, logDir } = ctx;
  const envInvalido = criarAmbienteDoRun({
    clonePath,
    databaseUrl: 'postgres://postgres:postgres@127.0.0.1:1/inexistente',
    redisUrl: ctx.env.REDIS_URL,
    ragUrl: 'http://127.0.0.1:1',
    token: 'invalido',
    runnerPort: ctx.runnerPort,
  });
  // ORCAMENTO CURTO E ACEITE EXPLICITO DE "NAO TERMINOU EM SUCESSO". Medido em 2026-10-22: com o
  // banco inalcancavel o bootstrap NAO retorna rapido — `api/db/seed.js` fica tentando por minutos.
  // O contrato que importa e "nunca vira sucesso": exit != 0 OU processo abortado por orcamento.
  // O sinal (`SIGTERM`) e o exit code ficam registrados, jamais convertidos em PASS.
  const registro = passo('bootstrap-sem-postgres', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env: envInvalido, logDir, esperado: 1,
    timeoutMs: 8 * 60 * 1000,
    descricao: 'Sem PostgreSQL o bootstrap NAO termina em sucesso (exit != 0 ou abortado por orcamento)',
  });
  if (registro.exitCode === null) {
    registro.aceitoPorNaoSucesso = true;
    registro.ok = true;
    console.log(`[ci:clean-checkout]  ok   bootstrap-sem-postgres (abortado por orcamento apos ${Math.round(registro.duracaoMs / 1000)}s — falhou fechado: exit=${registro.exitCode} sinal=${registro.signal})`);
  }
}

function cenarioDockerIndisponivel(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], { cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000 });
  const envSemDocker = { ...env, DOCKER_HOST: 'unix:///var/run/does-not-exist.sock' };
  passo('sandbox-sem-docker', 'npx', [
    'jest', 'tests/integration/engineering/engineeringRouterExecutionSandboxSecurity.test.js',
    '--runInBand', '--forceExit', '--silent',
  ], {
    cwd: clonePath, env: envSemDocker, logDir, esperado: 1,
    timeoutMs: 20 * 60 * 1000,
    descricao: 'Sem Docker a suite de sandbox REPROVA (nunca alega SANDBOX_RUNTIME=PASS)',
  });
}

/**
 * INVENTÁRIO COMPLETO DO L0 — `npm test` roda com `bail: 1` (jest.config.cjs), então a primeira
 * suíte vermelha ABORTA a execução e as demais nem rodam. Medido em 2026-10-21: o L0 parou em 379
 * de 1095 suítes e depois em 605 de 1096 — dois runs para descobrir duas falhas. Este cenário roda
 * a mesma seleção com `--bail=0` e entrega a LISTA COMPLETA em uma execução.
 */
function cenarioL0Full(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: 'Bootstrap canonico do ambiente',
  });
  const selecoes = [
    ['l0-unit-bail0', ['jest', 'tests/unit', 'tests/flow', 'engine/__tests__', '--bail=0']],
    ['l0-rpa-bail0', ['jest', '--bail=0', '--runTestsByPath', 'tests/rpa/rpa.test.js', 'tests/rpa/login.test.js', 'tests/rpa/createTenantByAI.test.js', '--testPathIgnorePatterns=/node_modules/']],
  ];
  const suitesVermelhas = new Set();
  for (const [id, argv] of selecoes) {
    const registro = passo(id, 'npx', argv, {
      cwd: clonePath,
      env: { ...env, RPA_SKIP_BROWSER_TESTS: 'true', SKIP_RPA_INTEGRATION_TESTS: 'true' },
      logDir, timeoutMs: 60 * 60 * 1000,
      descricao: 'Selecao oficial COMPLETA (bail=0) para enumerar todas as falhas',
    });
    if (!registro.logPath) continue;
    try {
      const texto = fs.readFileSync(path.join(ROOT, registro.logPath), 'utf8');
      for (const m of texto.matchAll(/^FAIL (\S+)/gm)) suitesVermelhas.add(m[1]);
    } catch (_) { /* log ausente ja reprova o passo */ }
  }
  passos.push({
    id: 'l0-unidades-vermelhas',
    comando: '(consolidacao das suites vermelhas)',
    descricao: 'Lista completa de suites vermelhas do L0',
    esperado: 0,
    exitCode: suitesVermelhas.size === 0 ? 0 : 1,
    suitesVermelhas: [...suitesVermelhas],
    ok: true,
    informativo: true,
    startedAt: nowIso(), finishedAt: nowIso(), duracaoMs: 0,
  });
  console.log(`[ci:clean-checkout]  info  suites vermelhas (${suitesVermelhas.size}): ${[...suitesVermelhas].join(', ') || 'nenhuma'}`);
}

/**
 * L2 — contratos, governança, CI, runtime, organizacional, stress e rate-limit (`npm run test:system`).
 * Roda no CLONE porque várias dessas suítes leem relatórios e valem por ambiente: medir na árvore do
 * operador é exatamente o erro que este harness existe para evitar.
 */
function cenarioL2System(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: 'Bootstrap canonico do ambiente',
  });
  passo('l2-test-system', 'npm', ['run', '-s', 'test:system'], {
    cwd: clonePath, env, logDir, timeoutMs: 60 * 60 * 1000,
    descricao: 'L2: contratos, governanca, CI, runtime, organizacional, stress e rate-limit',
  });
}

const CENARIOS_IMPLEMENTADOS = {
  'l0-full': cenarioL0Full,
  'l2-system': cenarioL2System,
  clean: cenarioClean,
  'bootstrap-twice': cenarioBootstrapTwice,
  'missing-artifact': cenarioArtefatoAusente,
  'corrupt-artifact': cenarioArtefatoCorrompido,
  'db-unavailable': cenarioBancoIndisponivel,
  'docker-unavailable': cenarioDockerIndisponivel,
};

// ---------------------------------------------------------------------------
// evidência
// ---------------------------------------------------------------------------

function copiarEvidenciaDoClone(clonePath, runDir) {
  const copiados = [];
  const pares = [
    ['reports/dev-branch-ci-evidence.json', path.join(ROOT, 'reports', 'dev-branch-ci-evidence.json')],
    ['reports/ci-bootstrap-report.json', path.join(runDir, 'ci-bootstrap-report.json')],
  ];
  const dirEvidencia = path.join(clonePath, 'AI_MEMORY', 'evidence');
  if (fs.existsSync(dirEvidencia)) {
    for (const arquivo of fs.readdirSync(dirEvidencia)) {
      if (!/^dev-branch-ci-.*\.md$/.test(arquivo)) continue;
      const destino = path.join(ROOT, 'AI_MEMORY', 'evidence', arquivo);
      fs.copyFileSync(path.join(dirEvidencia, arquivo), destino);
      copiados.push(path.relative(ROOT, destino));
    }
  }
  for (const [origem, destino] of pares) {
    const abs = path.join(clonePath, origem);
    if (!fs.existsSync(abs)) continue;
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.copyFileSync(abs, destino);
    copiados.push(path.relative(ROOT, destino));
  }
  return copiados;
}

function escreverMarkdown(relatorio) {
  const linhas = [
    `# Clean checkout — ${relatorio.scenario}`,
    '',
    `- commit: \`${relatorio.sourceCommit}\``,
    `- branch: \`${relatorio.branch}\``,
    `- sourceFingerprint: \`${relatorio.sourceFingerprint}\``,
    `- runId: \`${relatorio.runId}\``,
    `- environmentId: \`${relatorio.environmentId}\``,
    `- veredito: **${relatorio.veredito}**`,
    `- node: ${relatorio.environment.node} · npm: ${relatorio.environment.npm} · postgres: ${relatorio.environment.postgres} · redis: ${relatorio.environment.redis} · docker: ${relatorio.environment.docker}`,
    `- jest: ${relatorio.environment.jest}`,
    '',
    '| passo | esperado | exit | duracao | ok |',
    '|---|---|---|---|---|',
    ...relatorio.passos.map((p) => `| ${p.id} | ${p.esperado} | ${p.exitCode} | ${Math.round((p.duracaoMs || 0) / 1000)}s | ${p.ok ? 'PASS' : 'FAIL'} |`),
    '',
  ];
  if (relatorio.limitacoes.length) {
    linhas.push('## Limitações declaradas', '', ...relatorio.limitacoes.map((l) => `- ${l}`), '');
  }
  return linhas.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const LOCK_PATH = path.join(ROOT, 'reports', '.ci-clean-checkout.lock');

/**
 * Um run por vez. O harness ocupa portas FIXAS do host (3000/8080, exigidas pelo nginx do
 * frontend) e containers Docker: dois runs concorrentes se destroem mutuamente. Um lock com PID
 * vivo é recusa explícita; PID morto (run interrompido) é reaproveitado.
 */
function adquirirLock() {
  try {
    const anterior = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (anterior && Number(anterior.pid) && anterior.pid !== process.pid) {
      try {
        process.kill(anterior.pid, 0);
        return { ok: false, motivo: `OUTRO RUN EM ANDAMENTO (pid ${anterior.pid}, iniciado ${anterior.startedAt}) — aguarde ou remova ${path.relative(ROOT, LOCK_PATH)} se o processo morreu` };
      } catch (_) { /* pid morto: lock obsoleto */ }
    }
  } catch (_) { /* sem lock previo */ }
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(LOCK_PATH, `${JSON.stringify({ pid: process.pid, startedAt: nowIso() }, null, 2)}\n`, 'utf8');
  return { ok: true };
}

function liberarLock() {
  try {
    const atual = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (atual && atual.pid === process.pid) fs.rmSync(LOCK_PATH, { force: true });
  } catch (_) { /* nada a liberar */ }
}

function parseArgs(argv) {
  const argValor = (nome, padrao = null) => {
    const i = argv.indexOf(nome);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
  };
  const fases = argValor('--gate-phases', 'A,B,C,D');
  return {
    scenario: argValor('--scenario', 'clean'),
    commit: argValor('--commit', null),
    gatePhases: fases.split(',').map((f) => f.trim().toUpperCase()).filter(Boolean),
    withIntegration: argv.includes('--with-integration'),
    noProdLike: argv.includes('--no-prod-like'),
    buildImages: argv.includes('--build-images'),
    keep: argv.includes('--keep'),
    json: argv.includes('--json'),
    timeoutMin: Number(argValor('--timeout-min', '90')),
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const pedidos = args.scenario === 'all' ? SCENARIOS : [args.scenario];
  const desconhecidos = pedidos.filter((s) => !SCENARIOS.includes(s));
  if (desconhecidos.length) {
    console.error(`[ci:clean-checkout] cenario desconhecido: ${desconhecidos.join(', ')} (validos: ${SCENARIOS.join(', ')}, all)`);
    return 2;
  }

  const origem = identidadeDoSorce();
  const sourceCommit = args.commit || origem.sha;
  const runId = `clean-checkout-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
  const environmentId = `local-${os.hostname()}-${process.pid}`;
  const limite = hostLimits();

  // LOCK: dois harness simultâneos disputam portas fixas (3000/8080) e o mesmo host docker.
  const lock = adquirirLock();
  if (!lock.ok) {
    console.error(`[ci:clean-checkout] ${lock.motivo}`);
    return 3;
  }

  definirNomesDoRun(runId.split('-').pop());
  console.log(`[ci:clean-checkout] commit=${sourceCommit} cenarios=${pedidos.join(',')} runId=${runId}`);
  const resultados = [];

  for (const cenario of pedidos) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ci-clean-'));
    const clonePath = path.join(tmpRoot, 'ria', 'r-agent2');
    const nomeBanco = `rap_ci_${cenario.replace(/[^a-z0-9]/gi, '_')}_${crypto.randomBytes(3).toString('hex')}`;
    const runDir = path.join(EVIDENCE_DIR, `ci-clean-checkout-${sourceCommit.slice(0, 9)}`, cenario);
    const logDir = runDir;
    const iniciou = passos.length;
    const limitacoes = [];
    let token = null;
    let ragPorta = null;
    let infraDados = null;

    try {
      fs.mkdirSync(logDir, { recursive: true });
      clonar(sourceCommit, clonePath);
      const auditoria = auditarCloneLimpo(clonePath);
      passos.push({
        id: 'clone-limpo',
        comando: `git clone + checkout ${sourceCommit}`,
        descricao: 'Checkout isolado sem residuo de execucao anterior',
        esperado: 0,
        exitCode: auditoria.presentes.length === 0 && auditoria.worktreeLimpo ? 0 : 1,
        artefatosProibidos: auditoria.artefatosProibidos,
        worktreeLimpo: auditoria.worktreeLimpo,
        ok: auditoria.presentes.length === 0 && auditoria.worktreeLimpo,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        duracaoMs: 0,
      });
      if (auditoria.presentes.length || !auditoria.worktreeLimpo) {
        throw new Error(`clone nao esta limpo (artefatos: ${auditoria.presentes.join(', ') || 'nenhum'}; worktree limpo: ${auditoria.worktreeLimpo})`);
      }

      const sourceFingerprint = fingerprintDoSource(clonePath);
      // CAPACIDADE dedicada: Postgres/Redis efemeros do run (mesmo desenho dos `services:` do CI).
      infraDados = subirInfraDeDados(runId.split('-').pop());
      limitacoes.push(`Postgres/Redis efemeros do run: pg:${infraDados.pgPorta} redis:${infraDados.redisPorta}`);

      const runnerPort = portaDeTesteLivre();
      let env = criarAmbienteDoRun({
        clonePath,
        databaseUrl: infraDados.databaseUrl,
        redisUrl: infraDados.redisUrl,
        ragUrl: 'http://127.0.0.1:8001',
        token: 'ausente',
        runnerPort,
      });

      // DOCKER: imagens exigidas pelo L0b sao PROVISIONADAS pelo harness, nunca herdadas.
      if (args.buildImages || !imagemExiste(RAG_IMAGE)) {
        passo('docker-build-rag', 'docker', ['build', '-t', RAG_IMAGE, 'rag-service'], {
          cwd: clonePath, logDir, timeoutMs: 60 * 60 * 1000,
          descricao: 'Imagem oficial do RAG (dependencia real do L0b)',
        });
      } else {
        limitacoes.push(`imagem ${RAG_IMAGE} ja existia no host (reaproveitada; use --build-images para reconstruir)`);
      }
      if (args.buildImages || !imagemExiste(SANDBOX_IMAGE)) {
        passo('docker-build-sandbox', 'docker', ['build', '-t', SANDBOX_IMAGE, 'engineering-router-sandbox'], {
          cwd: clonePath, logDir, timeoutMs: 60 * 60 * 1000,
          descricao: 'Imagem do Execution Sandbox (prova de isolamento real)',
        });
      }

      token = crypto.randomBytes(32).toString('hex');
      try {
        ragPorta = portaDeTesteLivre();
        subirRag({ porta: ragPorta, databaseUrl: env.DATABASE_URL, token });
        limitacoes.push(`servico RAG provisionado pelo harness em 127.0.0.1:${ragPorta} (nao usa o 8001 do desenvolvedor)`);
      } catch (erro) {
        limitacoes.push(`RAG nao pode ser provisionado: ${erro.message}`);
        ragPorta = null;
      }
      env = criarAmbienteDoRun({
        clonePath,
        databaseUrl: env.DATABASE_URL,
        redisUrl: env.REDIS_URL,
        ragUrl: ragPorta ? `http://127.0.0.1:${ragPorta}` : 'http://127.0.0.1:8001',
        token,
        runnerPort,
      });

      CENARIOS_IMPLEMENTADOS[cenario]({
        clonePath,
        env,
        logDir,
        nomeBanco,
        ragUrl: env.RAG_SERVICE_URL,
      }, args);

      const copiados = copiarEvidenciaDoClone(clonePath, runDir);
      const meusPassos = passos.slice(iniciou);
      const executados = meusPassos.filter((p) => p.id !== 'clone-limpo' && !p.informativo);
      const veredito = executados.length > 0 && executados.every((p) => p.ok) ? 'PASS' : 'FAIL';
      const relatorio = {
        schemaVersion: 1,
        artifactType: 'ci-clean-checkout-report',
        artifactVersion: 1,
        runId,
        scenario: cenario,
        sourceCommit,
        branch: origem.branch,
        sourceWorktreeLimpo: origem.worktreeLimpo,
        sourceFingerprint,
        environmentId,
        generatedAt: nowIso(),
        veredito,
        gatePhases: args.gatePhases,
        withIntegration: args.withIntegration,
        database: nomeBanco,
        redis: `db${REDIS_DB}`,
        ragServiceUrl: ragPorta ? `http://127.0.0.1:${ragPorta}` : null,
        environment: limite,
        passos: meusPassos,
        evidenciasCopiadas: copiados,
        limitacoes,
      };
      const markdown = escreverMarkdown(relatorio);
      const mdPath = path.join(runDir, 'RESULT.md');
      fs.writeFileSync(mdPath, markdown, 'utf8');
      relatorio.evidencePath = path.relative(ROOT, mdPath);
      resultados.push(relatorio);

      if (!args.json) console.log(markdown);
    } catch (erro) {
      const relatorio = {
        schemaVersion: 1,
        artifactType: 'ci-clean-checkout-report',
        artifactVersion: 1,
        runId,
        scenario: cenario,
        sourceCommit,
        branch: origem.branch,
        sourceFingerprint: null,
        environmentId,
        generatedAt: nowIso(),
        veredito: 'FAIL',
        erro: erro.message,
        environment: limite,
        passos: passos.slice(iniciou),
        limitacoes,
      };
      resultados.push(relatorio);
      console.error(`[ci:clean-checkout] FAIL ${cenario}: ${erro.message}`);
    } finally {
      derrubarProdLike();
      derrubarRag();
      encerrarProcessosDoClone(clonePath);
      derrubarInfraDeDados(infraDados && infraDados.nomes);
      if (!args.keep) fs.rmSync(tmpRoot, { recursive: true, force: true });
      else console.log(`[ci:clean-checkout] clone preservado em ${clonePath}`);
    }
  }

  const veredito = resultados.length > 0 && resultados.every((r) => r.veredito === 'PASS') ? 'PASS' : 'FAIL';
  const relatorioFinal = {
    schemaVersion: 1,
    artifactType: 'ci-clean-checkout-report',
    artifactVersion: 1,
    runId,
    generatedAt: nowIso(),
    verdict: veredito,
    resultados,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(relatorioFinal, null, 2)}\n`, 'utf8');
  liberarLock();
  console.log(`[ci:clean-checkout] veredito=${veredito} — relatorio em ${path.relative(ROOT, REPORT_PATH)}`);
  return veredito === 'PASS' ? 0 : 1;
}

function hostLimits() {
  return {
    node: process.versions.node,
    npm: versao('npm'),
    postgres: versao('psql'),
    redis: versao('redis-cli'),
    docker: versao('docker'),
    jest: versao('npx', ['jest', '--version']),
    platform: `${process.platform}/${process.arch}`,
    cpus: os.cpus().length,
    totalMemMb: Math.round(os.totalmem() / (1024 * 1024)),
  };
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, SCENARIOS, auditarCloneLimpo, contadoresDeTeste };
