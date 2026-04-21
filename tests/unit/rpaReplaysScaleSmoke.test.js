const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildReplayFilename,
  buildReplayPayload,
  createSyntheticReplays,
  cleanupSyntheticReplays,
  resolveLatestGeneratedReportPaths,
} = require('../../scripts/test-rpa-replays-scale-smoke');

describe('rpa replays scale smoke helpers', () => {
  test('gera nome de arquivo determinístico', () => {
    expect(buildReplayFilename('run-123', 0)).toBe('qa-scale-replay-run-123-0001.json');
    expect(buildReplayFilename('run-123', 41)).toBe('qa-scale-replay-run-123-0042.json');
  });

  test('gera payload sintético com campos usados pelo sumário', () => {
    const payload = buildReplayPayload('run-123', 6);

    expect(payload.id).toBe('run-123-replay-7');
    expect(payload.recordingId).toBe('qa-scale-recording-7');
    expect(payload.result).toBe('success');
    expect(Array.isArray(payload.actions)).toBe(true);
  });

  test('cria e remove somente os arquivos sintéticos do cenário', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-replays-scale-'));

    try {
      const created = createSyntheticReplays({
        count: 3,
        runId: 'run-123',
        replayDir: tempDir,
      });

      expect(created).toHaveLength(3);
      expect(fs.readdirSync(tempDir).sort()).toEqual([
        'qa-scale-replay-run-123-0001.json',
        'qa-scale-replay-run-123-0002.json',
        'qa-scale-replay-run-123-0003.json',
      ]);

      const removed = cleanupSyntheticReplays(created);
      expect(removed).toHaveLength(3);
      expect(fs.readdirSync(tempDir)).toHaveLength(0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('resolve o relatório json mais recente gerado pelo screen catalog', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-replays-scale-reports-'));

    try {
      fs.writeFileSync(path.join(tempDir, 'screen-catalog-2026-04-11T11-00-00-000Z.json'), '{}\n', 'utf8');
      fs.writeFileSync(path.join(tempDir, 'screen-catalog-2026-04-11T12-00-00-000Z.json'), '{}\n', 'utf8');

      const resolved = resolveLatestGeneratedReportPaths({ reportsDir: tempDir });

      expect(resolved.markdownPath.endsWith('screen-catalog-latest.md')).toBe(true);
      expect(resolved.jsonPath).toBe(path.join(tempDir, 'screen-catalog-2026-04-11T12-00-00-000Z.json'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});