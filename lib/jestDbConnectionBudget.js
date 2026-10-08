'use strict';

/**
 * lib/jestDbConnectionBudget.js
 *
 * Orçamento de conexões do Postgres para execuções PARALELAS do Jest.
 *
 * ACHADO REAL (medido ao vivo em 2026-10-08, nesta máquina — não hipotético):
 *   - `max_connections = 100` (superusuário `postgres`, `superuser_reserved_connections = 3`).
 *   - `jest.config.cjs` NÃO limitava `maxWorkers` ⇒ default do Jest = CPUs − 1 = 11 (12 CPUs).
 *   - `tests/setup/engineeringRunnerGlobalSetup.js` carrega o `.env` no processo PRINCIPAL do
 *     Jest (sem sobrescrever valores explícitos) e os workers HERDAM esse `process.env` —
 *     medido com probe isolado: `[probe:WORKER] DB_POOL_MAX=40`.
 *   - O `.env` declara `DB_POOL_MAX=40` ⇒ teto de 40 conexões POR worker do Jest.
 *   - Resultado: 11 workers × 40 = 440 conexões pretendidas contra 100 existentes. Um batch de
 *     suítes de integração em paralelo morreu com `SequelizeConnectionError: sorry, too many
 *     clients already`, aparecendo como FALHA DE TESTE — não como saturação de infraestrutura.
 *
 * Note que o mecanismo é sutil e vale registrar: o Jest NÃO carrega `.env` sozinho; é o
 * `globalSetup` do PRÓPRIO repositório que injeta o valor de produção no processo de teste. Ler
 * apenas `jest.config.cjs` sugere um pool de 10 (default de `getDatabasePool()`) — a realidade
 * medida era 4x maior.
 *
 * O erro é intermitente, depende da ordem/escalonamento e polui diagnóstico (o mesmo batch
 * passa em série). Este módulo torna o estouro IMPOSSÍVEL POR CONSTRUÇÃO: o número de workers
 * passa a ser derivado do teto de conexões, em vez de depender do default da máquina.
 *
 * A regra é uma INVARIANTE, não um número mágico:
 *     workers × poolMax ≤ jestBudget ≤ connectionCeiling = max_connections − superuser_reserved
 *
 * `max_connections` é um recurso FINITO e compartilhado: o orçamento CLAMPA o teto do pool ao que
 * realmente existe e sinaliza `feasible:false` quando a reserva da aplicação não deixa nada para o
 * Jest — nunca infla o total disponível para "fechar a conta" (um orçamento que promete mais
 * conexões do que o banco tem é pior que nenhum: ele autoriza o estouro que deveria impedir).
 *
 * `appReserve` existe porque a API de dev roda EM PARALELO com a suíte e declara
 * `DB_POOL_MAX=40` no `.env` (medido); psql e ferramentas de observabilidade também consomem
 * conexões. `jestBudget` é o que sobra para o Jest depois dessa reserva.
 *
 * IMPORTANTE — não enfraquece nenhum gate: os runners oficiais de evidência
 * (`scripts/governance/run-release-suites.js`, `generate-domain-evidence.js`,
 * `generate-policy-evidence.js`) executam com `--runInBand` (1 worker, serial) e portanto
 * NUNCA dependeram deste orçamento. O que este módulo conserta é o caminho PARALELO.
 *
 * Módulo PURO: sem I/O, sem timers, sem `require` de terceiros — carregável no
 * `jest.config.cjs` (processo principal, antes de qualquer worker existir) e em teste unitário
 * determinístico.
 */

/** Teto real do Postgres local (`show max_connections`). */
const DEFAULT_MAX_CONNECTIONS = 100;
/** `superuser_reserved_connections` — conexões que o próprio Postgres guarda. */
const DEFAULT_SUPERUSER_RESERVED = 3;
/** Reserva para a API de dev (`DB_POOL_MAX=40` no `.env`) + psql/ferramentas. */
const DEFAULT_APP_RESERVE = 45;
/** Teto do pool por worker do Jest — pequeno de propósito: 1 worker raramente precisa de mais. */
const DEFAULT_POOL_MAX = 4;

function toInt(value, fallback, min) {
  const parsed = Number.parseInt(value, 10);
  const base = Number.isFinite(parsed) ? parsed : fallback;
  return base < min ? min : base;
}

