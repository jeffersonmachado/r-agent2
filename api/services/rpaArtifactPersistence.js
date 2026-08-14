'use strict';

/**
 * Persistência de artefatos de execução RPA (roteiro + replay + trace visual +
 * screenshots) no banco de dados (Postgres via Artifact Store) e indexação de
 * resumo no RAG para consulta.
 *
 * Contratos de armazenamento (backend postgres do `lib/artifactStore.js`):
 *   - kind `rpa/recording`  refId=<recordingId>      JSON  → roteiro/gravação
 *   - kind `rpa/replay`     refId=<executionId>      JSON  → resultado/replay
 *   - kind `rpa/trace`      refId=<executionId>      ZIP   → trace visual Playwright
 *   - kind `rpa/screenshot` refId=<executionId>-<n>  bytes → screenshots
 *   - kind `rpa/execution`  refId=<executionId>      JSON  → manifesto (índice)
 *
 * Binários (trace ZIP / screenshots) vão para o Blob Store (content-addressed,
 * fora do WAL/TOAST) e o Postgres guarda apenas metadados + `storage_key`.
 *
 * Em produção a seleção do backend é fail-closed: indisponibilidade do
 * Postgres não causa fallback silencioso para filesystem.
 */

const fs = require('fs');
const path = require('path');
const { createArtifactStore } = require('../../lib/artifactStore');
const { createBlobStore } = require('../../lib/blobStore');
const { getSequelize, connect } = require('../db/sequelize');
const { resolveRuntimePath } = require('../utils/runtimePaths');
const logger = require('../utils/logger');
const { normalizeTenantKey, redactDeep, redactText } = require('../../lib/rpaSecurity');
const { signReplayArtifact, validateReplayIntegrity } = require('../../lib/replayIntegrity');

const KIND_RECORDING = 'rpa/recording';
const KIND_REPLAY = 'rpa/replay';
const KIND_TRACE = 'rpa/trace';
const KIND_SCREENSHOT = 'rpa/screenshot';
const KIND_EXECUTION = 'rpa/execution';

let cachedStore = null;

function sanitizeRefId(value) {
  const cleaned = String(value || 'unknown')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^-+/, '')
    .slice(0, 255);
  return cleaned || 'unknown';
}

function getStore() {
  if (cachedStore) return cachedStore;

  const postgresReady = Boolean(getSequelize());
  const backend = process.env.ARTIFACT_STORE_BACKEND === 'filesystem' || !postgresReady
    ? 'filesystem'
    : 'postgres';

  if (backend === 'postgres') {
    const blobStore = createBlobStore({ rootDir: resolveRuntimePath('artifacts', 'blobs') });
    cachedStore = createArtifactStore({ backend: 'postgres', blobStore });
  } else {
    cachedStore = createArtifactStore({
      backend: 'filesystem',
      rootDir: resolveRuntimePath('artifacts', 'fs'),
    });
  }

  return cachedStore;
}

function persistenceRequired(cause = null) {
  const required = new Error('artifact_store_postgres_required');
  required.code = 'PERSISTENCE_REQUIRED';
  if (cause) required.cause = cause;
  return required;
}

/**
 * Garante que o Sequelize esteja conectado antes de decidir o backend, para
 * que artefatos sejam persistidos no Postgres mesmo quando o caller (ex.: QA
 * Mesh runner) ainda não conectou. Melhor esforço: falha de conexão cai para
 * filesystem sem derrubar a execução.
 */
