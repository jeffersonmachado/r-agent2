const fs = require('fs');

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

