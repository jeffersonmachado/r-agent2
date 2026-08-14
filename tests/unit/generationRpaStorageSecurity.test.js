'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');
const {
  saveRpaTestFile,
  saveTemporaryRecording,
  removeTemporaryRecording,
} = require('../../api/services/generationOrchestrator');
const { getRpaFlowWriteDir, getRpaSeedWriteDir } = require('../../lib/rpaPathResolver');

describe('generation RPA storage security', () => {
  let runtimeRoot;

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-rpa-'));
    configureRuntimeRoot(runtimeRoot);
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('gravações temporárias ficam no runtime isolado por tenant e têm segredos protegidos', () => {
    const recording = {
      id: 'same-recording',
      steps: [{ type: 'fill', selector: '#password', value: 'literal-secret' }],
    };

    const tenantAPath = saveTemporaryRecording(recording, 'tenant-a');
    const tenantBPath = saveTemporaryRecording(recording, 'tenant-b');

    expect(path.dirname(tenantAPath)).toBe(getRpaSeedWriteDir('tenant-a'));
    expect(path.dirname(tenantBPath)).toBe(getRpaSeedWriteDir('tenant-b'));
    expect(tenantAPath).not.toBe(tenantBPath);
    expect(fs.readFileSync(tenantAPath, 'utf8')).not.toContain('literal-secret');
    expect(JSON.parse(fs.readFileSync(tenantAPath, 'utf8'))).toMatchObject({ tenantId: 'tenant-a' });

    removeTemporaryRecording('same-recording', 'tenant-a');
    expect(fs.existsSync(tenantAPath)).toBe(false);
    expect(fs.existsSync(tenantBPath)).toBe(true);
  });

  test('IDs com traversal são rejeitados antes de qualquer escrita', () => {
    expect(() => saveTemporaryRecording({ id: '../escape', steps: [] }, 'tenant-a'))
      .toThrow('rpa_json_name_invalid');
    expect(() => saveRpaTestFile({ id: '../../escape', steps: [] }, 'tenant-a'))
      .toThrow('rpa_json_name_invalid');
  });

  test('artefato de flow também usa diretório de runtime tenant-scoped', () => {
    const filePath = saveRpaTestFile({ id: 'generated-test', steps: [] }, 'tenant-a');
    expect(path.dirname(filePath)).toBe(getRpaFlowWriteDir('tenant-a'));
    expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toMatchObject({ tenantId: 'tenant-a' });
  });
});
