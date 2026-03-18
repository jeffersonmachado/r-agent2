'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('pbxMediaService coercion hardening', () => {
  let mediaDir;
  const originalMediaDir = process.env.PBX_MEDIA_DIR;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-media-test-'));
    process.env.PBX_MEDIA_DIR = mediaDir;
  });

  afterEach(() => {
    try {
      fs.rmSync(mediaDir, { recursive: true, force: true });
    } catch (_) {
      // best-effort cleanup
    }
  });

  afterAll(() => {
    if (originalMediaDir === undefined) delete process.env.PBX_MEDIA_DIR;
    else process.env.PBX_MEDIA_DIR = originalMediaDir;
  });

  test('createAudioAssetFromUpload tolerates hostile ffmpeg error.message getter', async () => {
    const hostileError = {
      code: 'ffmpeg_spawn_error',
      get message() {
        throw new Error('poisoned message getter');
      },
      toString() {
        throw new Error('poisoned toString');
      },
    };

    jest.doMock('child_process', () => ({
      spawn: jest.fn(() => {
        const stderr = { on: jest.fn() };
        return {
          stderr,
          on: jest.fn((event, handler) => {
            if (event === 'error') {
              process.nextTick(() => handler(hostileError));
            }
            return this;
          }),
        };
      }),
    }));

    const create = jest.fn(async (values) => ({ toJSON: () => values }));

    jest.doMock('../../api/db/models', () => ({
      PbxAudioAsset: jest.fn(() => ({ create })),
    }));

    const { createAudioAssetFromUpload } = require('../../api/services/pbx/pbxMediaService');

    const out = await createAudioAssetFromUpload({
      tenantKey: 'tenant-1',
      kind: 'queue',
      filename: 'audio.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('audio-bytes'),
    });

    expect(out.storage.convertError).toEqual({
      code: 'ffmpeg_spawn_error',
      message: 'convert failed',
    });
  });

  test('static guard: no direct err/error.message outside helper', () => {
    const sourcePath = path.resolve(__dirname, '../../api/services/pbx/pbxMediaService.js');
    const source = fs.readFileSync(sourcePath, 'utf8');

    expect(source).not.toMatch(/\b(?:error|err)\.message\b/);
  });
});