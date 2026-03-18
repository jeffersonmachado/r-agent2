'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('audioTranscriptionService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    delete global.fetch;
  });

  test('transcribeAudio tolerates hostile error.message getter from tenant key lookup failure', async () => {
    const hostileError = {
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('../../api/services/tenantAIService', () => ({
      getDecryptedAPIKey: jest.fn(async () => {
        throw hostileError;
      }),
    }));

    const { transcribeAudio } = require('../../api/services/audioTranscriptionService');

    const out = await transcribeAudio({
      audioData: Buffer.from('audio'),
      provider: 'whisper',
      tenantId: 'tenant-1',
    });

    expect(out).toEqual({
      text: '[Erro ao transcrever áudio: ]',
      error: '',
      provider: 'whisper',
    });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/audioTranscriptionService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});