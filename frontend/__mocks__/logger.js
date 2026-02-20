// Mock para logger que usa import.meta.env (CommonJS)
const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
module.exports = logger;