async function ensureStore() {
  const production = process.env.NODE_ENV === 'production';
  if (cachedStore) {
    if (production && cachedStore.backend !== 'postgres') throw persistenceRequired();
    return cachedStore;
  }
  if (process.env.ARTIFACT_STORE_BACKEND === 'filesystem') {
    if (production) throw persistenceRequired();
    // Backend filesystem explícito só é permitido fora de produção.
    return getStore();
  }
  if (!getSequelize()) {
    try {
      await connect(3, 300);
    } catch (error) {
      if (production) throw persistenceRequired(error);
      logger.warn('[rpaArtifactPersistence] Falha ao conectar Sequelize; usando backend filesystem', {
        error: String(error?.message || error),
      });
    }
  }
  if (production && !getSequelize()) throw persistenceRequired();
  const store = getStore();
  if (production && store.backend !== 'postgres') throw persistenceRequired();
  return store;
}

/** Invalida o cache do store (útil em testes). */
function resetStoreForTests() {
  cachedStore = null;
}

async function writeJson(store, kind, refId, payload, tenantKey) {
  if (payload === undefined || payload === null) return false;
  await store.write({ kind, refId, tenantKey, payload });
  return true;
}

async function writeBlob(store, kind, refId, filePath, tenantKey) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  const buffer = fs.readFileSync(filePath);
  await store.write({ kind, refId, tenantKey, payload: buffer });
  return buffer.length;
}

function collectScreenshots(results) {
  const screenshots = Array.isArray(results?.screenshots) ? results.screenshots : [];
  const paths = [];
  for (const shot of screenshots) {
    const shotPath = typeof shot === 'string' ? shot : (shot?.path || shot?.filePath || null);
    if (shotPath) paths.push(shotPath);
  }
  return paths;
}

/**
 * Persiste roteiro + replay + trace + screenshots + manifesto no banco.
 * Retorna o resumo do que foi persistido. Em produção, falhas de persistência
 * são bloqueantes; fora dela o erro é registrado no resultado.
 */
async function persistExecutionArtifacts({
  recording = null,
  recordingId = null,
  executionId = null,
  results = null,
  tracePath = null,
  tenantKey = 'system',
  startedAt = null,
  finishedAt = null,
  status = null,
} = {}) {
  const outcome = {
    backend: null,
    recording: false,
    replay: false,
    trace: false,
    screenshots: 0,
    executionManifest: false,
    error: null,
  };

  if (!executionId && !recordingId) {
    outcome.error = 'artifact_execution_id_required';
    return outcome;
  }

  const safeExecutionId = sanitizeRefId(executionId || `rpa-${Date.now()}`);
  const safeRecordingId = sanitizeRefId(recordingId || safeExecutionId);
  const scopedTenantKey = normalizeTenantKey(tenantKey);

  try {
    const store = await ensureStore();
    outcome.backend = store.backend;

    // 1. Roteiro (gravação) — sempre persistido se disponível.
    const safeRecording = recording == null
      ? null
      : redactDeep({ ...recording, tenantId: scopedTenantKey });
    outcome.recording = await writeJson(store, KIND_RECORDING, safeRecordingId, safeRecording, scopedTenantKey);

    // 2. Replay/resultado — sempre persistido se disponível.
    let signedReplay = null;
    if (results != null) {
      const safeResults = redactDeep({ ...results, tenantId: scopedTenantKey, executionId: safeExecutionId });
      const governance = {
        goNoGo: safeResults.success === true ? 'GO' : 'NO_GO',
        isOperational: safeResults.success === true,
        blockers: safeResults.success === true ? [] : [{ reason: 'rpa_execution_failed' }],
      };
      signedReplay = signReplayArtifact(safeResults, { governance, tenantId: scopedTenantKey });
    }
    outcome.replay = await writeJson(store, KIND_REPLAY, safeExecutionId, signedReplay, scopedTenantKey);

    // 3. Trace visual (ZIP) — binário no blob store.
    if (tracePath && fs.existsSync(tracePath)) {
      outcome.trace = (await writeBlob(store, KIND_TRACE, safeExecutionId, tracePath, scopedTenantKey)) > 0;
    }

    // 4. Screenshots — binários.
    const screenshotPaths = collectScreenshots(results);
    let screenshotIndex = 0;
    for (const shotPath of screenshotPaths) {
      const written = await writeBlob(
        store,
        KIND_SCREENSHOT,
        `${safeExecutionId}-${screenshotIndex}`,
        shotPath,
        scopedTenantKey,
      );
      if (written) screenshotIndex += 1;
    }
    outcome.screenshots = screenshotIndex;

    // 5. Manifesto da execução (índice de artefatos persistidos).
    const manifest = {
      executionId: safeExecutionId,
      recordingId: safeRecordingId,
      status: status || (results?.success ? 'completed' : 'failed'),
      trace: outcome.trace,
      screenshots: screenshotIndex,
      recording: outcome.recording,
      replay: outcome.replay,
      traceFileName: tracePath ? path.basename(tracePath) : null,
      startedAt: startedAt || (results?.startTime || null),
      finishedAt: finishedAt || null,
      persistedAt: new Date().toISOString(),
      tenantKey: scopedTenantKey,
    };
    const signedManifest = signReplayArtifact(manifest, {
      governance: {
        goNoGo: manifest.status === 'completed' ? 'GO' : 'NO_GO',
        isOperational: manifest.status === 'completed',
        blockers: manifest.status === 'completed' ? [] : [{ reason: 'rpa_execution_not_completed' }],
      },
      tenantId: scopedTenantKey,
    });
    outcome.executionManifest = await writeJson(store, KIND_EXECUTION, safeExecutionId, signedManifest, scopedTenantKey);
  } catch (error) {
    outcome.error = String(error?.message || error);
    logger.warn('[rpaArtifactPersistence] Falha ao persistir artefatos RPA', {
      executionId,
      recordingId,
      error: outcome.error,
    });
    if (process.env.NODE_ENV === 'production') throw error;
  }

  return outcome;
}

