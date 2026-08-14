'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createArtifactStore, tenantPathKey } = require('../../lib/artifactStore');

describe('artifactStore — backend filesystem', () => {
  let root;
  let store;

  const artifactPath = (kind, refId, suffix = '.json', tenantKey = 'system') => path.join(
    root,
    'tenants',
    tenantPathKey(tenantKey),
    ...kind.split('/'),
    `${refId}${suffix}`,
  );

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-store-'));
    store = createArtifactStore({ backend: 'filesystem', rootDir: root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('write + readJson faz roundtrip preservando o payload', async () => {
    const payload = { replayId: 'r1', steps: [{ type: 'navigate', url: '/login' }] };
    const meta = await store.write({ kind: 'rpa/replay', refId: 'r1', tenantKey: 'system', payload });

    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.sizeBytes).toBeGreaterThan(0);

    const read = await store.readJson({ kind: 'rpa/replay', refId: 'r1' });
    expect(read).toEqual(payload);
  });

  it('write aceita string e readText devolve o mesmo texto', async () => {
    await store.write({ kind: 'reports', refId: 'gate', tenantKey: 'system', payload: '{"ok":true}' });

    expect(await store.readText({ kind: 'reports', refId: 'gate' })).toBe('{"ok":true}');
  });

  it('verify detecta adulteração do arquivo', async () => {
    await store.write({ kind: 'rpa/replay', refId: 'r1', payload: { a: 1 } });

    const file = artifactPath('rpa/replay', 'r1');
    fs.writeFileSync(file, Buffer.from('{"a":2}', 'utf8'));

    const result = await store.verify({ kind: 'rpa/replay', refId: 'r1' });
    expect(result.valid).toBe(false);
    expect(result.actualSha256).not.toBe(result.sha256);
  });

  it('list filtra por kind e tenantKey', async () => {
    await store.write({ kind: 'rpa/replay', refId: 'a', tenantKey: 'system', payload: {} });
    await store.write({ kind: 'rpa/replay', refId: 'b', tenantKey: 'other', payload: {} });
    await store.write({ kind: 'templates', refId: 't1', tenantKey: 'system', payload: {} });

    const replays = await store.list({ kind: 'rpa/replay' });
    expect(replays.map((m) => m.refId).sort()).toEqual(['a', 'b']);

    const systemReplays = await store.list({ kind: 'rpa/replay', tenantKey: 'system' });
    expect(systemReplays.map((m) => m.refId)).toEqual(['a']);
  });

  it('remove apaga payload e meta', async () => {
    await store.write({ kind: 'rpa/replay', refId: 'x', payload: {} });
    expect(fs.existsSync(artifactPath('rpa/replay', 'x'))).toBe(true);

    const removed = await store.remove({ kind: 'rpa/replay', refId: 'x' });
    expect(removed).toBe(true);
    expect(fs.existsSync(artifactPath('rpa/replay', 'x'))).toBe(false);
    expect(fs.existsSync(artifactPath('rpa/replay', 'x', '.meta.json'))).toBe(false);
  });

  it('readJson retorna null para artefato inexistente', async () => {
    expect(await store.readJson({ kind: 'rpa/replay', refId: 'missing' })).toBeNull();
  });

  it('rejeita refId com path traversal', async () => {
    await expect(store.write({ kind: 'rpa/replay', refId: '../evil', payload: {} }))
      .rejects.toThrow(/artifact_ref_id_invalid/);
  });

  it('rejeita kind com path traversal', async () => {
    await expect(store.write({ kind: '../evil', refId: 'a', payload: {} }))
      .rejects.toThrow(/artifact_kind_invalid/);
  });

  it('rejeita backend desconhecido', () => {
    expect(() => createArtifactStore({ backend: 'redis', rootDir: root }))
      .toThrow(/artifact_store_backend_unknown/);
  });

  it('exige rootDir no backend filesystem', () => {
    expect(() => createArtifactStore({ backend: 'filesystem' }))
      .toThrow(/artifact_store_root_dir_required/);
  });
});
