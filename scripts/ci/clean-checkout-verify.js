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

function imagemExiste(imagem) {
  return sh('docker', ['image', 'inspect', imagem]).status === 0;
}

function subirRag({ porta, databaseUrl, token }) {
  sh('docker', ['rm', '-f', 'rap-ci-clean-rag']);
  const r = sh('docker', ['run', '-d', '--name', 'rap-ci-clean-rag', '--network', 'host',
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
  const logs = sh('docker', ['logs', '--tail', '40', 'rap-ci-clean-rag']);
  throw new Error(`RAG nao respondeu em /health na porta ${porta}: ${(logs.stderr || logs.stdout).trim()}`);
}

function derrubarRag() {
  sh('docker', ['rm', '-f', 'rap-ci-clean-rag']);
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

  let checkout = sh('git', ['checkout', '--detach', sha], { cwd: destino });
  if (checkout.status !== 0) {
    sh('git', ['fetch', '--no-tags', 'origin', sha], { cwd: destino });
    checkout = sh('git', ['checkout', '--detach', sha], { cwd: destino });
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
 * que traz `.env`, `reports/` ou `dist/` não prova nada: passaria a depender do estado do operador.
 */
function auditarCloneLimpo(destino) {
  const proibidos = [
    '.env', '.token.env', 'node_modules', 'reports', 'dist', 'api/data/config.json',
    'qa/smoke/prod-like/qa-waves-operational-prod-like-smoke.json',
  ];
  const presentes = proibidos.filter((rel) => fs.existsSync(path.join(destino, rel)));
  const status = String(sh('git', ['status', '--porcelain'], { cwd: destino }).stdout || '').trim();
  return { presentes, worktreeLimpo: status === '', artefatosProibidos: presentes };
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

function criarAmbienteDoRun({ clonePath, databaseUrl, ragUrl, token, extras = {} }) {
  return {
    CI: 'true',
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: `redis://${REDIS_HOST}:6379/${REDIS_DB}`,
    RAG_SERVICE_URL: ragUrl,
    RAG_INTERNAL_TOKEN: token,
    ENGINEERING_RUNNER_URL: 'http://127.0.0.1:8097',
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

function cenarioClean(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('npm-ci-bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: 'Bootstrap canonico do ambiente (npm run ci:bootstrap)',
  });
  executarGate(clonePath, env, args, logDir);

  if (args.withIntegration) {
    passo('integracao-engenheiro', 'npx', ['jest', 'tests/integration/engineering', '--bail=0', '--runInBand', '--forceExit'], {
      cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000,
      descricao: 'Integracao real do Engenheiro (Postgres + sandbox)',
    });
  }
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

const ARTEFATO_PROVADO = {
  caminho: 'reports/coverage-completeness-report.json',
  consumidor: ['tests/unit/governance/coverageCompletenessCanonicalDomains.test.js'],
  produtor: ['run', '-s', 'validate:coverage-completeness'],
};

function cenarioArtefatoAusente(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], { cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000 });
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
  passo('produtor-regenera', 'npm', ARTEFATO_PROVADO.produtor, { cwd: clonePath, env, logDir });
  passo('consumidor-apos-regenerar', 'npx', ['jest', ...ARTEFATO_PROVADO.consumidor, '--silent'], {
    cwd: clonePath, env, logDir, descricao: 'Consumidor aprova apos regeneracao pelo produtor',
  });
}

function cenarioArtefatoCorrompido(ctx, args) {
  const { clonePath, env, logDir } = ctx;
  passo('bootstrap', 'npm', ['run', '-s', 'ci:bootstrap'], { cwd: clonePath, env, logDir, timeoutMs: args.timeoutMin * 60 * 1000 });
  const alvo = path.join(clonePath, ARTEFATO_PROVADO.caminho);
  fs.writeFileSync(alvo, '{"artifactType":"coverage-completeness-report","status":"PASS"', 'utf8');
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
    ragUrl: 'http://127.0.0.1:1',
    token: 'invalido',
  });
  passo('bootstrap-sem-postgres', 'npm', ['run', '-s', 'ci:bootstrap'], {
    cwd: clonePath, env: envInvalido, logDir, esperado: 1,
    timeoutMs: args.timeoutMin * 60 * 1000,
    descricao: 'Sem PostgreSQL o bootstrap tem de FALHAR (nenhum skip silencioso)',
  });
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

const CENARIOS_IMPLEMENTADOS = {
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
      criarBanco(nomeBanco);
      limparRedis();

      let env = criarAmbienteDoRun({
        clonePath,
        databaseUrl: `postgres://postgres:postgres@127.0.0.1:5432/${nomeBanco}`,
        ragUrl: 'http://127.0.0.1:8001',
        token: 'ausente',
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
        ragUrl: ragPorta ? `http://127.0.0.1:${ragPorta}` : 'http://127.0.0.1:8001',
        token,
      });

      CENARIOS_IMPLEMENTADOS[cenario]({ clonePath, env, logDir, nomeBanco }, args);

      const copiados = copiarEvidenciaDoClone(clonePath, runDir);
      const meusPassos = passos.slice(iniciou);
      const executados = meusPassos.filter((p) => p.id !== 'clone-limpo');
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
      derrubarRag();
      encerrarProcessosDoClone(clonePath);
      destruirBanco(nomeBanco);
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
