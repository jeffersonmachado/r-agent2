'use strict';

/**
 * Regressão de INTEGRAÇÃO do orçamento de conexões (defeito medido em 2026-10-18).
 *
 * A fórmula de `lib/jestDbConnectionBudget.js` sempre esteve correta e tinha teste próprio
 * (`cpus: 12` ⇒ 11 workers). O que ninguém testava era o **uso**: `jest.config.cjs` chamava
 * `applyJestDbBudgetToEnv(process.env)` sem informar `cpus`, e o default do módulo é `cpus: 1`.
 * Consequência medida: `maxWorkers = 1` SEMPRE — o lote oficial (1052 suítes) rodava serial,
 * ~20 s por suíte, e o L0 levava horas (inviável na prática).
 *
 * Um teste de fórmula não pega isso: o defeito vive na LIGAÇÃO entre config e módulo. Aqui a
 * config real é carregada e o número de workers é conferido contra a máquina.
 */

const os = require('os');

describe('jest.config.cjs × orçamento de conexões (ligação, não fórmula)', () => {
  test('a config informa as CPUs reais da máquina (nunca cai no default 1)', () => {
    const antes = { DB_POOL_MAX: process.env.DB_POOL_MAX, DB_POOL_MIN: process.env.DB_POOL_MIN };
    let cfg;
    try {
      cfg = require('../../jest.config.cjs');
    } finally {
      // A config MUTA o env de propósito (aplica o teto do pool); restaura para não
      // contaminar outros arquivos executados no mesmo worker.
      if (antes.DB_POOL_MAX === undefined) delete process.env.DB_POOL_MAX;
      else process.env.DB_POOL_MAX = antes.DB_POOL_MAX;
      if (antes.DB_POOL_MIN === undefined) delete process.env.DB_POOL_MIN;
      else process.env.DB_POOL_MIN = antes.DB_POOL_MIN;
    }

    const cpus = Math.max(1, os.cpus().length);
    expect(typeof cfg.maxWorkers).toBe('number');
    // Com mais de 1 CPU, workers = 1 só é aceitável se o ORÇAMENTO não permitir mais.
    if (cpus > 1) {
      expect(cfg.maxWorkers).toBeGreaterThan(1);
    }
    expect(cfg.maxWorkers).toBeLessThanOrEqual(Math.max(1, cpus - 1));
  });

  test('workers × pool nunca excede o teto de conexões do Postgres', () => {
    const { resolveJestDbBudget } = require('../../lib/jestDbConnectionBudget');
    const antes = { DB_POOL_MAX: process.env.DB_POOL_MAX, DB_POOL_MIN: process.env.DB_POOL_MIN };
    let cfg;
    try {
      cfg = require('../../jest.config.cjs');
    } finally {
      if (antes.DB_POOL_MAX === undefined) delete process.env.DB_POOL_MAX;
      else process.env.DB_POOL_MAX = antes.DB_POOL_MAX;
      if (antes.DB_POOL_MIN === undefined) delete process.env.DB_POOL_MIN;
      else process.env.DB_POOL_MIN = antes.DB_POOL_MIN;
    }

    const budget = resolveJestDbBudget({ cpus: os.cpus().length });
    expect(cfg.maxWorkers).toBe(budget.workers);
    expect(cfg.maxWorkers * budget.poolMax).toBeLessThanOrEqual(budget.jestBudget);
    expect(budget.allocated).toBeLessThanOrEqual(budget.connectionCeiling);
  });
});
