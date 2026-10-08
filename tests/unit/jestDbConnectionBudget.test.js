'use strict';

/**
 * tests/unit/jestDbConnectionBudget.test.js
 *
 * Regressão do defeito real medido em 2026-10-08: batch de suítes Jest em PARALELO morrendo com
 * `SequelizeConnectionError: sorry, too many clients already`. Causa medida: os workers HERDAM o
 * `process.env` do processo principal, que o globalSetup populou com o `.env` — e o `.env` declara
 * `DB_POOL_MAX=40`. Com `maxWorkers` no default (`cpus - 1` = 11) eram 440 conexões pretendidas
 * contra `max_connections = 100`.
 *
 * O teste trava a INVARIANTE (`workers × poolMax ≤ orçamento`), não um número mágico — para valer
 * também em máquinas/CI com outra contagem de CPUs.
 */

const path = require('path');
const {
  DEFAULT_POOL_MAX,
  resolveJestDbBudget,
  applyJestDbBudgetToEnv,
} = require('../../lib/jestDbConnectionBudget');

// Valores medidos ao vivo nesta máquina (`show max_connections`, `current_setting(...)`).
const MEDIDO = { maxConnections: 100, superuserReserved: 3, appReserve: 45 };

// Teto por worker que o `.env` declarava e que os workers REALMENTE herdavam
// (medido por probe isolado: `[probe:WORKER] DB_POOL_MAX=40`).
const POOL_HERDADO_PRE_FIX = 40;

