'use strict';

/**
 * dbStateStore.js — store de estado canônico em banco com export JSON derivado.
 *
 * RAP-078: o BANCO é a fonte canônica de estado mutável; o JSON é apenas um
 * export derivado (cache para CI/offline, nunca a fonte de verdade).
 *
 * Semântica:
 *   save(stateKey, data): grava no DB (artifactStore backend postgres, kind
 *     'qa/state', refId = stateKey) e escreve o JSON export derivado (best-effort,
 *     nunca é a fonte canônica).
 *   load(stateKey, fallback): lê do JSON export (leitura síncrona, CI-friendly).
 *     A verdade canônica está no DB; o export é regenerado em cada save.
 *
 * Invariante: falha de DB em save gera erro explícito (persistence_required),
 * nunca fallback silencioso para filesystem como fonte de verdade.
 */

const fs = require('fs');
const path = require('path');
const { createArtifactStore } = require('../../lib/artifactStore');
const { getSequelize, connect } = require('../../api/db/sequelize');

const ROOT = process.cwd();
const KIND = 'qa/state';

let cachedStore = null;

function sanitizeRefId(value) {
  return String(value || 'unknown')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^-+/, '')
    .slice(0, 255) || 'unknown';
}

function resolveExportPath(stateKey) {
  return path.isAbsolute(stateKey) ? stateKey : path.join(ROOT, stateKey.replace(/^\.\//, ''));
}

function writeExport(stateKey, data) {
  try {
    const abs = resolveExportPath(stateKey);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
    return true;
  } catch (_) {
    return false; // export derivado nunca corrompe a fonte canônica
  }
}

function readExport(stateKey) {
  try {
    return JSON.parse(fs.readFileSync(resolveExportPath(stateKey), 'utf8'));
  } catch (_) {
    return undefined;
  }
}

function persistenceRequired(cause = null) {
  const error = new Error('artifact_store_postgres_required');
  error.code = 'PERSISTENCE_REQUIRED';
  if (cause) error.cause = cause;
  return error;
}

/**
 * CERTIFICATION_MODE=true (ou NODE_ENV=production) exige DB como fonte única:
 *   - DB indisponível → PERSISTENCE_REQUIRED (nunca filesystem fallback);
 *   - load() lê do DB (nunca do JSON export);
 *   - save() propaga falha de DB (nunca grava JSON e segue).
 */
function isCertificationMode() {
  return process.env.CERTIFICATION_MODE === 'true'
    || process.env.CERTIFICATION_MODE === '1'
    || process.env.NODE_ENV === 'production';
}

async function ensureStore() {
  const certification = isCertificationMode();
  if (cachedStore) return cachedStore;
  if (!getSequelize()) {
    try {
      await connect(3, 300);
    } catch (error) {
      if (certification) throw persistenceRequired(error);
    }
  }
  const postgresReady = Boolean(getSequelize());
  if (certification && !postgresReady) throw persistenceRequired();
  if (postgresReady && process.env.ARTIFACT_STORE_BACKEND !== 'filesystem') {
    cachedStore = createArtifactStore({ backend: 'postgres' });
  } else if (certification) {
    // Certificação NUNCA usa filesystem como fonte de verdade.
    throw persistenceRequired();
  } else {
    cachedStore = createArtifactStore({ backend: 'filesystem', rootDir: path.join(ROOT, 'cache', 'qa-state') });
  }
  return cachedStore;
}

async function save(stateKey, data) {
  const store = await ensureStore();
  const refId = sanitizeRefId(stateKey.replace(/^\.\//, '').replace(/^\/+/, ''));
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  const result = await store.write({ kind: KIND, refId, payload });
  writeExport(stateKey, data); // export derivado do banco (após commit do write)
  return result;
}

function saveSyncExport(stateKey, data) {
  // DB-first em runtime governado: grava no DB PRIMEIRO e deriva o export DEPOIS.
  // Falha de DB propaga — a operação NÃO continua usando JSON como verdade.
  if (isCertificationMode()) {
    return save(stateKey, data);
  }
  // Dev/CI (utility local, não governado): o export síncrono é cache
  // NÃO-autoritativo para leituras offline; a persistência canônica no DB é
  // agendada. Nenhum path de certificação depende deste cache.
  writeExport(stateKey, data);
  save(stateKey, data).catch((error) => {
    // eslint-disable-next-line no-console
    console.error(`[dbStateStore] persistence_required: ${stateKey}: ${error?.message || error}`);
  });
}

async function loadFromDb(stateKey, fallback = null) {
  try {
    const store = await ensureStore();
    const refId = sanitizeRefId(stateKey.replace(/^\.\//, '').replace(/^\/+/, ''));
    const data = await store.readJson({ kind: KIND, refId });
    return data === null ? fallback : data;
  } catch (error) {
    if (isCertificationMode()) throw persistenceRequired(error);
    return fallback;
  }
}

/**
 * Leitura canônica — lê do DB. Em CERTIFICATION_MODE/produção, o JSON export
 * (cache) NUNCA é usado como fonte de verdade; DB indisponível → PERSISTENCE_REQUIRED.
 * Fora de certificação (dev/CI), usa o DB quando disponível e cai para o export
 * derivado apenas quando o DB não tem o valor.
 */
async function load(stateKey, fallback = null) {
  if (isCertificationMode()) {
    return loadFromDb(stateKey, fallback);
  }
  try {
    const fromDb = await loadFromDb(stateKey, undefined);
    if (fromDb !== undefined) return fromDb;
  } catch (_) {
    // dev: DB indisponível → cache export (não autoritativo)
  }
  const cached = readExport(stateKey);
  return cached === undefined ? fallback : cached;
}

function resetStoreForTests() { cachedStore = null; }

module.exports = { save, saveSyncExport, load, loadFromDb, isCertificationMode, KIND, writeExport, readExport, sanitizeRefId, resetStoreForTests };
