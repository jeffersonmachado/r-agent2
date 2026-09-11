'use strict';

/**
 * Armazenamento de replay do Learning Core — acesso SEMPRE escopado por tenant.
 *
 * Contexto (auditoria 2026-09-11): a listagem e a leitura de replay varriam o
 * diretório global `runtime/rpa/replay` sem filtro de tenant. Como os replays
 * ficam fisicamente no mesmo runtime root, um ator autorizado no tenant A
 * enumerava e consumia replays do tenant B.
 *
 * Regras (fail-closed):
 *  - Todo replay só é visível para o tenant declarado no próprio artefato.
 *  - Replay legado sem `tenantId` NUNCA é exposto (não há como provar posse).
 *  - Sem `tenantId` no pedido → nada é listado/nada é carregado.
 *  - Dois layouts coexistem e são suportados: `<base>/<replayId>.json`
 *    (legado) e `<base>/<tenantId>/<replayId>.json` (escopado).
 *  - `replayId` é validado contra path traversal antes de qualquer I/O.
 */

const fs = require('fs');
const path = require('path');

const { resolveRuntimePath } = require('../../utils/runtimePaths');
const logger = require('../../utils/logger');

const REPLAY_ID_PATTERN = /^[\w.-]{1,120}$/;
const TENANT_SEGMENT_MAX = 180;

function normalizeTenantId(value) {
  const tenantId = String(value ?? '').trim();
  return tenantId || null;
}

/** Segmento de diretório seguro derivado do tenantId (sem separadores). */
function tenantSegment(tenantId) {
  const segment = normalizeTenantId(tenantId)
    .replace(/[\\/]/g, '-')
    .replace(/[\u0000-\u001F\u007F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .trim();
  if (!segment) return null;
  return segment.slice(0, TENANT_SEGMENT_MAX);
}

function replayBaseDir() {
  return resolveRuntimePath('rpa', 'replay');
}

/**
 * Caminhos candidatos (na ordem de precedência) para um replayId de um tenant.
 * O diretório escopado por tenant vence o diretório base.
 */
function candidatePaths(replayId, tenantId) {
  const base = replayBaseDir();
  const segment = tenantSegment(tenantId);
  const filename = `${path.basename(String(replayId))}.json`;
  const paths = [];
  if (segment) paths.push(path.join(base, segment, filename));
  paths.push(path.join(base, filename));
  return paths;
}

function assertValidReplayId(replayId) {
  if (!REPLAY_ID_PATTERN.test(String(replayId ?? ''))) {
    const error = new Error('replayId invalido');
    error.code = 'BAD_REQUEST';
    throw error;
  }
}

/**
 * Carrega um replay validando posse por tenant.
 *
 * @param {string} replayId
 * @param {string} tenantId
 * @returns {Object} payload do replay
 * @throws {Error} BAD_REQUEST | NOT_FOUND
 */
function readTenantScopedReplay(replayId, tenantId) {
  assertValidReplayId(replayId);

  const scoped = normalizeTenantId(tenantId);
  if (!scoped) {
    const error = new Error('tenantId obrigatorio para acessar replay');
    error.code = 'BAD_REQUEST';
    throw error;
  }

  for (const filePath of candidatePaths(replayId, scoped)) {
    const base = replayBaseDir();
    if (!filePath.startsWith(base)) continue;
    if (!fs.existsSync(filePath)) continue;

    let replay;
    try {
      replay = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (parseError) {
      logger.warn('[learning-core] Replay ilegivel', { file: path.basename(filePath), error: parseError.message });
      continue;
    }

    // Fail-closed: posse precisa ser provada pelo artefato, não pelo diretório.
    if (normalizeTenantId(replay?.tenantId) !== scoped) {
      logger.warn('[learning-core] Replay de outro tenant recusado', {
        replayId: String(replayId),
        requestedTenant: scoped,
      });
      continue;
    }

    return replay;
  }

  const error = new Error(`Replay nao encontrado: ${replayId}`);
  error.code = 'NOT_FOUND';
  throw error;
}

/**
 * Resume um replay para listagem (sem vazar conteúdo).
 */
function summarizeReplay(replay, fallbackId) {
  return {
    id: replay.id || fallbackId,
    context: replay.context || null,
    startTime: replay.startTime || null,
    actions: Array.isArray(replay.actions) ? replay.actions.length : 0,
    screens: Array.isArray(replay.screens) ? replay.screens.length : 0,
    errors: Array.isArray(replay.errors) ? replay.errors.length : 0,
  };
}

/**
 * Lista replays do tenant (somente os comprovadamente dele).
 *
 * @param {string|null} tenantId
 * @returns {Array<Object>}
 */
function listTenantScopedReplays(tenantId) {
  const scoped = normalizeTenantId(tenantId);
  if (!scoped) return [];

  const base = replayBaseDir();
  const segment = tenantSegment(scoped);
  const directories = [];
  if (segment) directories.push(path.join(base, segment));
  directories.push(base);

  const byId = new Map();
  const seenFiles = new Set();

  for (const dir of directories) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const filePath = path.join(dir, name);
      if (seenFiles.has(filePath)) continue;
      seenFiles.add(filePath);

      let replay;
      try {
        replay = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        logger.warn('[learning-core] Replay ilegivel ignorado na listagem', { file: name, error: error.message });
        continue;
      }

      if (normalizeTenantId(replay?.tenantId) !== scoped) continue;

      const id = replay.id || name.replace(/\.json$/, '');
      if (!byId.has(id)) byId.set(id, summarizeReplay(replay, name.replace(/\.json$/, '')));
    }
  }

  return [...byId.values()].sort((a, b) => String(b.startTime).localeCompare(String(a.startTime)));
}

module.exports = {
  REPLAY_ID_PATTERN,
  readTenantScopedReplay,
  listTenantScopedReplays,
  tenantSegment,
  replayBaseDir,
};
