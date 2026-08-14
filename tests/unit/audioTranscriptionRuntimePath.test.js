'use strict';

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');

/**
 * Regressão: saveTempAudio deve gravar sob o runtime root (fora do workspace),
 * não em <repo>/temp.
 *
 * Falha observada (2026-07-27): o serviço de transcrição gravava
 * temp/audio_*.ogg na árvore do repositório. O cleanup por setTimeout(1h)
 * não sobrevive a restarts do servidor, então os arquivos acumulavam e
 * apareciam como sujeira não rastreada no git — violação da política de
 * runtime paths (docs/runtime-paths.md: runtime fora do workspace).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('audioTranscriptionService.saveTempAudio — runtime path', () => {
  let runtimeRoot;
  let savedPath;

  beforeAll(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-runtime-'));
    configureRuntimeRoot(runtimeRoot);
    jest.resetModules();
  });

  afterAll(() => {
    configureRuntimeRoot(null);
    if (savedPath) {
      try { fs.unlinkSync(savedPath); } catch (_) { /* noop */ }
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('grava fora do workspace, sob RUNTIME_ROOT', async () => {
    const { saveTempAudio } = require('../../api/services/audioTranscriptionService');
    savedPath = await saveTempAudio(Buffer.from('fake-audio'), 'ogg');

    const workspaceRoot = path.resolve(process.cwd());
    expect(savedPath.startsWith(workspaceRoot + path.sep)).toBe(false);
    expect(savedPath.startsWith(path.resolve(runtimeRoot) + path.sep)).toBe(true);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(fs.readFileSync(savedPath).toString()).toBe('fake-audio');
  });
});
