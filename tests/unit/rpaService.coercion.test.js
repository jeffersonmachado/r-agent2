'use strict';

const fs = require('fs');
const path = require('path');

jest.mock('../../api/utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../rpa/rpaTestRunner', () => ({
  RpaTestRunner: jest.fn(),
}));

jest.mock('../../rpa/actionRecorder', () => ({
  ActionRecorder: jest.fn(),
}));

jest.mock('../../api/utils/urlNormalizer', () => ({
  normalizeRpaTestUrls: jest.fn((urls) => urls),
}));

describe('rpaService coercion hardening', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('startManualRecording: tolera seedName hostil sem lançar exceção', async () => {
    jest.doMock('../../tests/rpa/recorder/rpaRecorder', () => ({
      RpaRecorder: class RpaRecorderMock {
        async init() {}
        async startRecording() {}
        async stopRecording() { return { seedPath: '/tmp/seed.json' }; }
        async close() {}
      },
    }));

    jest.doMock('../../tests/rpa/rpaConfig', () => ({
      urls: { frontend: 'http://localhost:3000' },
    }));

    const svc = require('../../api/services/rpaService');

    const hostileSeedName = {};
    Object.defineProperty(hostileSeedName, 'toString', {
      get() {
        throw new Error('getter hostil em seedName');
      },
      enumerable: true,
    });

    const out = await svc.startManualRecording(hostileSeedName, 'http://example.com');

    expect(out.success).toBe(false);
    expect(typeof out.error).toBe('string');
  });

  test('stopManualRecording/getRecordingStatus: toleram recordingId hostil', async () => {
    jest.doMock('../../tests/rpa/recorder/rpaRecorder', () => ({
      RpaRecorder: class RpaRecorderMock {
        async init() {}
        async startRecording() {}
        async stopRecording() { return { seedPath: '/tmp/seed.json' }; }
        async close() {}
      },
    }));

    jest.doMock('../../tests/rpa/rpaConfig', () => ({
      urls: { frontend: 'http://localhost:3000' },
    }));

    const svc = require('../../api/services/rpaService');

    const hostileId = {};
    Object.defineProperty(hostileId, 'toString', {
      get() {
        throw new Error('getter hostil em recordingId');
      },
      enumerable: true,
    });

    const stopOut = await svc.stopManualRecording(hostileId);
    const statusOut = svc.getRecordingStatus(hostileId);

    expect(stopOut.success).toBe(false);
    expect(statusOut.success).toBe(false);
    expect(typeof stopOut.error).toBe('string');
    expect(typeof statusOut.error).toBe('string');
  });

  test('stopManualRecording: não quebra com erro hostil em stopRecording', async () => {
    jest.doMock('../../tests/rpa/recorder/rpaRecorder', () => ({
      RpaRecorder: class RpaRecorderMock {
        async init() {}
        async startRecording() {}
        async stopRecording() {
          const hostileErr = {};
          Object.defineProperty(hostileErr, 'message', {
            get() {
              throw new Error('getter hostil em stopRecording error.message');
            },
            enumerable: true,
          });
          hostileErr.toString = () => {
            throw new Error('hostile toString');
          };
          throw hostileErr;
        }
        async close() {}
      },
    }));

    jest.doMock('../../tests/rpa/rpaConfig', () => ({
      urls: { frontend: 'http://localhost:3000' },
    }));

    const svc = require('../../api/services/rpaService');

    const started = await svc.startManualRecording('seed-hostil', 'http://example.com');
    expect(started.success).toBe(true);

    const stopped = await svc.stopManualRecording('seed-hostil');

    expect(stopped.success).toBe(false);
    expect(typeof stopped.error).toBe('string');
  });

  test('static guard: service nao deve usar return err.message || String(err)', () => {
    const servicePath = path.join(__dirname, '../../api/services/rpaService.js');
    const source = fs.readFileSync(servicePath, 'utf8');

    expect(source).not.toMatch(/return\s+err\.message\s*\|\|\s*String\(err\)/);
    expect(source).not.toMatch(/try\s*\{\s*return\s+err\.message\s*\|\|\s*String\(err\)/);
  });
});
