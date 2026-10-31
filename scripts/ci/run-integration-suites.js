'use strict';

/**
 * Execução de `tests/integration` + `tests/tenant` em LOTES SERIAIS que respeitam os
 * `exclusiveGroups` canônicos de `config/canonical-release-suites.json`.
 *
 * POR QUE ISTO EXISTE (medido 2026-10-28, run 40737265748 do `jest.yml`): o job rodava
 * `npx jest tests/integration tests/tenant` com o paralelismo default e saíram 5 suítes / 26
 * testes vermelhos, todos da família que o manifesto declara EXCLUSIVA — worker global do laço de
 * bugs e banco de missões compartilhados (`bugWorkerBootFindsRealWorkE2E` travou esperando o ciclo
 * drenar por 120 s, `governanceApprovalFullWorkerE2E` e `missionSourceStaleReplanFullRouterE2E`
 * pelo mesmo motivo). O manifesto já diz `concurrency: "serial"` e explica o motivo de cada grupo;
 * o job simplesmente não o consumia. A correção não é afrouxar asserção: é executar no formato
 * canônico.
 *
 * Também aplica a disciplina de ambiente do runner autoritativo
 * (`scripts/governance/run-release-suites.js:408-440`), pelos mesmos defeitos já medidos lá:
 *
 *   · `ENGINEERING_RUNNER_URL`/`ENGINEERING_RUNNER_TOKEN` NÃO são herdados — o `.env` aponta para o
 *     runner de dev (:8090) e quem define o runner de teste é o `globalSetup` do Jest; subprocesso
 *     que recarrega o `.env` volta para :8090, onde nada escuta, e a task morre em
 *     `SANDBOX_UNAVAILABLE` levando a missão a BLOCKED (defeito medido em 2026-10-20);
 *   · `DB_POOL_MAX` é CLAMPADO (nunca inflado) porque um lote roda `--runInBand` e o pool grande do
 *     `.env` de dev estoura `max_connections` (defeito medido em 2026-10-20).
 *
 * Uso: `node scripts/ci/run-integration-suites.js [--dry-run]`
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

const DEFAULT_PATHS = ['tests/integration', 'tests/tenant'];
const DEFAULT_POOL_MAX = 12;

function loadManifest() {
  return require(path.join(ROOT, 'config', 'canonical-release-suites.json'));
}

/** `npx jest --listTests` devolve JSON com caminhos ABSOLUTOS; o manifesto usa caminhos relativos. */
function discoverSuites(paths = DEFAULT_PATHS) {
  const result = spawnSync('npx', ['jest', ...paths, '--listTests'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: sanitizedEnv(process.env),
  });
  if (result.status !== 0) {
    throw new Error(
      `não foi possível descobrir as suítes (jest --listTests exit=${result.status}): `
      + `${(result.stderr || result.stdout || '').slice(-800)}`,
    );
  }
  const absolutos = parseListTestsOutput(result.stdout);
  return absolutos
    .map((absoluto) => path.relative(ROOT, absoluto).split(path.sep).join('/'))
    .sort();
}

/**
 * `jest --listTests` imprime UM CAMINHO ABSOLUTO POR LINHA no stdout — e o `globalSetup` do projeto
 * também escreve ali (`[jest-global-setup] …`). Filtrar por "linha que é caminho absoluto de teste"
 * é o único jeito de não depender de o setup ficar em silêncio.
 */
function parseListTestsOutput(stdout) {
  return String(stdout || '')
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha.startsWith('/') && /\.test\.c?js$/.test(linha));
}

/**
 * Lotes do CI. Duas regras, ambas derivadas do manifesto:
 *
 *   1. `batchPaths` (fonte canônica) nunca põe duas suítes do MESMO grupo no mesmo lote;
 *   2. aqui vai um passo além, medido em 2026-10-28 (run 40741496599): suíte que pertence a
 *      QUALQUER grupo exclusivo roda SOZINHA no lote. Com a regra 1 apenas,
 *      `governanceApprovalFullWorkerE2E` dividiu lote com 5 suítes fora do grupo e continuou
 *      vermelha (`closed` null: o worker global não fechou o finding). O manifesto diz "uma por
 *      lote" na justificativa do grupo — e a justificativa é a especificação.
 */
function planBatches(suitePaths, { exclusiveGroups = [] } = {}) {
  const { batchPaths } = require(path.join(ROOT, 'scripts', 'governance', 'run-release-suites.js'));
  const base = batchPaths(suitePaths, { exclusiveGroups });

  const membros = new Set();
  for (const grupo of Array.isArray(exclusiveGroups) ? exclusiveGroups : []) {
    for (const suite of (grupo && grupo.suites) || []) membros.add(suite);
  }
  if (membros.size === 0) return base;

  const batches = [];
  for (const batch of base.batches) {
    const sozinhos = batch.suites.filter((suite) => membros.has(suite));
    const restantes = batch.suites.filter((suite) => !membros.has(suite));
    if (restantes.length > 0) batches.push({ index: batches.length, suites: restantes });
    for (const suite of sozinhos) batches.push({ index: batches.length, suites: [suite] });
  }
  return { batches, groups: base.groups };
}

/**
 * Ambiente do lote. Exposto para teste: é aqui que mora a disciplina que já custou ciclos.
 */
function sanitizedEnv(base = process.env, { poolMax = DEFAULT_POOL_MAX } = {}) {
  const env = { ...base };
  delete env.ENGINEERING_RUNNER_URL;
  delete env.ENGINEERING_RUNNER_TOKEN;
  const herdado = Number.parseInt(env.DB_POOL_MAX || '', 10);
  env.DB_POOL_MAX = String(Number.isFinite(herdado) && herdado > 0 ? Math.min(herdado, poolMax) : poolMax);
  return env;
}

function runBatch(suites, index, total) {
  console.log(`[integration-suites] lote ${index + 1}/${total}: ${suites.length} suíte(s)`);
  for (const suite of suites) console.log(`[integration-suites]   · ${suite}`);
  const result = spawnSync(
    'npx',
    ['jest', ...suites, '--runInBand', '--bail=0', '--forceExit', '--no-coverage'],
    { cwd: ROOT, stdio: 'inherit', env: sanitizedEnv(process.env) },
  );
  return result.status === 0;
}

function main(argv = process.argv.slice(2)) {
  const manifest = loadManifest();
  const execucao = manifest.execution || {};
  const exclusiveGroups = execucao.exclusiveGroups || [];

  const suites = discoverSuites();
  const { batches } = planBatches(suites, { exclusiveGroups });

  if (argv.includes('--dry-run')) {
    for (const [i, batch] of batches.entries()) {
      console.log(`[integration-suites] lote ${i + 1}/${batches.length}: ${batch.suites.join(' ')}`);
    }
    console.log(`[integration-suites] ${suites.length} suíte(s) em ${batches.length} lote(s) — dry-run, nada executado`);
    return 0;
  }

  const falhas = [];
  for (const [index, batch] of batches.entries()) {
    if (!runBatch(batch.suites, index, batches.length)) falhas.push(index + 1);
  }

  console.log(
    `[integration-suites] ${suites.length} suíte(s) em ${batches.length} lote(s) — `
    + `${falhas.length === 0 ? 'todos os lotes PASS' : `lotes vermelhos: ${falhas.join(', ')}`}`,
  );
  return falhas.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`[integration-suites] ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  main, discoverSuites, planBatches, sanitizedEnv, parseListTestsOutput, DEFAULT_PATHS, DEFAULT_POOL_MAX,
};
