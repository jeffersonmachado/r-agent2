const {
  ensureAuthenticated,
  getPathSuffix,
  isSafeJsonFilename,
} = require('./rpaRouteUtils');

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

      const reportPath = path.join(__dirname, '..', 'tests', 'rpa', 'reports', filename);
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
      const replayDir = path.join(__dirname, '..', 'tests', 'rpa', 'replay');
      if (!fs.existsSync(replayDir)) {
        sendJson(res, 200, { files: [] });
        return true;
      }

      const files = fs.readdirSync(replayDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          const filePath = path.join(replayDir, file);
          const stats = fs.statSync(filePath);

          const details = {
            filename: file,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
          };

          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const replayData = JSON.parse(content);

            if (replayData.id) details.id = replayData.id;
            if (replayData.recordingId) details.recordingId = replayData.recordingId;
            if (replayData.startTime) details.startTime = replayData.startTime;
            if (replayData.endTime) details.endTime = replayData.endTime;
            if (replayData.mode) details.mode = replayData.mode;
            if (replayData.result) details.result = replayData.result;

            if (Array.isArray(replayData.actions)) {
              details.actionCount = replayData.actions.length;
            }
            if (Array.isArray(replayData.screens)) {
              details.screenCount = replayData.screens.length;
            }
            if (Array.isArray(replayData.errors)) {
              details.errorCount = replayData.errors.length;
            }
            if (replayData.startTime && replayData.endTime) {
              const start = new Date(replayData.startTime);
              const end = new Date(replayData.endTime);
              details.duration = end - start;
            }
          } catch (parseError) {
            logger.debug(`Não foi possível extrair detalhes do replay ${file}:`, parseError.message);
          }

          return details;
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));

      sendJson(res, 200, { files });
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

      const replayPath = path.join(__dirname, '..', 'tests', 'rpa', 'replay', filename);
      if (!fs.existsSync(replayPath)) {
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

      const replayPath = path.join(__dirname, '..', 'tests', 'rpa', 'replay', filename);
      if (!fs.existsSync(replayPath)) {
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

  return false;
}

module.exports = { handleRpaReplayRoutes };
