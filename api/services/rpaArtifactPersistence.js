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
const { Op } = require('sequelize');
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
  origin = null,
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
      const safeResults = redactDeep({ ...results, tenantId: scopedTenantKey, executionId: safeExecutionId, origin: origin || null });
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
      origin: origin || null,
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

/**
 * Impressão digital BARATA do conjunto de artefatos de um tenant.
 *
 * Serve para validar cache de listagem sem reler os payloads: uma única query
 * por índice devolve contagem + instante da última escrita. Medido 2026-10-02:
 *   - validação: 5,7 ms (Bitmap Index Scan em runtime_artifacts_tenant_kind_created_idx)
 *   - leitura completa que ela substitui: ~555 ms para ~1.227 manifestos
 *
 * Cobre as três mudanças possíveis:
 *   - INSERT novo      -> muda `count` e `max(created_at)`
 *   - DELETE           -> muda `count`
 *   - UPDATE in-place  -> muda `max(updated_at)` (ex.: reconcileExecutionManifests
 *     re-assina o manifesto com o MESMO refId, sem alterar count nem created_at)
 * Por isso `updated_at` NÃO pode ser omitido — ele é o único sinal da terceira
 * classe, que é justamente a que a reconciliação produz.
 *
 * Devolve `null` quando não há banco ou a consulta falha: o chamador deve então
 * NÃO usar cache (fail-closed) e seguir pelo caminho real.
 */
