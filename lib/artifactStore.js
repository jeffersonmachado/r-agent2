'use strict';

/**
 * Artifact Store — abstração de persistência de artefatos de runtime/evidência.
 *
 * Fase 1: backend `filesystem` (default) com hash de integridade (SHA-256)
 * gravado em sidecar `.meta.json`.
 * Fase 2: backend `postgres` (via `ARTIFACT_STORE_BACKEND=postgres` ou
 * `createArtifactStore({ backend: 'postgres' })`) persiste em `runtime_artifacts`
 * (JSONB para objetos, TEXT para strings) com o mesmo hash SHA-256.
 *
 * Interface (assíncrona):
 *   write({ kind, refId, tenantKey, payload })
 *   writeBlob({ kind, refId, tenantKey, buffer })  // backend postgres
 *   readBuffer({ kind, refId, tenantKey })
 *   readBlob({ kind, refId, tenantKey })           // backend postgres
 *   readText({ kind, refId, tenantKey })
 *   readJson({ kind, refId, tenantKey })
 *   meta({ kind, refId, tenantKey })
 *   list({ kind, tenantKey })
 *   listWithContent({ kind, tenantKey })
 *   remove({ kind, refId, tenantKey })
 *   verify({ kind, refId, tenantKey })
 *
 * `tenantKey` é opcional apenas por compatibilidade (default `system`). Ambos
 * os backends incluem tenant no endereço/WHERE; nunca há colisão cross-tenant.
 *
 * Regras de segurança:
 * - `refId` e `kind` são validados contra path traversal (`..`, absoluto,
 *   caracteres fora do padrão permitido).
 * - `rootDir` é obrigatório no backend filesystem (sem default mágico).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const KIND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,255}$/;

function normalizeTenantKey(tenantKey) {
  const value = String(tenantKey || 'system').trim();
  if (!value || value.length > 255 || value.includes('\0')) {
    throw new Error('artifact_tenant_key_invalid');
  }
  return value;
}

function tenantPathKey(tenantKey) {
  return crypto.createHash('sha256').update(normalizeTenantKey(tenantKey), 'utf8').digest('hex');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Serialização canônica (chaves ordenadas recursivamente) para objetos JSON.
 *
 * O backend Postgres persiste objetos em JSONB, que NÃO preserva a ordem das
 * chaves nem a formatação. Para o hash de integridade sobreviver ao roundtrip
 * JSONB, write e verify/derive devem hashear a mesma forma canônica.
 * Semelhante ao JSON.stringify, valores `undefined` em objetos são omitidos
 * e em arrays viram `null`.
 */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : canonicalStringify(item))).join(',')}]`;
  }
  const entries = Object.keys(value)
    .filter((key) => value[key] !== undefined && typeof value[key] !== 'function')
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function assertSafeRefId(refId) {
  if (typeof refId !== 'string' || !REF_ID_PATTERN.test(refId) || refId.includes('..')) {
    throw new Error('artifact_ref_id_invalid');
  }
  return refId;
}

function assertSafeKind(kind) {
  if (
    typeof kind !== 'string'
    || !KIND_PATTERN.test(kind)
    || kind.includes('..')
    || kind.startsWith('/')
  ) {
    throw new Error('artifact_kind_invalid');
  }
  return kind;
}

function createFilesystemBackend({ rootDir }) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('artifact_store_root_dir_required');
  }
  const root = path.resolve(rootDir);

  function kindDir(kind, tenantKey = 'system') {
    return path.join(root, 'tenants', tenantPathKey(tenantKey), assertSafeKind(kind));
  }

  function artifactFile(kind, refId, tenantKey = 'system') {
    return path.join(kindDir(kind, tenantKey), `${assertSafeRefId(refId)}.json`);
  }

  function metaFile(kind, refId, tenantKey = 'system') {
    return path.join(kindDir(kind, tenantKey), `${assertSafeRefId(refId)}.meta.json`);
  }

  function readMeta(kind, refId, tenantKey = 'system') {
    const file = metaFile(kind, refId, tenantKey);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      return null;
    }
  }

  async function write({ kind, refId, tenantKey = 'system', payload }) {
    assertSafeRefId(refId);
    assertSafeKind(kind);

    const bytes = Buffer.isBuffer(payload)
      ? payload
      : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8');

    const tkey = normalizeTenantKey(tenantKey);
    fs.mkdirSync(kindDir(kind, tkey), { recursive: true });

    const meta = {
      kind,
      refId,
      tenantKey: tkey,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
      createdAt: new Date().toISOString(),
    };

    const payloadPath = artifactFile(kind, refId, tkey);
    const metadataPath = metaFile(kind, refId, tkey);
    const suffix = `${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(`${payloadPath}.${suffix}`, bytes);
    fs.renameSync(`${payloadPath}.${suffix}`, payloadPath);
    fs.writeFileSync(`${metadataPath}.${suffix}`, JSON.stringify(meta, null, 2), 'utf8');
    fs.renameSync(`${metadataPath}.${suffix}`, metadataPath);
    return meta;
  }

  async function readBuffer({ kind, refId, tenantKey = 'system' }) {
    const file = artifactFile(kind, refId, tenantKey);
    if (!fs.existsSync(file)) return null;
    return fs.readFileSync(file);
  }

  async function readText({ kind, refId, tenantKey = 'system' }) {
    const buffer = await readBuffer({ kind, refId, tenantKey });
    return buffer === null ? null : buffer.toString('utf8');
  }

  async function readJson({ kind, refId, tenantKey = 'system' }) {
    const text = await readText({ kind, refId, tenantKey });
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error('artifact_json_parse_failed');
    }
  }

  async function meta({ kind, refId, tenantKey = 'system' }) {
    return readMeta(kind, refId, tenantKey);
  }

  async function list({ kind, tenantKey = null }) {
    assertSafeKind(kind);
    const tenantRoots = tenantKey
      ? [kindDir(kind, tenantKey)]
      : (() => {
        const tenantsRoot = path.join(root, 'tenants');
        if (!fs.existsSync(tenantsRoot)) return [];
        return fs.readdirSync(tenantsRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => path.join(tenantsRoot, entry.name, kind));
      })();
    return tenantRoots.flatMap((dir) => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.meta.json'))
        .map((name) => {
          try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (_) { return null; }
        });
    })
      .filter((entry) => entry && (!tenantKey || entry.tenantKey === normalizeTenantKey(tenantKey)))
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  /**
   * Lista em lote COM o payload, para evitar N+1 leituras por item.
   * `actualSha256` é o hash dos bytes reais do payload, ou seja, exatamente o
   * que `verify()` calcularia — sem uma segunda ida ao store.
   */
  async function listWithContent({ kind, tenantKey = null }) {
    const entries = await list({ kind, tenantKey });
    return entries.map((entry) => {
      let payload = null;
      try {
        const file = artifactFile(kind, entry.refId, entry.tenantKey);
        payload = fs.existsSync(file) ? fs.readFileSync(file) : null;
      } catch (_) {
        payload = null;
      }
      if (payload === null) return { ...entry, storageKey: null, payload: null };
      return { ...entry, storageKey: null, payload, actualSha256: sha256(payload) };
    });
  }

  async function remove({ kind, refId, tenantKey = 'system' }) {
    assertSafeRefId(refId);
    let removed = false;
    for (const file of [artifactFile(kind, refId, tenantKey), metaFile(kind, refId, tenantKey)]) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        removed = true;
      }
    }
    return removed;
  }

  async function verify({ kind, refId, tenantKey = 'system' }) {
    const entry = readMeta(kind, refId, tenantKey);
    if (!entry) return { valid: false, reason: 'not_found' };
    const buffer = await readBuffer({ kind, refId, tenantKey });
    if (buffer === null) return { valid: false, reason: 'payload_missing' };
    const actualSha256 = sha256(buffer);
    return {
      valid: actualSha256 === entry.sha256,
      sha256: entry.sha256,
      actualSha256,
    };
  }

  return Object.freeze({
    backend: 'filesystem',
    write,
    readBuffer,
    readText,
    readJson,
    meta,
    list,
    listWithContent,
    remove,
    verify,
  });
}

