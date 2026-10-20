'use strict';

/**
 * ORDEM DAS VARIÁVEIS DO ENGINEERING RUNNER NO GLOBALSETUP — regressão adversarial.
 *
 * DEFEITO REAL MEDIDO (2026-10-20, selo V2 do run …db420779): o `globalSetup` do Jest atribuía
 * `process.env.ENGINEERING_RUNNER_URL` (porta 8097, runner de teste) SOMENTE depois de
 * `waitForHealth` — ou seja, DEPOIS de o processo do runner já ter nascido com
 * `{...process.env}`, que naquele instante trazia a URL do `.env` (`127.0.0.1:8090`, endereço de
 * dev). Medido com sonda por processo: o runner nascia com `url=…:8090` e `port=8097`.
 *
 * Consequência: `SANDBOX_UNAVAILABLE ... :8090: fetch failed` em suítes que dependem do sandbox
 * real (fix task → BLOCKED_INFRA → finding não fecha), derrubando suítes que passam isoladas.
 */

const fs = require('fs');
const path = require('path');

const SETUP = path.join(__dirname, '..', '..', '..', 'tests', 'setup', 'engineeringRunnerGlobalSetup.js');

describe('engineeringRunnerGlobalSetup — env do runner definida ANTES do spawn', () => {
  const fonte = fs.readFileSync(SETUP, 'utf8');

  test('a atribuição de ENGINEERING_RUNNER_URL existe', () => {
    expect(fonte).toContain('process.env.ENGINEERING_RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`');
    expect(fonte).toContain('process.env.ENGINEERING_RUNNER_TOKEN = RUNNER_TOKEN');
  });

  test('a atribuição vem ANTES do spawn do runner (nunca depois)', () => {
    const posAtribuicao = fonte.indexOf('process.env.ENGINEERING_RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`');
    const posSpawn = fonte.indexOf('const child = spawn(process.execPath');
    expect(posAtribuicao).toBeGreaterThan(0);
    expect(posSpawn).toBeGreaterThan(0);
    expect(posAtribuicao).toBeLessThan(posSpawn);
  });

  test('o filho herda process.env (é por isso que a ordem importa)', () => {
    expect(fonte).toMatch(/env:\s*\{\s*\.\.\.process\.env/);
  });
});