describe('orçamento de conexões do Jest (paralelismo sem estourar o Postgres)', () => {
  test('nesta máquina (12 CPUs) o teto do pool cabe no orçamento', () => {
    const budget = resolveJestDbBudget({ ...MEDIDO, poolMax: DEFAULT_POOL_MAX, cpus: 12 });

    expect(budget.workers).toBe(11); // CPUs − 1, ainda permitido pelo orçamento
    expect(budget.workers * budget.poolMax).toBeLessThanOrEqual(budget.jestBudget);
    expect(budget.jestBudget).toBeLessThanOrEqual(budget.available);
  });

  test('o defeito medido (pool de 40 herdado do .env) era estouro — e o orçamento se auto-corrige', () => {
    const estouro = resolveJestDbBudget({ ...MEDIDO, poolMax: POOL_HERDADO_PRE_FIX, cpus: 12 });

    // Cenário PRÉ-FIX, como medido: 11 workers do default do Jest × 40 conexões herdadas do
    // `.env` = 440 pretendidas contra as 97 realmente utilizáveis.
    expect(11 * POOL_HERDADO_PRE_FIX).toBeGreaterThan(estouro.connectionCeiling);

    // O orçamento não estoura: reduz os workers para caber.
    expect(estouro.workers).toBeLessThan(11);
    expect(estouro.workers * estouro.poolMax).toBeLessThanOrEqual(estouro.jestBudget);
  });

  test('em máquina grande o limite passa a ser o orçamento, não a contagem de CPUs', () => {
    const budget = resolveJestDbBudget({ ...MEDIDO, poolMax: DEFAULT_POOL_MAX, cpus: 64 });

    expect(budget.cpuBound).toBe(63);
    expect(budget.workers).toBe(13);
    expect(budget.workers).toBeLessThan(budget.cpuBound);
    expect(budget.workers * budget.poolMax).toBeLessThanOrEqual(budget.jestBudget);
  });

  test('a invariante vale para toda a faixa de CPUs e de tetos de pool', () => {
    for (let cpus = 1; cpus <= 64; cpus += 1) {
      for (const poolMax of [1, 2, 3, 4, 5, 10, 40, 100]) {
        const budget = resolveJestDbBudget({ ...MEDIDO, poolMax, cpus });

        expect(budget.workers).toBeGreaterThanOrEqual(1);
        // O teto pedido nunca AUMENTA (o banco é finito) e nunca passa do teto real de conexões.
        expect(budget.poolMax).toBeLessThanOrEqual(poolMax);
        expect(budget.poolMax).toBeLessThanOrEqual(budget.connectionCeiling);
        expect(budget.workers * budget.poolMax).toBeLessThanOrEqual(budget.jestBudget);
        expect(budget.jestBudget).toBeLessThanOrEqual(budget.connectionCeiling);
        expect(budget.connectionCeiling).toBe(MEDIDO.maxConnections - MEDIDO.superuserReserved);
      }
    }
  });

  test('pedir mais conexões do que o banco tem é CLAMPADO, não inflado', () => {
    const budget = resolveJestDbBudget({ ...MEDIDO, poolMax: 100, cpus: 12 });

    expect(budget.requestedPoolMax).toBe(100);
    expect(budget.clamped).toBe(true);
    expect(budget.poolMax).toBe(budget.jestBudget); // cabe o orçamento inteiro, nunca 100
    expect(budget.poolMax).toBeLessThanOrEqual(budget.connectionCeiling);
    expect(budget.feasible).toBe(true);
  });

  test('nunca devolve worker/pool degenerado, mesmo com entrada absurda', () => {
    const budget = resolveJestDbBudget({
      maxConnections: 0, superuserReserved: -5, appReserve: 1e9, poolMax: 0, cpus: 0,
    });

    expect(budget.poolMax).toBeGreaterThanOrEqual(1);
    expect(budget.workers).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(budget.workers)).toBe(true);
    // Reserva da aplicação ≥ teto do banco: roda 1 worker, mas o orçamento ADMITE que é degradado.
    expect(budget.feasible).toBe(false);
  });

  test('env: preenche o teto quando ausente, respeita valor viável e CLAMPA valor inviável', () => {
    const ausente = {};
    const budgetAusente = applyJestDbBudgetToEnv(ausente);

    expect(ausente.DB_POOL_MAX).toBe(String(DEFAULT_POOL_MAX));
    expect(ausente.DB_POOL_MIN).toBe('0');
    expect(budgetAusente.poolMax).toBe(DEFAULT_POOL_MAX);
    expect(budgetAusente.clamped).toBe(false);

    // `DB_POOL_MAX=40` (o valor do `.env` da API) é viável: honrado como está.
    const viavel = { DB_POOL_MAX: '40', DB_POOL_MIN: '0' };
    const budgetViavel = applyJestDbBudgetToEnv(viavel);

    expect(viavel.DB_POOL_MAX).toBe('40');
    expect(budgetViavel.poolMax).toBe(40);
    expect(budgetViavel.clamped).toBe(false);
    expect(budgetViavel.workers * 40).toBeLessThanOrEqual(budgetViavel.jestBudget);

    // `DB_POOL_MAX=100` num banco de 100 conexões é inviável: o env é reescrito para o orçamento
    // REAL, senão o worker abriria 100 e o orçamento seria decorativo.
    const inviavel = { DB_POOL_MAX: '100' };
    const budgetInviavel = applyJestDbBudgetToEnv(inviavel);

    expect(budgetInviavel.clamped).toBe(true);
    expect(Number(inviavel.DB_POOL_MAX)).toBe(budgetInviavel.poolMax);
    expect(Number(inviavel.DB_POOL_MAX)).toBeLessThanOrEqual(budgetInviavel.connectionCeiling);

    // `min ≤ max` é sempre garantido no env que os workers herdam.
    const minAlto = { DB_POOL_MAX: '4', DB_POOL_MIN: '9' };
    applyJestDbBudgetToEnv(minAlto);
    expect(Number(minAlto.DB_POOL_MIN)).toBeLessThanOrEqual(Number(minAlto.DB_POOL_MAX));
  });

  test('o jest.config.cjs real respeita a invariante (guarda contra regressão do defeito)', () => {
    const config = require(path.join(__dirname, '..', '..', 'jest.config.cjs'));
    const budget = resolveJestDbBudget({ poolMax: Number(process.env.DB_POOL_MAX) });

    expect(typeof config.maxWorkers).toBe('number');
    expect(config.maxWorkers).toBeGreaterThanOrEqual(1);
    expect(config.maxWorkers).toBeLessThanOrEqual(budget.cpuBound);
    expect(config.maxWorkers * budget.poolMax).toBeLessThanOrEqual(budget.jestBudget);
  });

  test('o teto do pool chega ao WORKER (onde o Sequelize realmente é instanciado)', () => {
    // Este teste roda DENTRO de um worker do Jest: se o valor não chegasse aqui, cada worker
    // abriria o pool default de 10 e o defeito voltaria sem nenhum sinal no processo principal.
    //
    // A asserção compara com o PRÓPRIO ambiente (não com uma constante): um `DB_POOL_MAX`
    // declarado pelo operador é legítimo e deve apenas reduzir o número de workers — o teste é
    // sobre a chave existir no worker e ser o que o Sequelize realmente usa, não sobre o valor.
    const poolMaxDoAmbiente = Number(process.env.DB_POOL_MAX);
    expect(Number.isInteger(poolMaxDoAmbiente)).toBe(true);
    expect(poolMaxDoAmbiente).toBeGreaterThanOrEqual(1);

    const { getDatabasePool } = require('../../api/utils/config');
    expect(getDatabasePool()).toEqual({
      min: Number(process.env.DB_POOL_MIN),
      max: poolMaxDoAmbiente,
    });
  });
});
