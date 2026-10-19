const fs = require('fs');
const os = require('os');
const { applyJestDbBudgetToEnv } = require('./lib/jestDbConnectionBudget');

// ORÇAMENTO DE CONEXÕES DO POSTGRES (defeito real medido em 2026-10-08):
// `max_connections=100`. Os workers do Jest herdam `process.env` do processo principal — que o
// `tests/setup/engineeringRunnerGlobalSetup.js` populou com o `.env` — e o `.env` declara
// `DB_POOL_MAX=40` (medido no worker por probe: DB_POOL_MAX=40). Com o default
// `maxWorkers = cpus - 1` = 11, isso dava 11 × 40 = 440 conexões pretendidas contra 100
// existentes: batches de suítes em paralelo morriam com "sorry, too many clients already",
// um erro de infraestrutura disfarçado de falha de teste.
// `maxWorkers` agora é DERIVADO do teto de conexões (ver lib/jestDbConnectionBudget.js): o
// número de workers e o pool por worker são dimensionados juntos. Rodar com `--runInBand`
// (runners oficiais de evidência) continua sendo 1 worker.
//
// DEFEITO MEDIDO (2026-10-18): a chamada não passava `cpus`, e o default do módulo é `cpus: 1`
// — resultado: `workers = 1` SEMPRE. O lote oficial de 1052 suítes rodava SERIAL (~1 suíte a
// cada 20 s) e o L0 se tornava inviável na prática. A fórmula sempre esteve certa
// (`cpus: 12` ⇒ 11 workers); o que faltava era informar as CPUs REAIS da máquina.
const dbBudget = applyJestDbBudgetToEnv(process.env, { cpus: os.cpus().length });

// Pacote irmão @results/auth (fora do repo em /opt/results/ria/): incluído nos
// roots apenas quando existe, para que clones/CI sem o diretório não falhem
// (o CI usa vendor/auth copiado para ../../packages/auth antes do npm ci).
const EXTERNAL_PACKAGES_ROOT = '/opt/results/packages';
const roots = ['<rootDir>/engine', '<rootDir>/api', '<rootDir>/tests', '<rootDir>/qa', '<rootDir>/qa-mesh', '<rootDir>/lib'];
if (fs.existsSync(EXTERNAL_PACKAGES_ROOT)) {
  roots.push(EXTERNAL_PACKAGES_ROOT);
}

/** @type {import('jest').Config} */
module.exports = {
  // Timeout global para todos os testes (10 segundos)
  testTimeout: 10000,

  // Paralelismo seguro: teto derivado do orçamento de conexões do Postgres
  // (workers × DB_POOL_MAX ≤ orçamento). Nunca o default `cpus - 1` sem essa conta.
  maxWorkers: dbBudget.workers,

  // Proteção contra travamentos
  bail: 1, // Para após primeiro teste falhar (útil para debug)

  // Testes deixam handles abertos (Sequelize/timers) — sem forceExit o Jest
  // imprime "Jest did not exit" e trava o `system:validate` (execSync) para
  // sempre. Os testes já passaram; o forceExit só evita o hang de saída.
  forceExit: true,
  
  // Limpeza automática
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  
  // Setup e teardown globais
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // ER-V1-SEAL-003 (Dedicated Execution Runner): sobe o Engineering Runner REAL como processo
  // separado antes de toda a suíte (mesma separação de processo que produção — a API nunca
  // chama executionSandbox.js diretamente) e o encerra ao final. Testes do Engineering Router
  // que exercitam execução real (testRunnerService/runTestCommands) falam com ele via HTTP.
  globalSetup: '<rootDir>/tests/setup/engineeringRunnerGlobalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/engineeringRunnerGlobalTeardown.js',
  
  testEnvironment: 'node',
  roots,
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/rpa/',
    '<rootDir>/tests/fixtures/engineering-router-sandbox/',
  ],
  verbose: true,
};

