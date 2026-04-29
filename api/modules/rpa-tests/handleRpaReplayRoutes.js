const {
  ensureAuthenticated,
  getPathSuffix,
  isSafeJsonFilename,
} = require('./rpaRouteUtils');
const {
  getRpaReportReadDirs,
  getRpaReplayReadDirs,
} = require('../../../lib/rpaPathResolver');

const DEFAULT_REPLAY_LIST_LIMIT = 50;
const MAX_REPLAY_LIST_LIMIT = 500;
const REPLAY_SUMMARY_PREVIEW_BYTES = 16 * 1024;

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function extractReplaySummary(content) {
  const summary = {};

  const fieldPatterns = {
    id: /"id"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    recordingId: /"recordingId"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    startTime: /"startTime"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    endTime: /"endTime"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    mode: /"mode"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
    result: /"result"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
  };

  for (const [field, regex] of Object.entries(fieldPatterns)) {
    const match = content.match(regex);
    if (match?.[1]) {
      try {
        summary[field] = JSON.parse(`"${match[1]}"`);
      } catch {
        summary[field] = match[1];
      }
    }
  }

  if (summary.startTime && summary.endTime) {
    const start = new Date(summary.startTime);
    const end = new Date(summary.endTime);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
      summary.duration = end.getTime() - start.getTime();
    }
  }

  return summary;
}

function readReplayPreview(fs, filePath, maxBytes = REPLAY_SUMMARY_PREVIEW_BYTES) {
  const fd = fs.openSync(filePath, 'r');

  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function buildReplayDetails(fs, path, replayDir, file, stats, logger) {
  const details = {
    filename: file,
    size: stats.size,
    modified: stats.mtime.toISOString(),
    created: stats.birthtime.toISOString(),
  };

  try {
    const filePath = path.join(replayDir, file);
    const content = readReplayPreview(fs, filePath);
    Object.assign(details, extractReplaySummary(content));
  } catch (parseError) {
    logger.debug(`Não foi possível extrair detalhes do replay ${file}:`, parseError.message);
  }

  return details;
}

function matchesReplayFilters(replay, filters) {
  const { search, result, dateRange } = filters;

  if (search) {
    const haystacks = [replay.filename, replay.id, replay.recordingId]
      .map(normalizeText);
    if (!haystacks.some((value) => value.includes(search))) {
      return false;
    }
  }

  if (result === 'success' && replay.result !== 'success') {
    return false;
  }

  if (result === 'failed' && (replay.result === 'success' || replay.result === undefined)) {
    return false;
  }

  if (dateRange && dateRange !== 'all') {
    const replayDate = new Date(replay.modified || replay.startTime || 0);
    if (Number.isNaN(replayDate.getTime())) {
      return false;
    }

    const cutoffDate = new Date();
    if (dateRange === 'today') {
      cutoffDate.setHours(0, 0, 0, 0);
    } else if (dateRange === 'week') {
      cutoffDate.setDate(cutoffDate.getDate() - 7);
    } else if (dateRange === 'month') {
      cutoffDate.setDate(cutoffDate.getDate() - 30);
    }

    if (replayDate < cutoffDate) {
      return false;
    }
  }

  return true;
}

function sortReplayList(replays, sortBy, sortOrder) {
  const direction = sortOrder === 'asc' ? 1 : -1;

  return replays.sort((a, b) => {
    let compareA;
    let compareB;

    switch (sortBy) {
      case 'name':
        compareA = normalizeText(a.filename);
        compareB = normalizeText(b.filename);
        return direction * compareA.localeCompare(compareB);
      case 'size':
        compareA = a.size || 0;
        compareB = b.size || 0;
        return direction * (compareA - compareB);
      case 'duration':
        compareA = a.duration || 0;
        compareB = b.duration || 0;
        return direction * (compareA - compareB);
      case 'date':
      default:
        compareA = new Date(a.modified || a.startTime || 0).getTime();
        compareB = new Date(b.modified || b.startTime || 0).getTime();
        return direction * (compareA - compareB);
    }
  });
}

function removeReplayFiles(fs, path, targetDir) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  const deleted = [];
  for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    fs.unlinkSync(path.join(targetDir, entry.name));
    deleted.push(entry.name);
  }
  return deleted;
}

