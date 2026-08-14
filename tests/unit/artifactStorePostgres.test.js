'use strict';

const { createArtifactStore, sha256 } = require('../../lib/artifactStore');

describe('artifactStore — backend postgres', () => {
  let model;
  let store;

  beforeEach(() => {
    model = {
      upsert: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      destroy: jest.fn(),
    };
    store = createArtifactStore({ backend: 'postgres', model });
  });

  it('write de objeto faz upsert com content_jsonb e sha256', async () => {
    model.upsert.mockResolvedValue([{}, true]);

    const payload = { a: 1, steps: ['x'] };
    const meta = await store.write({ kind: 'rpa/replay', refId: 'r1', tenantKey: 'system', payload });

    expect(model.upsert).toHaveBeenCalledWith(expect.objectContaining({
      tenant_key: 'system',
      kind: 'rpa/replay',
      ref_id: 'r1',
      content_jsonb: payload,
      content_text: null,
    }));
    expect(meta.sha256).toBe(sha256(Buffer.from(JSON.stringify(payload), 'utf8')));
    expect(meta.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(payload)));
  });

  it('write de string faz upsert com content_text', async () => {
    model.upsert.mockResolvedValue([{}, true]);

    await store.write({ kind: 'reports', refId: 'gate', tenantKey: 'system', payload: '{"ok":true}' });

    expect(model.upsert).toHaveBeenCalledWith(expect.objectContaining({
      content_jsonb: null,
      content_text: '{"ok":true}',
    }));
  });

  it('readJson devolve content_jsonb', async () => {
    model.findOne.mockResolvedValue({
      tenant_key: 'system', kind: 'rpa/replay', ref_id: 'r1',
      content_jsonb: { a: 1 }, content_text: null,
      size_bytes: 7, sha256: 'x', created_at: '2026-08-13T00:00:00.000Z',
    });

    expect(await store.readJson({ kind: 'rpa/replay', refId: 'r1' })).toEqual({ a: 1 });
  });

  it('readJson parseia content_text quando content_jsonb é null', async () => {
    model.findOne.mockResolvedValue({
      tenant_key: 'system', kind: 'reports', ref_id: 'gate',
      content_jsonb: null, content_text: '{"ok":true}',
      size_bytes: 11, sha256: 'x', created_at: null,
    });

    expect(await store.readJson({ kind: 'reports', refId: 'gate' })).toEqual({ ok: true });
  });

  it('readText devolve content_text', async () => {
    model.findOne.mockResolvedValue({
      content_jsonb: null, content_text: 'hello', size_bytes: 5, sha256: 'x', created_at: null,
    });

    expect(await store.readText({ kind: 'reports', refId: 'g' })).toBe('hello');
  });

  it('readBuffer devolve Buffer a partir de content_text', async () => {
    model.findOne.mockResolvedValue({
      content_jsonb: null, content_text: 'abc', size_bytes: 3, sha256: 'x', created_at: null,
    });

    const buffer = await store.readBuffer({ kind: 'reports', refId: 'g' });
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.toString('utf8')).toBe('abc');
  });

  it('verify valida sha256 e devolve valid true', async () => {
    const payload = { a: 1 };
    const hash = sha256(Buffer.from(JSON.stringify(payload), 'utf8'));
    model.findOne.mockResolvedValue({
      content_jsonb: payload, content_text: null, sha256: hash,
    });

    expect(await store.verify({ kind: 'rpa/replay', refId: 'r1' })).toEqual({
      valid: true, sha256: hash, actualSha256: hash,
    });
  });

  it('verify devolve not_found quando não há linha', async () => {
    model.findOne.mockResolvedValue(null);

    expect(await store.verify({ kind: 'rpa/replay', refId: 'missing' }))
      .toEqual({ valid: false, reason: 'not_found' });
  });

  it('verify sobrevive à reordenação de chaves do JSONB (hash canônico)', async () => {
    model.upsert.mockResolvedValue([{}, true]);

    const payload = { z: 1, a: { y: 2, b: [3, { d: 4, c: 5 }] } };
    const meta = await store.write({ kind: 'rpa/replay', refId: 'r1', tenantKey: 'system', payload });

    // Simula o roundtrip do Postgres JSONB: mesma data, chaves em outra ordem.
    const reordered = { a: { b: [3, { c: 5, d: 4 }], y: 2 }, z: 1 };
    model.findOne.mockResolvedValue({
      content_jsonb: reordered, content_text: null, sha256: meta.sha256,
    });

    expect(await store.verify({ kind: 'rpa/replay', refId: 'r1' })).toEqual({
      valid: true, sha256: meta.sha256, actualSha256: meta.sha256,
    });
  });

  it('verify detecta alteração de conteúdo mesmo com hash canônico', async () => {
    model.upsert.mockResolvedValue([{}, true]);

    const meta = await store.write({ kind: 'rpa/replay', refId: 'r1', tenantKey: 'system', payload: { a: 1 } });
    model.findOne.mockResolvedValue({
      content_jsonb: { a: 2 }, content_text: null, sha256: meta.sha256,
    });

    const result = await store.verify({ kind: 'rpa/replay', refId: 'r1' });
    expect(result.valid).toBe(false);
    expect(result.actualSha256).not.toBe(meta.sha256);
  });

  it('list mapeia linhas e filtra por kind/tenantKey', async () => {
    model.findAll.mockResolvedValue([
      { kind: 'rpa/replay', ref_id: 'a', tenant_key: 'system', size_bytes: 10, sha256: 'h1', created_at: '2026-08-13T00:00:00.000Z' },
    ]);

    const items = await store.list({ kind: 'rpa/replay', tenantKey: 'system' });

    expect(model.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: { kind: 'rpa/replay', tenant_key: 'system' },
    }));
    expect(items).toHaveLength(1);
    expect(items[0].refId).toBe('a');
  });

  it('remove devolve true quando apaga ao menos uma linha', async () => {
    model.destroy.mockResolvedValue(1);

    expect(await store.remove({ kind: 'rpa/replay', refId: 'r1' })).toBe(true);
    expect(model.destroy).toHaveBeenCalledWith({
      where: { tenant_key: 'system', kind: 'rpa/replay', ref_id: 'r1' },
    });
  });

  it('rejeita refId inválido', async () => {
    await expect(store.write({ kind: 'rpa/replay', refId: '../evil', payload: {} }))
      .rejects.toThrow(/artifact_ref_id_invalid/);
  });

  it('expõe backend postgres', () => {
    expect(store.backend).toBe('postgres');
  });
});