async function getExecutionArtifactsFingerprint(tenantKey = 'system') {
  try {
    const sequelize = getSequelize();
    if (!sequelize) return null;
    const { QueryTypes } = require('sequelize');
    const rows = await sequelize.query(
      `SELECT count(*)::bigint AS n, max(created_at) AS c, max(updated_at) AS u
         FROM runtime_artifacts
        WHERE tenant_key = :tenantKey
          AND kind IN (:kinds)`,
      {
        replacements: {
          tenantKey: normalizeTenantKey(tenantKey),
          kinds: [KIND_EXECUTION, KIND_TRACE, KIND_SCREENSHOT],
        },
        type: QueryTypes.SELECT,
      }
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return null;
    const count = Number(row.n) || 0;
    const maxCreatedAt = row.c ? new Date(row.c).toISOString() : '';
    const maxUpdatedAt = row.u ? new Date(row.u).toISOString() : '';
    return { count, maxCreatedAt, maxUpdatedAt, key: `${count}|${maxCreatedAt}|${maxUpdatedAt}` };
  } catch (_) {
    return null;
  }
}

/** Lista em lote apenas os manifestos de execução VÁLIDOS, com UMA leitura no
 * store.
 *
 * Equivale a chamar `getExecutionManifest(refId)` para cada manifesto, mas sem
 * N+1: o payload vem na mesma query e o hash é conferido em memória. Mesma
 * semântica de descarte do caminho individual — não afrouxa nenhuma verificação:
 *   - sem payload recuperável (ex.: artefato em blob)  → descartado
 *   - hash real diferente do registrado               → descartado
 *   - JSON inválido                                   → descartado
 *   - integridade de replay inválida                  → descartado
 * Ordenação: mais recentes primeiro (igual a `listExecutionManifests`).
 */
async function listValidExecutionManifests(tenantKey = 'system') {
  try {
    const store = await ensureStore();
    const scopedTenantKey = normalizeTenantKey(tenantKey);
    const rows = await store.listWithContent({ kind: KIND_EXECUTION, tenantKey: scopedTenantKey });
    const valid = [];
    for (const row of rows) {
      if (!row.payload) continue;
      if (typeof row.actualSha256 !== 'string' || row.actualSha256 !== row.sha256) continue;
      let manifest;
      try {
        manifest = JSON.parse(row.payload.toString('utf8'));
      } catch (_) {
        continue;
      }
      if (!manifest) continue;
      const integrity = validateReplayIntegrity(manifest, manifest.governance || {}, { maxAgeMs: -1 });
      if (!integrity.valid) continue;
      valid.push({ refId: row.refId, createdAt: row.createdAt, manifest });
    }
    return valid.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
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

/**
 * Varre o blob store e remove blobs órfãos — arquivos em disco que não são
 * referenciados por nenhuma linha `runtime_artifacts.storage_key`.
 *
 * O `remove()` do artifact store apaga apenas a linha do Postgres; os bytes
 * ficavam órfãos no disco para sempre. Este sweep é a contraparte de garbage
 * collection, seguro para blobs content-addressed (um blob só é removido
 * quando NENHUMA linha o referencia).
 *
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{totalFiles, referenced, orphaned, removed, freedBytes, dryRun, reason?}>}
 */
async function sweepOrphanedBlobs({ dryRun = true } = {}) {
  try {
    const store = await ensureStore();
    if (store.backend !== 'postgres') {
      return {
        totalFiles: 0,
        referenced: 0,
        orphaned: 0,
        removed: 0,
        freedBytes: 0,
        dryRun,
        reason: 'backend_nao_postgres',
      };
    }

    const blobStore = createBlobStore({ rootDir: resolveRuntimePath('artifacts', 'blobs') });
    const keys = blobStore.listKeys();

    const RuntimeArtifact = require('../db/models/RuntimeArtifact')();
    const rows = await RuntimeArtifact.findAll({
      attributes: ['storage_key'],
      where: { storage_key: { [Op.ne]: null } },
      raw: true,
    });
    const referenced = new Set((rows || []).map((row) => row.storage_key).filter(Boolean));

    let removed = 0;
    let freedBytes = 0;
    let orphaned = 0;
    for (const key of keys) {
      if (referenced.has(key)) continue;
      orphaned += 1;
      const abs = path.join(blobStore.rootDir, key);
      try {
        const stat = fs.statSync(abs);
        freedBytes += stat.size;
        if (!dryRun) {
          fs.unlinkSync(abs);
          removed += 1;
        }
      } catch (_) {
        // Arquivo sumiu entre a listagem e a remoção — ignora.
      }
    }

    return {
      totalFiles: keys.length,
      referenced: referenced.size,
      orphaned,
      removed,
      freedBytes,
      dryRun,
    };
  } catch (error) {
    logger.warn('[rpaArtifactPersistence] Falha no sweep de blobs órfãos', {
      error: String(error?.message || error),
    });
    return {
      totalFiles: 0,
      referenced: 0,
      orphaned: 0,
      removed: 0,
      freedBytes: 0,
      dryRun,
      reason: String(error?.message || error),
    };
  }
}

/**
 * Varre `runtime_artifacts` e remove metadados órfãos — linhas com
 * `storage_key` cujo blob não existe mais em disco (inverso do
 * `sweepOrphanedBlobs`). Linhas de artefatos binários (trace/screenshot)
 * cujo payload foi perdido não são recuperáveis: remover o metadado mantém o
 * inventário de artefatos consistente com o blob store.
 *
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{totalRows, dangling, removed, dryRun, reason?}>}
 */
async function sweepOrphanedArtifactMetadata({ dryRun = true } = {}) {
  try {
    const store = await ensureStore();
    if (store.backend !== 'postgres') {
      return {
        totalRows: 0,
        dangling: 0,
        removed: 0,
        dryRun,
        reason: 'backend_nao_postgres',
      };
    }

    const blobStore = createBlobStore({ rootDir: resolveRuntimePath('artifacts', 'blobs') });
    const RuntimeArtifact = require('../db/models/RuntimeArtifact')();

    const rows = await RuntimeArtifact.findAll({
      attributes: ['id', 'storage_key'],
      where: { storage_key: { [Op.ne]: null } },
      raw: true,
    });

    const danglingIds = [];
    for (const row of rows || []) {
      if (!row.storage_key) continue;
      try {
        if (!(await blobStore.has(row.storage_key))) danglingIds.push(row.id);
      } catch (_) {
        danglingIds.push(row.id);
      }
    }

    let removed = 0;
    if (!dryRun && danglingIds.length > 0) {
      removed = await RuntimeArtifact.destroy({
        where: { id: { [Op.in]: danglingIds } },
      });
    }

    return {
      totalRows: (rows || []).length,
      dangling: danglingIds.length,
      removed,
      dryRun,
    };
  } catch (error) {
    logger.warn('[rpaArtifactPersistence] Falha no sweep de metadados órfãos', {
      error: String(error?.message || error),
    });
    return {
      totalRows: 0,
      dangling: 0,
      removed: 0,
      dryRun,
      reason: String(error?.message || error),
    };
  }
}

/**
 * Retorna a disponibilidade REAL dos binários persistidos (trace + screenshots)
 * a partir das linhas `runtime_artifacts`, sem confiar no manifesto. Usada pela
 * listagem de artefatos para nunca anunciar um binário que não existe mais
 * (ex.: metadado removido por sweep de órfãos).
 *
 * @param {string} tenantKey
 * @returns {Promise<{traces: Set<string>, screenshots: Map<string, number>}>}
 */
async function getExecutionArtifactReality(tenantKey = 'system') {
  const tkey = normalizeTenantKey(tenantKey);
  const sequelize = getSequelize();
  if (!sequelize) return { traces: new Set(), screenshots: new Map() };
  const { QueryTypes } = require('sequelize');

  const traces = new Set();
  const screenshots = new Map();

  const traceRows = await sequelize.query(
    'SELECT ref_id FROM runtime_artifacts WHERE kind = :kind AND tenant_key = :tkey',
    { replacements: { kind: KIND_TRACE, tkey }, type: QueryTypes.SELECT },
  );
  for (const row of traceRows || []) traces.add(row.ref_id);

  const shotRows = await sequelize.query(
    "SELECT regexp_replace(ref_id, '-\\d+$', '') AS exec_id, COUNT(*)::int AS count FROM runtime_artifacts WHERE kind = :kind AND tenant_key = :tkey GROUP BY exec_id",
    { replacements: { kind: KIND_SCREENSHOT, tkey }, type: QueryTypes.SELECT },
  );
  for (const row of shotRows || []) screenshots.set(row.exec_id, Number(row.count));

  return { traces, screenshots };
}

/**
 * Reconcilia os manifestos de execução (`rpa/execution`) com a realidade dos
 * binários persistidos. Quando o manifesto declara `trace: true` ou
 * `screenshots: N` mas as linhas correspondentes não existem mais, corrige o
 * manifesto e re-assina. Dry-run por padrão.
 *
 * @param {{ dryRun?: boolean }} options
 * @returns {Promise<{checked:number, reconciled:number, traceFixed:number, screenshotsFixed:number, dryRun:boolean, reason?:string}>}
 */
async function reconcileExecutionManifests({ dryRun = true } = {}) {
  const store = await ensureStore();
  if (store.backend !== 'postgres') {
    return { checked: 0, reconciled: 0, traceFixed: 0, screenshotsFixed: 0, dryRun, reason: 'backend_nao_postgres' };
  }

  const manifestsMeta = await listExecutionManifests();
  const result = { checked: 0, reconciled: 0, traceFixed: 0, screenshotsFixed: 0, skippedUnknownTenant: 0, dryRun };

  // Fail-closed: manifesto sem tenantKey NÃO é atribuído a 'system' por
  // fallback — tenant desconhecido é pulado e contado (system-scope-audit:
  // RUNTIME_FAIL_OPEN proibido em runtime).
  const knownManifests = (manifestsMeta || []).filter((m) => m && typeof m.tenantKey === 'string' && m.tenantKey.trim());
  result.skippedUnknownTenant = (manifestsMeta || []).length - knownManifests.length;

  // Realidade agregada por tenant presente nos manifestos.
  const tenants = new Set(knownManifests.map((m) => normalizeTenantKey(m.tenantKey)));
  const realityByTenant = new Map();
  for (const t of tenants) {
    realityByTenant.set(t, await getExecutionArtifactReality(t));
  }

  for (const meta of knownManifests) {
    const tenantKey = normalizeTenantKey(meta.tenantKey);
    const manifest = await getExecutionManifest(meta.refId, tenantKey);
    if (!manifest) continue;
    result.checked += 1;

    const executionId = manifest.executionId || meta.refId;
    const reality = realityByTenant.get(tenantKey) || { traces: new Set(), screenshots: new Map() };
    const hasTrace = reality.traces.has(executionId);
    const realScreenshots = reality.screenshots.get(executionId) || 0;

    let changed = false;
    if (manifest.trace === true && !hasTrace) {
      manifest.trace = false;
      delete manifest.traceFileName;
      changed = true;
      result.traceFixed += 1;
    }
    if (Number(manifest.screenshots || 0) !== realScreenshots) {
      manifest.screenshots = realScreenshots;
      changed = true;
      result.screenshotsFixed += 1;
    }

    if (changed) {
      result.reconciled += 1;
      if (!dryRun) {
        const governance = manifest.governance || {
          goNoGo: manifest.status === 'completed' ? 'GO' : 'NO_GO',
          isOperational: manifest.status === 'completed',
          blockers: manifest.status === 'completed' ? [] : [{ reason: 'rpa_execution_not_completed' }],
        };
        delete manifest.replayHash;
        delete manifest.replayChecksum;
        delete manifest.governanceSignature;
        delete manifest.integrity;
        delete manifest.signedAt;
        const signed = signReplayArtifact(manifest, { governance, tenantId: tenantKey });
        await store.write({ kind: KIND_EXECUTION, refId: executionId, tenantKey, payload: signed });
      }
    }
  }

  return result;
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
  listValidExecutionManifests,
  getExecutionArtifactsFingerprint,
  getRecording,
  getReplay,
  getTraceBuffer,
  getScreenshotBuffer,
  indexExecutionInRag,
  sweepOrphanedBlobs,
  sweepOrphanedArtifactMetadata,
  getExecutionArtifactReality,
  reconcileExecutionManifests,
  resetStoreForTests,
};
