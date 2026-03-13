// RPA Tests Routes - Testes automatizados e gravações RPA

async function handleRpaTestsRoutes({
  req, res, method, pathname,
  deps: {
    requireAuth, sendJson, badRequest, hasJsonContentType, parseJsonBody, logger,
    listRecordings, executeRecording, getExecutionStatus, cancelExecution, continueExecution,
    nextStep, deleteRecording, startManualRecording, stopManualRecording, getRecordingStatus,
    path, fs,
  }
}) {
  // GET /rpa/recordings - Lista gravações disponíveis
  if (method === 'GET' && pathname === '/rpa/recordings') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const recordings = listRecordings();
      sendJson(res, 200, { recordings });
    } catch (error) {
      logger.error('Erro ao listar gravações RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar gravações RPA' });
    }
    return true;
  }

  // DELETE /rpa/recordings/:id - Remove uma gravação
  if (method === 'DELETE' && pathname.startsWith('/rpa/recordings/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      let recordingId = decodeURIComponent(pathname.slice('/rpa/recordings/'.length));
      // Remove .json se presente
      if (recordingId.endsWith('.json')) {
        recordingId = recordingId.slice(0, -'.json'.length);
      }
      
      if (!recordingId || recordingId.trim() === '') {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const result = deleteRecording(recordingId);

      if (!result.success) {
        if (result.message.includes('não encontrada')) {
          sendJson(res, 404, {
            error: 'not_found',
            message: result.message,
          });
        } else {
          sendJson(res, 500, {
            error: 'internal_error',
            message: result.message,
          });
        }
        return true;
      }

      logger.debug(`Gravação removida: ${recordingId}`);

      sendJson(res, 200, {
        success: true,
        deletedId: result.deletedId,
        message: result.message,
      });
    } catch (err) {
      logger.error('Erro ao remover gravação', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: 'Erro interno ao remover gravação',
      });
    }
    return true;
  }

  // POST /rpa/execute/:recordingId - Executa uma gravação
  if (method === 'POST' && pathname.startsWith('/rpa/execute/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const recordingId = pathname.split('/rpa/execute/')[1];
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const body = await parseJsonBody(req);
      const config = body.config || {};
      const data = body.data || {};
      
      // Passa o token de autenticação para o overlay
      const token = req.token || null;

      const result = await executeRecording(recordingId, config, data, token);
      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao executar RPA:', error);
      sendJson(res, 500, { 
        error: 'internal_error', 
        message: error.message || 'Erro ao executar RPA' 
      });
    }
    return true;
  }

  // GET /rpa/execution/:executionId - Obtém status de execução
  if (method === 'GET' && pathname.startsWith('/rpa/execution/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const executionId = pathname.split('/rpa/execution/')[1];
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const status = getExecutionStatus(executionId);
      if (!status) {
        sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return true;
      }

      sendJson(res, 200, status);
    } catch (error) {
      logger.error('Erro ao obter status da execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter status' });
    }
    return true;
  }

  // POST /rpa/execution/:executionId/cancel - Cancela execução
  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/cancel')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const result = await cancelExecution(executionId);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Execução cancelada' });
    } catch (error) {
      logger.error('Erro ao cancelar execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao cancelar execução' });
    }
    return true;
  }

  // POST /rpa/execution/:executionId/continue - Continua execução pausada sem pausas
  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/continue')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      // Continua sem pausas (desativa step-by-step)
      const result = continueExecution(executionId, true);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Execução continuada sem pausas' });
    } catch (error) {
      logger.error('Erro ao continuar execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao continuar execução' });
    }
    return true;
  }

  // POST /rpa/record/start - Inicia gravação manual
  if (method === 'POST' && pathname === '/rpa/record/start') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const seedName = body.seedName || body.name;
      const initialUrl = body.initialUrl || body.url;

      if (!seedName || seedName.trim() === '') {
        badRequest(res, 'Nome do seed (seedName) é obrigatório');
        return true;
      }

      const result = await startManualRecording(seedName, initialUrl);
      
      if (!result.success) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao iniciar gravação manual', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao iniciar gravação manual',
      });
    }
    return true;
  }

  // POST /rpa/record/stop/:recordingId - Para gravação manual
  if (method === 'POST' && pathname.startsWith('/rpa/record/stop/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const recordingId = pathname.split('/rpa/record/stop/')[1];
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const result = await stopManualRecording(recordingId);
      
      if (!result.success) {
        sendJson(res, 400, result);
        return true;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao parar gravação manual', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao parar gravação manual',
      });
    }
    return true;
  }

  // GET /rpa/record/status/:recordingId - Obtém status da gravação manual
  if (method === 'GET' && pathname.startsWith('/rpa/record/status/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const recordingId = pathname.split('/rpa/record/status/')[1];
      if (!recordingId) {
        badRequest(res, 'ID da gravação é obrigatório');
        return true;
      }

      const result = getRecordingStatus(recordingId);
      
      if (!result.success) {
        sendJson(res, 404, result);
        return true;
      }

      sendJson(res, 200, result);
    } catch (error) {
      logger.error('Erro ao obter status da gravação', error);
      sendJson(res, 500, {
        error: 'internal_error',
        message: error.message || 'Erro ao obter status da gravação',
      });
    }
    return true;
  }

  // POST /rpa/execution/:executionId/next - Executa apenas o próximo step
  if (method === 'POST' && pathname.includes('/rpa/execution/') && pathname.endsWith('/next')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const result = nextStep(executionId);
      if (!result.success) {
        sendJson(res, 400, { error: 'validation_error', message: result.error });
        return true;
      }

      sendJson(res, 200, { success: true, message: 'Próximo step executado' });
    } catch (error) {
      logger.error('Erro ao executar próximo step RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao executar próximo step' });
    }
    return true;
  }

  // GET /rpa/execution/:executionId/report - Obtém relatório de execução
  if (method === 'GET' && pathname.includes('/rpa/execution/') && pathname.endsWith('/report')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const parts = pathname.split('/');
      const executionId = parts[parts.length - 2];
      
      if (!executionId) {
        badRequest(res, 'ID da execução é obrigatório');
        return true;
      }

      const status = getExecutionStatus(executionId);
      if (!status) {
        sendJson(res, 404, { error: 'not_found', message: 'Execução não encontrada' });
        return true;
      }

      // Retorna o relatório completo
      sendJson(res, 200, {
        executionId: status.id,
        recordingId: status.recordingId,
        status: status.status,
        startTime: status.startTime,
        endTime: status.endTime,
        results: status.results,
      });
    } catch (error) {
      logger.error('Erro ao obter relatório da execução RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao obter relatório' });
    }
    return true;
  }

  // GET /tests/rpa/reports/:filename - Serve arquivo de relatório RPA
  if (method === 'GET' && pathname.startsWith('/tests/rpa/reports/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const filename = pathname.slice('/tests/rpa/reports/'.length);
      
      // Validação de segurança: apenas arquivos JSON e sem path traversal
      if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.json')) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return true;
      }

      const reportPath = path.join(__dirname, '..', 'tests', 'rpa', 'reports', filename);
      
      // Verifica se o arquivo existe
      if (!fs.existsSync(reportPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Relatório não encontrado' });
        return true;
      }

      // Lê e retorna o arquivo JSON
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      const reportData = JSON.parse(reportContent);
      
      // Retorna com Content-Type correto
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

  // GET /tests/rpa/replay - Lista todos os arquivos de replay
  if (method === 'GET' && pathname === '/tests/rpa/replay') {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const replayDir = path.join(__dirname, '..', 'tests', 'rpa', 'replay');
      
      // Verifica se o diretório existe
      if (!fs.existsSync(replayDir)) {
        sendJson(res, 200, { files: [] });
        return true;
      }

      // Lista todos os arquivos JSON com detalhes adicionais
      const files = fs.readdirSync(replayDir)
        .filter(file => file.endsWith('.json'))
        .map(file => {
          const filePath = path.join(replayDir, file);
          const stats = fs.statSync(filePath);
          
          // Tenta ler o conteúdo do arquivo para extrair mais detalhes
          let details = {
            filename: file,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            created: stats.birthtime.toISOString(),
          };
          
          try {
            const content = fs.readFileSync(filePath, 'utf8');
            const replayData = JSON.parse(content);
            
            // Extrai informações relevantes do replay
            if (replayData.id) details.id = replayData.id;
            if (replayData.recordingId) details.recordingId = replayData.recordingId;
            if (replayData.startTime) details.startTime = replayData.startTime;
            if (replayData.endTime) details.endTime = replayData.endTime;
            if (replayData.mode) details.mode = replayData.mode;
            if (replayData.result) details.result = replayData.result;
            
            // Conta ações e telas
            if (Array.isArray(replayData.actions)) {
              details.actionCount = replayData.actions.length;
            }
            if (Array.isArray(replayData.screens)) {
              details.screenCount = replayData.screens.length;
            }
            if (Array.isArray(replayData.errors)) {
              details.errorCount = replayData.errors.length;
            }
            
            // Calcula duração se tiver startTime e endTime
            if (replayData.startTime && replayData.endTime) {
              const start = new Date(replayData.startTime);
              const end = new Date(replayData.endTime);
              details.duration = end - start; // em milissegundos
            }
          } catch (parseError) {
            // Se não conseguir fazer parse, mantém apenas os dados básicos
            logger.debug(`Não foi possível extrair detalhes do replay ${file}:`, parseError.message);
          }
          
          return details;
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified)); // Mais recentes primeiro

      sendJson(res, 200, { files });
    } catch (error) {
      logger.error('Erro ao listar replays RPA:', error);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro ao listar replays' });
    }
    return true;
  }

  // GET /tests/rpa/replay/:filename - Serve arquivo de log/replay RPA
  if (method === 'GET' && pathname.startsWith('/tests/rpa/replay/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const filename = pathname.slice('/tests/rpa/replay/'.length);
      
      // Validação de segurança: apenas arquivos JSON e sem path traversal
      if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.json')) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return true;
      }

      const replayPath = path.join(__dirname, '..', 'tests', 'rpa', 'replay', filename);
      
      // Verifica se o arquivo existe
      if (!fs.existsSync(replayPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Log/Replay não encontrado' });
        return true;
      }

      // Lê e retorna o arquivo JSON
      const replayContent = fs.readFileSync(replayPath, 'utf8');
      const replayData = JSON.parse(replayContent);
      
      // Retorna com Content-Type correto
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

  // DELETE /tests/rpa/replay/:filename - Remove arquivo de replay RPA
  if (method === 'DELETE' && pathname.startsWith('/tests/rpa/replay/')) {
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }

    try {
      const filename = pathname.slice('/tests/rpa/replay/'.length);
      
      // Validação de segurança: apenas arquivos JSON e sem path traversal
      if (!filename || filename.includes('..') || filename.includes('/') || !filename.endsWith('.json')) {
        sendJson(res, 400, { error: 'invalid_filename', message: 'Nome de arquivo inválido' });
        return true;
      }

      const replayPath = path.join(__dirname, '..', 'tests', 'rpa', 'replay', filename);
      
      // Verifica se o arquivo existe
      if (!fs.existsSync(replayPath)) {
        sendJson(res, 404, { error: 'not_found', message: 'Replay não encontrado' });
        return true;
      }

      // Remove o arquivo
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

module.exports = { handleRpaTestsRoutes };
