'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('nlpService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete global.fetch;
  });

  test('analyzeText rethrows hostile fetch error without crashing log interpolation', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    global.fetch = jest.fn(async () => {
      throw hostileError;
    });

    const logger = require('../../api/utils/logger');
    const { analyzeText } = require('../../api/services/nlpService');

    await expect(analyzeText('teste', true)).rejects.toBe(hostileError);
    expect(logger.error).toHaveBeenCalledWith('[NLPService] Erro ao analisar texto: ', hostileError);
  });

  test('analyzeText handles hostile text toString by returning validation error', async () => {
    const hostileText = {
      toString() {
        throw new Error('poisoned text toString');
      },
    };

    const { analyzeText } = require('../../api/services/nlpService');
    await expect(analyzeText(hostileText, true)).rejects.toThrow('Texto não pode ser vazio');
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/nlpService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sanitizedSource = source
      .split('\n')
      .filter((line) => !line.includes('String(err.message)'))
      .join('\n');

    expect(sanitizedSource).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});
