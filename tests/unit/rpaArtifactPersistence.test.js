'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

jest.mock('../../api/services/ragDocumentsService', () => ({
  createDocument: jest.fn().mockResolvedValue({ success: true, document: { id: 'doc-1' } }),
}));

const { configureRuntimeRoot } = require('../../api/utils/runtimePaths');
const { tenantPathKey } = require('../../lib/artifactStore');
const {
  persistExecutionArtifacts,
  getExecutionManifest,
  listExecutionManifests,
  getRecording,
  getReplay,
  getTraceBuffer,
  indexExecutionInRag,
  resetStoreForTests,
  sanitizeRefId,
} = require('../../api/services/rpaArtifactPersistence');

describe('rpaArtifactPersistence', () => {
  let tmpRoot;
  let previousNodeEnv;

  beforeEach(() => {
    previousNodeEnv = process.env.NODE_ENV;
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-artifacts-'));
    configureRuntimeRoot(tmpRoot);
    process.env.ARTIFACT_STORE_BACKEND = 'filesystem';
    resetStoreForTests();
  });

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.ARTIFACT_STORE_BACKEND;
    configureRuntimeRoot(null);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('sanitizeRefId limita e normaliza caracteres inválidos', () => {
    expect(sanitizeRefId('foo/bar baz')).toBe('foo-bar-baz');
    expect(sanitizeRefId('a'.repeat(300)).length).toBeLessThanOrEqual(255);
    expect(sanitizeRefId('')).toBe('unknown');
  });

  it('persistExecutionArtifacts grava roteiro, replay, trace e manifesto (filesystem)', async () => {
    const recording = { id: 'rec-1', name: 'Rec 1', steps: [{ type: 'navigate', url: '/login' }] };
    const results = { success: true, steps: [], errors: [], screenshots: [] };
    const traceFile = path.join(tmpRoot, 'trace.zip');
    fs.writeFileSync(traceFile, Buffer.from('PK\u0003\u0004trace-content'));

    const outcome = await persistExecutionArtifacts({
      recording,
      recordingId: 'rec-1',
      executionId: 'rpa-exec-0001',
      results,
      tracePath: traceFile,
      tenantKey: 'system',
      status: 'completed',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    expect(outcome.error).toBeNull();
    expect(outcome.backend).toBe('filesystem');
    expect(outcome.recording).toBe(true);
    expect(outcome.replay).toBe(true);
    expect(outcome.trace).toBe(true);
    expect(outcome.executionManifest).toBe(true);
  });

  it('recupera roteiro, replay, trace e manifesto após persistir', async () => {
    const recording = { id: 'rec-2', name: 'Rec 2', steps: [{ type: 'click', selector: '#go' }] };
    const results = { success: false, errors: [{ error: 'x' }], screenshots: [] };
    const traceFile = path.join(tmpRoot, 'trace2.zip');
    fs.writeFileSync(traceFile, Buffer.from('PK\u0003\u0004zip-bytes'));

    await persistExecutionArtifacts({
      recording,
      recordingId: 'rec-2',
      executionId: 'rpa-exec-0002',
      results,
      tracePath: traceFile,
      tenantKey: 'system',
      status: 'failed',
    });

    const rec = await getRecording('rec-2');
    expect(rec).toBeTruthy();
    expect(rec.id).toBe('rec-2');
    expect(rec.steps).toHaveLength(1);

    const replay = await getReplay('rpa-exec-0002');
    expect(replay.success).toBe(false);

    const trace = await getTraceBuffer('rpa-exec-0002');
    expect(trace).toBeTruthy();
    expect(trace.length).toBeGreaterThan(0);

    const manifest = await getExecutionManifest('rpa-exec-0002');
    expect(manifest.recordingId).toBe('rec-2');
    expect(manifest.status).toBe('failed');
    expect(manifest.trace).toBe(true);
    expect(await getReplay('rpa-exec-0002', 'outro-tenant')).toBeNull();
  });

  it('rejeita replay adulterado mesmo quando o hash do store foi recalculado', async () => {
    await persistExecutionArtifacts({
      recording: { id: 'rec-tamper', steps: [] },
      recordingId: 'rec-tamper',
      executionId: 'rpa-exec-tamper',
      results: { success: true, errors: [], screenshots: [] },
      tenantKey: 'tenant-a',
      status: 'completed',
    });

    const artifactDir = path.join(
      tmpRoot,
      'artifacts',
      'fs',
      'tenants',
      tenantPathKey('tenant-a'),
      'rpa',
      'replay',
    );
    const payloadPath = path.join(artifactDir, 'rpa-exec-tamper.json');
    const metadataPath = path.join(artifactDir, 'rpa-exec-tamper.meta.json');
    const tampered = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    tampered.success = false;
    const bytes = Buffer.from(JSON.stringify(tampered), 'utf8');
    fs.writeFileSync(payloadPath, bytes);
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    metadata.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata), 'utf8');

    expect(await getReplay('rpa-exec-tamper', 'tenant-a')).toBeNull();
  });

  it('listExecutionManifests retorna os manifestos persistidos', async () => {
    await persistExecutionArtifacts({
      recording: { id: 'rec-3', name: 'Rec 3', steps: [] },
      recordingId: 'rec-3',
      executionId: 'rpa-exec-0003',
      results: { success: true, steps: [], errors: [], screenshots: [] },
      tracePath: null,
      tenantKey: 'system',
      status: 'completed',
    });

    const list = await listExecutionManifests(null);
    expect(list).toHaveLength(1);
    expect(list[0].refId).toBe('rpa-exec-0003');
  });

  it('não lança quando o trace não existe (persistência best-effort)', async () => {
    const outcome = await persistExecutionArtifacts({
      recording: null,
      recordingId: 'rec-4',
      executionId: 'rpa-exec-0004',
      results: null,
      tracePath: '/tmp/nao-existe-trace.zip',
      tenantKey: 'system',
    });

    expect(outcome.error).toBeNull();
    expect(outcome.trace).toBe(false);
    expect(outcome.recording).toBe(false);
  });

  it('produção recusa explicitamente backend filesystem', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ARTIFACT_STORE_BACKEND = 'filesystem';
    resetStoreForTests();

    await expect(persistExecutionArtifacts({
      recordingId: 'rec-prod',
      executionId: 'rpa-exec-prod',
      results: { success: true },
      tenantKey: 'tenant-a',
    })).rejects.toMatchObject({ code: 'PERSISTENCE_REQUIRED' });
  });

  it('indexExecutionInRag cria documento no RAG com resumo do roteiro', async () => {
    const ragDocumentsService = require('../../api/services/ragDocumentsService');
    ragDocumentsService.createDocument.mockResolvedValue({ success: true, document: { id: 'doc-rag' } });

    const indexed = await indexExecutionInRag({
      recording: { id: 'rec-5', name: 'Rec 5', steps: [{ type: 'navigate', url: '/login' }] },
      recordingId: 'rec-5',
      executionId: 'rpa-exec-0005',
      results: { success: true, errors: [] },
      tenantKey: 'system',
    });

    expect(indexed).toBe(true);
    expect(ragDocumentsService.createDocument).toHaveBeenCalledTimes(1);
    const call = ragDocumentsService.createDocument.mock.calls[0][0];
    expect(call.title).toContain('Rec 5');
    expect(call.content).toContain('navigate');
    expect(call.metadata.source).toBe('rpa-artifact');
    expect(call).toMatchObject({
      domain: 'SYSTEM',
      classification: 'SUPPORT',
      sensitivity: 'CONFIDENTIAL',
      permissions: { roles: ['super_admin', 'auditor'], agents: [] },
    });
    expect(ragDocumentsService.createDocument.mock.calls[0][1]).toBe('system');
  });
});