describe('artifactStore — backend postgres (blobs)', () => {
  const originalRoot = process.env.ARTIFACT_BLOB_ROOT;
  let model;
  let blobStore;
  let store;

  beforeEach(() => {
    model = {
      upsert: jest.fn(),
      findOne: jest.fn(),
      findAll: jest.fn(),
      destroy: jest.fn(),
    };
    blobStore = {
      put: jest.fn(),
      get: jest.fn(),
    };
    store = createArtifactStore({ backend: 'postgres', model, blobStore });
  });

  afterEach(() => {
    if (originalRoot === undefined) delete process.env.ARTIFACT_BLOB_ROOT;
    else process.env.ARTIFACT_BLOB_ROOT = originalRoot;
  });

  it('writeBlob coloca no blobStore e faz upsert com storage_key', async () => {
    model.upsert.mockResolvedValue([{}, true]);
    blobStore.put.mockResolvedValue({ key: 'ab/hash', sha256: 'deadbeef' });

    const buffer = Buffer.from('binary');
    const meta = await store.writeBlob({ kind: 'pbx/recordings', refId: 'call-1', tenantKey: 'system', buffer });

    expect(blobStore.put).toHaveBeenCalledWith(buffer);
    expect(model.upsert).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'pbx/recordings',
      ref_id: 'call-1',
      storage_key: 'ab/hash',
      content_jsonb: null,
      content_text: null,
    }));
    expect(meta.storageKey).toBe('ab/hash');
    expect(meta.sha256).toBe('deadbeef');
  });

  it('write com Buffer roteia para writeBlob', async () => {
    model.upsert.mockResolvedValue([{}, true]);
    blobStore.put.mockResolvedValue({ key: 'ab/hash', sha256: 'h' });

    await store.write({ kind: 'rpa/replay', refId: 'r1', payload: Buffer.from('x') });

    expect(blobStore.put).toHaveBeenCalled();
    expect(model.upsert).toHaveBeenCalledWith(expect.objectContaining({ storage_key: 'ab/hash' }));
  });

  it('readBlob lê do blobStore via storage_key', async () => {
    model.findOne.mockResolvedValue({ storage_key: 'ab/hash', content_jsonb: null, content_text: null });
    blobStore.get.mockResolvedValue(Buffer.from('binary'));

    const buffer = await store.readBlob({ kind: 'pbx/recordings', refId: 'call-1' });

    expect(blobStore.get).toHaveBeenCalledWith('ab/hash');
    expect(buffer).toEqual(Buffer.from('binary'));
  });

  it('readBuffer usa blobStore quando há storage_key', async () => {
    model.findOne.mockResolvedValue({ storage_key: 'ab/hash' });
    blobStore.get.mockResolvedValue(Buffer.from('z'));

    expect(await store.readBuffer({ kind: 'x', refId: 'y' })).toEqual(Buffer.from('z'));
  });

  it('write com Buffer sem blobStore lança erro claro', async () => {
    delete process.env.ARTIFACT_BLOB_ROOT;
    const noBlob = createArtifactStore({ backend: 'postgres', model });

    await expect(noBlob.write({ kind: 'x', refId: 'y', payload: Buffer.from('x') }))
      .rejects.toThrow(/artifact_blob_root_required_for_buffer/);
  });
});