function serializePayload(payload) {
  if (Buffer.isBuffer(payload)) {
    return { jsonb: null, text: payload.toString('utf8'), bytes: payload };
  }
  if (payload !== null && typeof payload === 'object') {
    const bytes = Buffer.from(canonicalStringify(payload), 'utf8');
    return { jsonb: payload, text: null, bytes };
  }
  const text = String(payload);
  return { jsonb: null, text, bytes: Buffer.from(text, 'utf8') };
}

function deserializeRow(row) {
  if (row && row.content_jsonb != null) {
    return Buffer.from(canonicalStringify(row.content_jsonb), 'utf8');
  }
  return Buffer.from((row && row.content_text) || '', 'utf8');
}

function createPostgresBackend(options = {}) {
  function model() {
    if (options.model) return options.model;
    // Lazy require: evita carregar Sequelize em uso exclusivo de filesystem.
    return require('../api/db/models/RuntimeArtifact')();
  }

  async function findRow(kind, refId, tenantKey) {
    assertSafeRefId(refId);
    assertSafeKind(kind);
    return model().findOne({
      where: { tenant_key: String(tenantKey || 'system'), kind, ref_id: refId },
    });
  }

  function resolveBlobStore() {
    if (options.blobStore) return options.blobStore;
    const { createBlobStore } = require('./blobStore');
    const root = process.env.ARTIFACT_BLOB_ROOT;
    if (!root) {
      throw new Error('artifact_blob_root_required_for_buffer');
    }
    return createBlobStore({ rootDir: root });
  }

  async function write({ kind, refId, tenantKey = 'system', payload }) {
    assertSafeRefId(refId);
    assertSafeKind(kind);
    const tkey = String(tenantKey || 'system');

    if (Buffer.isBuffer(payload)) {
      return writeBlob({ kind, refId, tenantKey: tkey, buffer: payload });
    }

    const { jsonb, text, bytes } = serializePayload(payload);
    const hash = sha256(bytes);

    await model().upsert({
      tenant_key: tkey,
      kind,
      ref_id: refId,
      content_jsonb: jsonb,
      content_text: text,
      storage_key: null,
      size_bytes: bytes.length,
      sha256: hash,
    });

    return {
      kind,
      refId,
      tenantKey: tkey,
      sizeBytes: bytes.length,
      sha256: hash,
      createdAt: new Date().toISOString(),
    };
  }

  async function writeBlob({ kind, refId, tenantKey = 'system', buffer }) {
    assertSafeRefId(refId);
    assertSafeKind(kind);
    const tkey = String(tenantKey || 'system');
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const blob = await resolveBlobStore().put(bytes);
    const hash = blob.sha256 || sha256(bytes);

    await model().upsert({
      tenant_key: tkey,
      kind,
      ref_id: refId,
      content_jsonb: null,
      content_text: null,
      storage_key: blob.key,
      size_bytes: bytes.length,
      sha256: hash,
    });

    return {
      kind,
      refId,
      tenantKey: tkey,
      sizeBytes: bytes.length,
      sha256: hash,
      storageKey: blob.key,
      createdAt: new Date().toISOString(),
    };
  }

  async function readBlob({ kind, refId, tenantKey = 'system' }) {
    const row = await findRow(kind, refId, tenantKey);
    if (!row || !row.storage_key) return null;
    return resolveBlobStore().get(row.storage_key);
  }

  async function readBuffer({ kind, refId, tenantKey = 'system' }) {
    const row = await findRow(kind, refId, tenantKey);
    if (!row) return null;
    if (row.storage_key) return resolveBlobStore().get(row.storage_key);
    return deserializeRow(row);
  }

  async function readText({ kind, refId, tenantKey = 'system' }) {
    const row = await findRow(kind, refId, tenantKey);
    if (!row) return null;
    if (row.content_jsonb != null) return JSON.stringify(row.content_jsonb);
    return row.content_text || '';
  }

  async function readJson({ kind, refId, tenantKey = 'system' }) {
    const row = await findRow(kind, refId, tenantKey);
    if (!row) return null;
    if (row.content_jsonb != null) return row.content_jsonb;
    try {
      return JSON.parse(row.content_text || 'null');
    } catch (_) {
      throw new Error('artifact_json_parse_failed');
    }
  }

  async function meta({ kind, refId, tenantKey = 'system' }) {
    const row = await findRow(kind, refId, tenantKey);
    if (!row) return null;
    return {
      kind: row.kind,
      refId: row.ref_id,
      tenantKey: row.tenant_key,
      sizeBytes: Number(row.size_bytes) || 0,
      sha256: row.sha256,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    };
  }

  async function list({ kind, tenantKey = null }) {
    assertSafeKind(kind);
    const where = { kind };
    if (tenantKey) where.tenant_key = tenantKey;
    const rows = await model().findAll({ where, order: [['created_at', 'ASC']] });
    return rows.map((row) => ({
      kind: row.kind,
      refId: row.ref_id,
      tenantKey: row.tenant_key,
      sizeBytes: Number(row.size_bytes) || 0,
      sha256: row.sha256,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    }));
  }

  /**
   * Lista em lote COM o payload em UMA query, para evitar N+1 leituras por
   * item. `actualSha256` é o hash dos bytes reais do payload, ou seja,
   * exatamente o que `verify()` calcularia — sem uma segunda ida ao banco.
   * Linhas com `storage_key` (blob) retornam `payload: null`: quem chama deve
   * tratá-las como não recuperáveis por este caminho.
   */
  async function listWithContent({ kind, tenantKey = null }) {
    assertSafeKind(kind);
    const where = { kind };
    if (tenantKey) where.tenant_key = String(tenantKey);
    const rows = await model().findAll({ where, order: [['created_at', 'ASC']] });
    return rows.map((row) => {
      const storageKey = row.storage_key || null;
      const entry = {
        kind: row.kind,
        refId: row.ref_id,
        tenantKey: row.tenant_key,
        sizeBytes: Number(row.size_bytes) || 0,
        sha256: row.sha256,
        storageKey,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        payload: null,
      };
      if (storageKey) return entry;
      const bytes = deserializeRow(row);
      return { ...entry, payload: bytes, actualSha256: sha256(bytes) };
    });
  }

  async function remove({ kind, refId, tenantKey = 'system' }) {
    assertSafeRefId(refId);
    assertSafeKind(kind);
    const count = await model().destroy({
      where: { tenant_key: String(tenantKey || 'system'), kind, ref_id: refId },
    });
    return count > 0;
  }

  async function verify({ kind, refId, tenantKey = 'system' }) {
    const row = await findRow(kind, refId, tenantKey);
    if (!row) return { valid: false, reason: 'not_found' };
    const bytes = row.storage_key
      ? await resolveBlobStore().get(row.storage_key)
      : deserializeRow(row);
    if (bytes === null) return { valid: false, reason: 'payload_missing' };
    const actualSha256 = sha256(bytes);
    return {
      valid: actualSha256 === row.sha256,
      sha256: row.sha256,
      actualSha256,
    };
  }

  return Object.freeze({
    backend: 'postgres',
    write,
    writeBlob,
    readBuffer,
    readBlob,
    readText,
    readJson,
    meta,
    list,
    listWithContent,
    remove,
    verify,
  });
}

const BACKENDS = Object.freeze({
  filesystem: createFilesystemBackend,
  postgres: createPostgresBackend,
});

function createArtifactStore(options = {}) {
  const backendName = options.backend || process.env.ARTIFACT_STORE_BACKEND || 'filesystem';
  const factory = BACKENDS[backendName];
  if (!factory) {
    throw new Error(`artifact_store_backend_unknown: ${backendName}`);
  }
  return factory(options);
}

module.exports = {
  createArtifactStore,
  createFilesystemBackend,
  createPostgresBackend,
  sha256,
  assertSafeRefId,
  assertSafeKind,
  normalizeTenantKey,
  tenantPathKey,
};
