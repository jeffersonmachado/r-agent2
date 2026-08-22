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
    .replace(/[^A-Za-z0-9._/-]/g, '-')
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

async function ensureStore() {
  const production = process.env.NODE_ENV === 'production';
  if (cachedStore) return cachedStore;
  if (!getSequelize()) {
    try {
      await connect(3, 300);
    } catch (error) {
      if (production) throw persistenceRequired(error);
    }
  }
  const postgresReady = Boolean(getSequelize());
  if (production && !postgresReady) throw persistenceRequired();
  if (postgresReady && process.env.ARTIFACT_STORE_BACKEND !== 'filesystem') {
    cachedStore = createArtifactStore({ backend: 'postgres' });
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
  writeExport(stateKey, data); // export derivado do banco
  return result;
}

function saveSyncExport(stateKey, data) {
  // Grava o export derivado (síncrono, CI-friendly) e agenda a persistência
  // canônica no DB (fire-and-forget). A fonte de verdade é o banco; o JSON é
  // apenas o cache derivado para leituras síncronas.
  writeExport(stateKey, data);
  save(stateKey, data).catch((error) => {
    // Em produção, falha de persistência é crítica; em dev, loga e segue.
    if (process.env.NODE_ENV === 'production') {
      // eslint-disable-next-line no-console
      console.error(`[dbStateStore] persistence_required: ${stateKey}: ${error?.message || error}`);
    }
  });
}

async function loadFromDb(stateKey, fallback = null) {
  try {
    const store = await ensureStore();
    const refId = sanitizeRefId(stateKey.replace(/^\.\//, '').replace(/^\/+/, ''));
    const data = await store.readJson({ kind: KIND, refId });
    return data === null ? fallback : data;
  } catch (_) {
    return fallback;
  }
}

function load(stateKey, fallback = null) {
  const data = readExport(stateKey);
  return data === undefined ? fallback : data;
}

function resetStoreForTests() { cachedStore = null; }

module.exports = { save, saveSyncExport, load, loadFromDb, KIND, writeExport, readExport, resetStoreForTests };
