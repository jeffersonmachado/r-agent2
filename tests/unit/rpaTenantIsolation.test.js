'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');
const { ActionRecorder } = require('../../core/rpa/actionRecorder');
const { getRpaSeedWriteDir } = require('../../lib/rpaPathResolver');
const { protectRecordingSecrets, stripInternalFilesystemPaths } = require('../../lib/rpaSecurity');

describe('RPA tenant isolation and secret persistence', () => {
  let runtimeRoot;

  beforeEach(() => {
    runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-tenant-'));
    configureRuntimeRoot(runtimeRoot);
  });

  afterEach(() => {
    configureRuntimeRoot(null);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  test('dois tenants podem usar o mesmo recordingId sem colisão ou leitura cruzada', () => {
    const recorderA = new ActionRecorder({ tenantId: 'tenant-a' });
    recorderA.start({ name: 'login', tenantId: 'tenant-a' });
    recorderA.recordClick('#tenant-a');
    const pathA = recorderA.save('login');

    const recorderB = new ActionRecorder({ tenantId: 'tenant-b' });
    recorderB.start({ name: 'login', tenantId: 'tenant-b' });
    recorderB.recordClick('#tenant-b');
    const pathB = recorderB.save('login');

    expect(pathA).not.toBe(pathB);
    expect(path.dirname(pathA)).toBe(getRpaSeedWriteDir('tenant-a'));
    expect(path.dirname(pathB)).toBe(getRpaSeedWriteDir('tenant-b'));
    expect(ActionRecorder.load('login', 'tenant-a').steps[0].selector).toBe('#tenant-a');
    expect(ActionRecorder.load('login', 'tenant-b').steps[0].selector).toBe('#tenant-b');
    expect(ActionRecorder.load('login', 'tenant-c')).toBeNull();
  });

  test('credencial gravada vira referência de secret, nunca texto literal', () => {
    const recorder = new ActionRecorder({ tenantId: 'tenant-a' });
    recorder.start({ name: 'login', tenantId: 'tenant-a' });
    recorder.recordFill('#password', 'SenhaSuperSecreta!');
    const filePath = recorder.save('login-secret');
    const persistedText = fs.readFileSync(filePath, 'utf8');
    const persisted = JSON.parse(persistedText);

    expect(persistedText).not.toContain('SenhaSuperSecreta!');
    expect(persisted.steps[0]).toMatchObject({
      sensitive: true,
      value: '{{secrets.password}}',
    });
  });

  test('planos gerados também substituem segredos e redigem tokens de URL', () => {
    const protectedPlan = protectRecordingSecrets({
      id: 'generated',
      steps: [
        { type: 'fill', selector: 'input[name=password]', value: 'literal-secret' },
        { type: 'navigate', url: 'https://example.test/path?token=abc123' },
      ],
    });

    expect(protectedPlan.steps[0].value).toMatch(/^\{\{secrets\./);
    expect(JSON.stringify(protectedPlan)).not.toContain('literal-secret');
    expect(protectedPlan.steps[1].url).not.toContain('abc123');
  });

  test('payload público remove campos e textos com caminhos internos', () => {
    const sanitized = stripInternalFilesystemPaths({
      tracePath: '/tmp/ragent2/trace.zip',
      logs: ['falha em /opt/results/ria/r-agent2/runtime/private.json; tente novamente'],
      endpoint: '/api/test-executions/123',
    });

    expect(sanitized).not.toHaveProperty('tracePath');
    expect(sanitized.logs[0]).toContain('[INTERNAL_PATH]');
    expect(sanitized.logs[0]).not.toContain('/opt/results');
    expect(sanitized.endpoint).toBe('/api/test-executions/123');
  });
});
