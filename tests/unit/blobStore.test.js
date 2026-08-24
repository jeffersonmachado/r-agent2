'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createBlobStore } = require('../../lib/blobStore');

describe('lib/blobStore', () => {
  let root;
  let store;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'blob-store-'));
    store = createBlobStore({ rootDir: root });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('put deriva chave content-addressed e get devolve os mesmos bytes', async () => {
    const buffer = Buffer.from('hello-blob');
    const result = await store.put(buffer);

    expect(result.key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{64}$/);
    expect(result.sha256).toBe(store.sha256(buffer));
    expect(await store.get(result.key)).toEqual(buffer);
  });

  it('put com key explícita respeita a chave fornecida', async () => {
    const result = await store.put(Buffer.from('x'), 'recordings/call-1.wav');
    expect(result.key).toBe('recordings/call-1.wav');
    expect(await store.get('recordings/call-1.wav')).toEqual(Buffer.from('x'));
  });

  it('get retorna null para chave inexistente', async () => {
    expect(await store.get('ab/missing')).toBeNull();
  });

  it('has e remove funcionam', async () => {
    await store.put(Buffer.from('z'), 'a/b');
    expect(await store.has('a/b')).toBe(true);
    expect(await store.remove('a/b')).toBe(true);
    expect(await store.has('a/b')).toBe(false);
  });

  it('listKeys lista todas as chaves relativas ao rootDir', async () => {
    await store.put(Buffer.from('x'), '00/abc');
    await store.put(Buffer.from('y'), 'ff/def');
    await store.put(Buffer.from('z'), 'nested/key');

    const keys = store.listKeys().sort();
    expect(keys).toEqual(['00/abc', 'ff/def', 'nested/key'].sort());
  });

  it('rejeita key com path traversal', async () => {
    await expect(store.put(Buffer.from('x'), '../evil')).rejects.toThrow(/blob_key_invalid/);
  });

  it('exige rootDir', () => {
    expect(() => createBlobStore({})).toThrow(/blob_store_root_dir_required/);
  });
});
