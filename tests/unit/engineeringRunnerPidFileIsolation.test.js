'use strict';

/**
 * Regressão do CROSS-KILL entre sessões de teste (medido em 2026-10-20).
 *
 * O pid file do Engineering Runner de teste tinha nome FIXO, então duas sessões no mesmo
 * repositório compartilhavam o registro: o teardown de uma lia o pid da outra e matava o runner
 * alheio. Sintomas: `SANDBOX_UNAVAILABLE ... fetch failed` em suítes que passam isoladas e
 * `RUNTIME_FAIL` em um item diferente a cada coleta.
 *
 * A correção é o nome carregar a porta — a identidade do runner de teste.
 */

const path = require('path');

const SETUP_PATH = '../../tests/setup/engineeringRunnerGlobalSetup';

function loadSetupWithPort(port) {
  const previous = process.env.ENGINEERING_RUNNER_TEST_PORT;
  process.env.ENGINEERING_RUNNER_TEST_PORT = String(port);
  jest.resetModules();
  try {
    return require(SETUP_PATH);
  } finally {
    if (previous === undefined) delete process.env.ENGINEERING_RUNNER_TEST_PORT;
    else process.env.ENGINEERING_RUNNER_TEST_PORT = previous;
  }
}

describe('engineeringRunner pid file — isolamento por porta', () => {
  test('o pid file carrega a porta do runner de teste', () => {
    const setup = loadSetupWithPort(8123);
    expect(path.basename(setup.PID_FILE)).toBe('.jest-engineering-runner-8123.pid');
  });

  test('portas diferentes produzem arquivos diferentes (nenhuma sessão mata o runner da outra)', () => {
    const a = loadSetupWithPort(8101).PID_FILE;
    const b = loadSetupWithPort(8102).PID_FILE;
    expect(a).not.toBe(b);
  });

  test('o arquivo vive na raiz do repositório, não em diretório transitório', () => {
    const setup = loadSetupWithPort(8097);
    expect(path.isAbsolute(setup.PID_FILE)).toBe(true);
    expect(path.dirname(setup.PID_FILE)).toBe(path.resolve(__dirname, '..', '..'));
  });
});