/** Recupera o manifesto de uma execução (ou null). */
async function getExecutionManifest(executionId, tenantKey = 'system') {
  try {
    const store = await ensureStore();
    const query = {
      kind: KIND_EXECUTION,
      refId: sanitizeRefId(executionId),
      tenantKey: normalizeTenantKey(tenantKey),
    };
    const verification = await store.verify(query);
    if (!verification.valid) return null;
    const manifest = await store.readJson(query);
    if (!manifest) return null;
    const integrity = validateReplayIntegrity(manifest, manifest.governance || {}, { maxAgeMs: -1 });
    return integrity.valid ? manifest : null;
  } catch (_) {
    return null;
  }
}

/** Lista todos os manifestos de execução persistidos (mais recentes primeiro). */
async function listExecutionManifests(tenantKey = null) {
  try {
    const items = await (await ensureStore()).list({
      kind: KIND_EXECUTION,
      tenantKey: tenantKey == null ? null : normalizeTenantKey(tenantKey),
    });
    return items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch (_) {
    return [];
  }
}

/** Recupera o roteiro (recording) persistido. */
async function getRecording(recordingId, tenantKey = 'system') {
  try {
    const store = await ensureStore();
    const query = {
      kind: KIND_RECORDING,
      refId: sanitizeRefId(recordingId),
      tenantKey: normalizeTenantKey(tenantKey),
    };
    const verification = await store.verify(query);
    if (!verification.valid) return null;
    return await store.readJson(query);
  } catch (_) {
    return null;
  }
}

/** Recupera o replay (results) persistido. */
async function getReplay(executionId, tenantKey = 'system') {
  try {
    const store = await ensureStore();
    const query = {
      kind: KIND_REPLAY,
      refId: sanitizeRefId(executionId),
      tenantKey: normalizeTenantKey(tenantKey),
    };
    const verification = await store.verify(query);
    if (!verification.valid) return null;
    const replay = await store.readJson(query);
    if (!replay) return null;
    const integrity = validateReplayIntegrity(replay, replay.governance || {}, { maxAgeMs: -1 });
    return integrity.valid ? replay : null;
  } catch (_) {
    return null;
  }
}

/** Recupera o trace visual (ZIP) persistido como Buffer. */
async function getTraceBuffer(executionId, tenantKey = 'system') {
  try {
    const store = await ensureStore();
    const query = {
      kind: KIND_TRACE,
      refId: sanitizeRefId(executionId),
      tenantKey: normalizeTenantKey(tenantKey),
    };
    const verification = await store.verify(query);
    if (!verification.valid) return null;
    return await store.readBuffer(query);
  } catch (_) {
    return null;
  }
}

/** Recupera um screenshot persistido como Buffer. */
async function getScreenshotBuffer(refId, tenantKey = 'system') {
  try {
    const store = await ensureStore();
    const query = {
      kind: KIND_SCREENSHOT,
      refId: sanitizeRefId(refId),
      tenantKey: normalizeTenantKey(tenantKey),
    };
    const verification = await store.verify(query);
    if (!verification.valid) return null;
    return await store.readBuffer(query);
  } catch (_) {
    return null;
  }
}

/**
 * Indexa no RAG um resumo textual da execução (roteiro + resultado) para
 * consulta. O conteúdo é classificado como evidência interna de suporte e
 * nunca entra no domínio operacional de usuários finais.
 */
async function indexExecutionInRag({
  recording = null,
  recordingId = null,
  executionId = null,
  results = null,
  tenantKey = 'system',
} = {}) {
  try {
    const ragDocumentsService = require('./ragDocumentsService');
    const title = String(recording?.name || recording?.id || recordingId || executionId);
    const stepsSummary = (Array.isArray(recording?.steps) ? recording.steps : [])
      .map((step, index) => `${index + 1}. ${step?.type || step?.actionType || 'action'}`
        + `${step?.selector ? ` -> ${step.selector}` : ''}${step?.url ? ` -> ${step.url}` : ''}`)
      .join('\n');
    const resultSummary = results?.success ? 'SUCESSO' : 'FALHA';
    const errorsSummary = (Array.isArray(results?.errors) ? results.errors : [])
      .slice(0, 10)
      .map((entry) => redactText(entry?.error || entry?.message || ''))
      .filter(Boolean)
      .join('\n');

    const content = [
      `Execução RPA: ${title}`,
      `Recording ID: ${recordingId || 'n/a'}`,
      `Execution ID: ${executionId || 'n/a'}`,
      `Resultado: ${resultSummary}`,
      '',
      'Roteiro (passos):',
      stepsSummary || '(sem passos)',
      errorsSummary ? `\nErros:\n${errorsSummary}` : '',
    ].filter(Boolean).join('\n');

    await ragDocumentsService.createDocument({
      title: `RPA: ${title} (${recordingId || executionId})`,
      content,
      autoIndex: true,
      domain: 'SYSTEM',
      classification: 'SUPPORT',
      sensitivity: 'CONFIDENTIAL',
      permissions: {
        roles: ['super_admin', 'auditor'],
        agents: [],
      },
      metadata: {
        source: 'rpa-artifact',
        category: 'rpa-execution',
        executionId: executionId || null,
        recordingId: recordingId || null,
      },
    }, normalizeTenantKey(tenantKey));
    logger.info('[rpaArtifactPersistence] Resumo indexado no RAG', { executionId, recordingId });
    return true;
  } catch (error) {
    logger.warn('[rpaArtifactPersistence] Falha ao indexar execução no RAG', {
      executionId,
      recordingId,
      error: String(error?.message || error),
    });
    return false;
  }
}

module.exports = {
  KIND_RECORDING,
  KIND_REPLAY,
  KIND_TRACE,
  KIND_SCREENSHOT,
  KIND_EXECUTION,
  sanitizeRefId,
  persistExecutionArtifacts,
  getExecutionManifest,
  listExecutionManifests,
  getRecording,
  getReplay,
  getTraceBuffer,
  getScreenshotBuffer,
  indexExecutionInRag,
  resetStoreForTests,
};
