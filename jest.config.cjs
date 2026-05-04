/** @type {import('jest').Config} */
module.exports = {
  // Timeout global para todos os testes (10 segundos)
  testTimeout: 10000,
  
  // Proteção contra travamentos
  bail: 1, // Para após primeiro teste falhar (útil para debug)
  
  // Limpeza automática
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  
  // Setup e teardown globais
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  
  testEnvironment: 'node',
  roots: ['<rootDir>/engine', '<rootDir>/api', '<rootDir>/tests', '<rootDir>/qa', '<rootDir>/qa-mesh', '<rootDir>/lib'],
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/rpa/',
  ],
  verbose: true,
};

