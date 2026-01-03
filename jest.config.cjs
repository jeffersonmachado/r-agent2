/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/engine', '<rootDir>/api', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.test.js', '**/*.test.js'],
  verbose: true,
};