function findFirstExistingFile(fs, path, directories, filename) {
  for (const dirPath of directories) {
    const candidate = path.join(dirPath, filename);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function handleRpaReplayRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    sendJson,
    logger,
    path,
    fs,
  } = deps;


  if (method === 'GET' && pathname.startsWith('/tests/rpa/reports/')) {
    if (!ensureAuthenticated(req, res, requireAuth, sendJson)) return true;

    try {
      const filename = getPathSuffix(pathname, '/tests/rpa/reports/');
      if (!isSafeJsonFilename(filename)) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return true;
      }

      const reportPath = findFirstExistingFile(fs, path, getRpaReportReadDirs(), filename);
      if (!fs.existsSync(reportPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Relatório não encontrado' });
        return true;
      }

      const reportContent = fs.readFileSync(reportPath, 'utf8');
      const reportData = JSON.parse(reportContent);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(reportData));
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Erro ao fazer parse do relatório JSON:', error);
        sendJson(res, 500, { error: 'invalid_json', message: 'Relatório contém JSON inválido' });
      } else {
        logger.error('Erro ao servir relatório RPA:', error);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao servir relatório' });
      }
    }
    return true;
  }

  if (method === 'GET' && pathname === '/tests/rpa/replay') {
    if (!ensureAuthenticated(req, res, requireAuth, sendJson)) return true;

    try {
      const replayDirs = getRpaReplayReadDirs().filter((dirPath) => fs.existsSync(dirPath));
      if (replayDirs.length === 0) {
        sendJson(res, 200, { files: [] });
        return true;
      }

      const searchParams = new URL(req.url, 'http://localhost').searchParams;
      const limit = Math.min(
        parsePositiveInt(searchParams.get('limit'), DEFAULT_REPLAY_LIST_LIMIT),
        MAX_REPLAY_LIST_LIMIT
      );
      const offset = Math.max(parsePositiveInt(searchParams.get('offset'), 0), 0);
      const filters = {
        search: normalizeText(searchParams.get('search')).trim(),
        result: searchParams.get('result') || 'all',
        dateRange: searchParams.get('dateRange') || 'all',
      };
      const sortBy = searchParams.get('sortBy') || 'date';
      const sortOrder = searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc';

      const uniqueEntries = new Map();
      for (const replayDir of replayDirs) {
        const entries = fs.readdirSync(replayDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
          if (uniqueEntries.has(entry.name)) continue;
          const filePath = path.join(replayDir, entry.name);
          const stats = fs.statSync(filePath);
          uniqueEntries.set(entry.name, buildReplayDetails(fs, path, replayDir, entry.name, stats, logger));
        }
      }

      const filteredEntries = Array.from(uniqueEntries.values())
        .filter((replay) => matchesReplayFilters(replay, filters));

      const sortedEntries = sortReplayList(filteredEntries, sortBy, sortOrder);
      const total = sortedEntries.length;
      const files = sortedEntries.slice(offset, offset + limit);

      sendJson(res, 200, {
        files,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + files.length < total,
        },
        filters: {
          ...filters,
          sortBy,
          sortOrder,
        },
      });
    } catch (error) {
      logger.error('Erro ao listar replays RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar replays' });
    }
    return true;
  }

  if (method === 'GET' && pathname.startsWith('/tests/rpa/replay/')) {
    if (!ensureAuthenticated(req, res, requireAuth, sendJson)) return true;

    try {
      const filename = getPathSuffix(pathname, '/tests/rpa/replay/');
      if (!isSafeJsonFilename(filename)) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return true;
      }

      const replayPath = findFirstExistingFile(fs, path, getRpaReplayReadDirs(), filename);
      if (!replayPath || !fs.existsSync(replayPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Log/Replay não encontrado' });
        return true;
      }

      const replayContent = fs.readFileSync(replayPath, 'utf8');
      const replayData = JSON.parse(replayContent);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
      res.end(JSON.stringify(replayData));
    } catch (error) {
      if (error instanceof SyntaxError) {
        logger.error('Erro ao fazer parse do log/replay JSON:', error);
        sendJson(res, 500, { error: 'invalid_json', message: 'Log/Replay contém JSON inválido' });
      } else {
        logger.error('Erro ao servir log/replay RPA:', error);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro ao servir log/replay' });
      }
    }
    return true;
  }

  if (method === 'DELETE' && pathname.startsWith('/tests/rpa/replay/')) {
    if (!ensureAuthenticated(req, res, requireAuth, sendJson)) return true;

    try {
      const filename = getPathSuffix(pathname, '/tests/rpa/replay/');
      if (!isSafeJsonFilename(filename)) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return true;
      }

      const replayPath = findFirstExistingFile(fs, path, getRpaReplayReadDirs(), filename);
      if (!replayPath || !fs.existsSync(replayPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Replay não encontrado' });
        return true;
      }

      fs.unlinkSync(replayPath);
      logger.info(`Replay removido: ${filename}`);

      sendJson(res, 200, {
        success: true,
        deletedFilename: filename,
        message: `Replay "${filename}" removido com sucesso`,
      });
    } catch (error) {
      logger.error('Erro ao remover replay RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao remover replay' });
    }
    return true;
  }

  if (method === 'DELETE' && pathname === '/tests/rpa/replay') {
    if (!ensureAuthenticated(req, res, requireAuth, sendJson)) return true;

    try {
      const replayDirs = getRpaReplayReadDirs();
      let deletedRoot = [];
      let deletedSystem = [];
      for (const replayDir of replayDirs) {
        deletedRoot = deletedRoot.concat(removeReplayFiles(fs, path, replayDir));
        deletedSystem = deletedSystem.concat(removeReplayFiles(fs, path, path.join(replayDir, 'system')));
      }

      sendJson(res, 200, {
        success: true,
        deletedCount: deletedRoot.length + deletedSystem.length,
        deletedRootCount: deletedRoot.length,
        deletedSystemCount: deletedSystem.length,
        message: 'Replays removidos com sucesso',
      });
    } catch (error) {
      logger.error('Erro ao remover todos os replays RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao remover todos os replays' });
    }
    return true;
  }

  return false;
}

module.exports = { handleRpaReplayRoutes };