/**
 * Deriva o orçamento de conexões e o teto de workers.
 *
 * @param {Object} [params]
 * @param {number} [params.maxConnections] - `max_connections` do Postgres.
 * @param {number} [params.superuserReserved] - `superuser_reserved_connections`.
 * @param {number} [params.appReserve] - conexões reservadas para API de dev e ferramentas.
 * @param {number} [params.poolMax] - teto de conexões POR worker do Jest (clampado ao orçamento).
 * @param {number} [params.cpus] - CPUs disponíveis (limite superior do Jest é `cpus - 1`).
 * @returns {{maxConnections:number, superuserReserved:number, appReserve:number,
 *   connectionCeiling:number, available:number, jestBudget:number, poolMax:number,
 *   requestedPoolMax:number, clamped:boolean, feasible:boolean, cpus:number, cpuBound:number,
 *   workers:number, allocated:number}}
 */
function resolveJestDbBudget({
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  superuserReserved = DEFAULT_SUPERUSER_RESERVED,
  appReserve = DEFAULT_APP_RESERVE,
  poolMax = DEFAULT_POOL_MAX,
  cpus = 1,
} = {}) {
  const max = toInt(maxConnections, DEFAULT_MAX_CONNECTIONS, 1);
  const reserved = toInt(superuserReserved, DEFAULT_SUPERUSER_RESERVED, 0);
  const reserve = toInt(appReserve, DEFAULT_APP_RESERVE, 0);
  const requestedPoolMax = toInt(poolMax, DEFAULT_POOL_MAX, 1);
  const cpuCount = toInt(cpus, 1, 1);

  // Teto REAL de conexões utilizáveis: nunca é inflado por `appReserve` nem por `poolMax`.
  const connectionCeiling = Math.max(1, max - reserved);
  const jestBudget = Math.max(0, connectionCeiling - reserve);

  // O teto por worker é clampado ao orçamento: pedir 100 conexões num banco que deixa 52 para o
  // Jest não pode virar "orçamento = 100". Um único worker ainda precisa caber.
  const pool = Math.min(requestedPoolMax, Math.max(1, jestBudget));

  const cpuBound = Math.max(1, cpuCount - 1);
  const workers = Math.max(1, Math.min(cpuBound, Math.floor(jestBudget / pool)));
  const allocated = workers * pool;

  return {
    maxConnections: max,
    superuserReserved: reserved,
    appReserve: reserve,
    connectionCeiling,
    available: connectionCeiling,
    jestBudget,
    poolMax: pool,
    requestedPoolMax,
    clamped: pool !== requestedPoolMax,
    // `jestBudget === 0` significa reserva da aplicação ≥ teto do banco: não há paralelismo
    // seguro possível. Com 1 worker e 1 conexão o teste roda, mas isso é DEGRADADO, não seguro.
    feasible: jestBudget >= 1 && allocated <= connectionCeiling,
    cpus: cpuCount,
    cpuBound,
    workers,
    allocated,
  };
}

/**
 * Aplica o orçamento ao ambiente do processo de teste (mutação explícita e injetável).
 *
 * Grava o teto EFETIVO (`budget.poolMax`, já clampado ao orçamento) — não apenas um default. É
 * isso que impede um `DB_POOL_MAX` declarado grande demais de ser honrado no worker e estourar o
 * Postgres: o orçamento e o pool real passam a ser o MESMO número, e `budget.clamped` registra
 * que o valor declarado foi reduzido (auditável, nunca silencioso).
 *
 * `DB_POOL_MIN` é limitado pelo teto (Sequelize sempre deve ter `min ≤ max`); o default é 0.
 *
 * @param {Object} [env] - ambiente a ajustar (default `process.env`).
 * @param {Object} [options] - mesmas opções de `resolveJestDbBudget`.
 * @returns {Object} orçamento resolvido.
 */
function applyJestDbBudgetToEnv(env = process.env, options = {}) {
  const declaredPoolMax = toInt(env.DB_POOL_MAX, options.poolMax === undefined ? DEFAULT_POOL_MAX : options.poolMax, 1);
  const budget = resolveJestDbBudget({ ...options, poolMax: declaredPoolMax });

  env.DB_POOL_MAX = String(budget.poolMax);
  env.DB_POOL_MIN = String(Math.min(toInt(env.DB_POOL_MIN, 0, 0), budget.poolMax));

  return budget;
}

module.exports = {
  DEFAULT_MAX_CONNECTIONS,
  DEFAULT_SUPERUSER_RESERVED,
  DEFAULT_APP_RESERVE,
  DEFAULT_POOL_MAX,
  resolveJestDbBudget,
  applyJestDbBudgetToEnv,
};
