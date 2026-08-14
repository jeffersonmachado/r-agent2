'use strict';

/**
 * Blob Store — object storage local (filesystem) para payloads binários pesados
 * (recordings, screenshots, áudio). Fase 4: o Postgres guarda apenas metadados
 * + `storage_key`; os bytes vivem aqui, fora do WAL/TOAST.
 *
 * Content-addressed por padrão: `put(buffer)` deriva a chave do SHA-256
 * (`<2 hex>/<sha256>`), garantindo dedup e imutabilidade natural.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function createBlobStore({ rootDir }) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('blob_store_root_dir_required');
  }
  const root = path.resolve(rootDir);

  function keyPath(key) {
    if (
      typeof key !== 'string'
      || !key
      || key.includes('..')
      || path.isAbsolute(key)
      || key.split('/').some((segment) => segment === '' || segment === '.')
    ) {
      throw new Error('blob_key_invalid');
    }
    return path.join(root, ...key.split('/'));
  }

  function contentKey(buffer) {
    const digest = sha256(buffer);
    return `${digest.slice(0, 2)}/${digest}`;
  }

  async function put(buffer, key = null) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const resolvedKey = key || contentKey(bytes);
    const file = keyPath(resolvedKey);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return { key: resolvedKey, sizeBytes: bytes.length, sha256: sha256(bytes) };
  }

  async function get(key) {
    const file = keyPath(key);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  async function has(key) {
    return fs.existsSync(keyPath(key));
  }

  async function remove(key) {
    const file = keyPath(key);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      return true;
    }
    return false;
  }

  return Object.freeze({
    rootDir: root,
    put,
    get,
    has,
    remove,
    contentKey,
    sha256,
  });
}

module.exports = {
  createBlobStore,
  sha256,
};
