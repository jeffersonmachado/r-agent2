module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  moduleFileExtensions: ['js', 'jsx', 'json', 'node'],
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  transformIgnorePatterns: [
    '/node_modules/(?!(react|@testing-library|@babel|@whiskeysockets/baileys)/)',
  ],
  moduleNameMapper: {
    '^../api/client$': '<rootDir>/__mocks__/client.js',
    '^./client$': '<rootDir>/__mocks__/client.js',
    '^../utils/logger$': '<rootDir>/__mocks__/logger.js',
    '^./logger$': '<rootDir>/__mocks__/logger.js',
    '^../utils$': '<rootDir>/__mocks__/index.js',
    '^./index$': '<rootDir>/__mocks__/index.js',
    '^../context/WebSocketContext$': '<rootDir>/__mocks__/WebSocketContext.jsx',
    '^./WebSocketContext$': '<rootDir>/__mocks__/WebSocketContext.jsx',
  },
};
