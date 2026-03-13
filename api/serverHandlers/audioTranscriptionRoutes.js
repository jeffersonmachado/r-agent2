module.exports = { handleAudioTranscriptionRoutes };

async function handleAudioTranscriptionRoutes({ req, res, method, pathname, deps }) {
  const {
    requireAuth,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    transcribeAudio,
  } = deps;

  if (method === 'POST' && pathname === '/audio/transcribe') {
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
      const { audioUrl, audioData, provider, tenantId } = body || {};

      if (!audioUrl && !audioData) {
        badRequest(res, 'Campo "audioUrl" ou "audioData" é obrigatório');
        return true;
      }

      const audioInput = audioUrl || (audioData ? Buffer.from(audioData, 'base64') : null);
      const result = await transcribeAudio({
        audioData: audioInput,
        provider: provider || 'whisper',
        tenantId,
      });

      sendJson(res, 200, result);
    } catch (err) {
      logger.error('Erro ao transcrever áudio:', err);
      sendJson(res, 500, {
        error: 'internal_error',
        message: err.message || 'Erro ao transcrever áudio',
      });
    }
    return true;
  }

  return false;
}