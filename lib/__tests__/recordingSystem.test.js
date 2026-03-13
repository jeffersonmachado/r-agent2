/**
 * Testes para o Sistema de Gravação
 */

const { RecordingSystem } = require('../recordingSystem');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('RecordingSystem', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('deve salvar em subpasta por tenant quando tenantId é fornecido no construtor', () => {
    const recording = new RecordingSystem({
      storagePath: tempDir,
      tenantId: 'tenant-1',
      context: 'test',
      enableTimestamps: false,
    });

    recording.start('rec-1', { name: 'Teste', tenantId: 'tenant-1' });
    recording.recordAction({ type: 'x', step: 's1' });
    recording.stop();

    const filePath = recording.save('rec-1');

    const expectedDir = path.join(tempDir, 'tenant-1');
    expect(path.dirname(filePath)).toBe(expectedDir);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('deve inferir tenantId do metadata do start() e salvar em subpasta', () => {
    const recording = new RecordingSystem({
      storagePath: tempDir,
      context: 'test',
      enableTimestamps: false,
    });

    recording.start('rec-2', { name: 'Teste', tenantId: 'tenant-2' });
    recording.recordAction({ type: 'x', step: 's1' });
    recording.stop();

    const filePath = recording.save('rec-2');

    const expectedDir = path.join(tempDir, 'tenant-2');
    expect(path.dirname(filePath)).toBe(expectedDir);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('deve sanitizar filename e evitar path traversal', () => {
    const recording = new RecordingSystem({
      storagePath: tempDir,
      tenantId: 'tenant-3',
      context: 'test',
      enableTimestamps: false,
    });

    recording.start('rec-3', { name: 'Teste', tenantId: 'tenant-3' });
    recording.recordAction({ type: 'x', step: 's1' });
    recording.stop();

    const filePath = recording.save('../evil/../../pwned');

    const expectedDir = path.join(tempDir, 'tenant-3');
    expect(path.dirname(filePath)).toBe(expectedDir);
    // Garante que o arquivo final está dentro do diretório esperado (sem traversal)
    const resolvedDir = path.resolve(expectedDir) + path.sep;
    expect(path.resolve(filePath).startsWith(resolvedDir)).toBe(true);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

