'use strict';

/**
 * Regressão: POST /audio/transcribe não pode mascarar falha como 200 nem
 * aceitar tenantId do body.
 *
 * Falhas observadas (sondagem 2026-07-27):
 * 1. Erros do provider de transcrição voltavam HTTP 200 com texto
 *    "[Erro ao transcrever áudio: ...]" — falha indistinguível de sucesso.
 * 2. O tenantId era lido apenas do body, ignorando o contexto autenticado
 *    (req.tenantId) — cliente podia atribuir uso de IA a outro tenant.
 */

const {
  handleAudioTranscriptionRoutes,
} = require('../../api/modules/platform-content/handleAudioTranscriptionRoutes');

function makeReq(body, tenantId) {
  const stream = require('stream');
  const payload = JSON.stringify(body || {});
  const req = new stream.Readable({
    read() {
      this.push(payload);
      this.push(null);
    },
  });
  req.headers = { 'content-type': 'application/json' };
  req.method = 'POST';
  req.url = '/audio/transcribe';
  req.originalUrl = '/audio/transcribe';
  if (tenantId) req.tenantId = tenantId;
  return req;
}

function baseDeps(overrides) {
  return {
    requireAuth: () => ({ valid: true, agent: { id: 'qa-agent' } }),
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.body = payload;
      res.writableEnded = true;
    },
    badRequest: (res, message) => {
      res.statusCode = 400;
      res.body = { error: 'bad_request', message };
      res.writableEnded = true;
    },
    hasJsonContentType: () => true,
    parseJsonBody: async (req) => {
      let data = '';
      for await (const chunk of req) data += chunk;
      return JSON.parse(data || '{}');
    },
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...overrides,
  };
}

describe('POST /audio/transcribe — contrato de erro e tenant', () => {
  test('falha do provider retorna 502 transcription_failed (não 200)', async () => {
    const deps = baseDeps({
      transcribeAudio: async () => ({
        text: '[Erro ao transcrever áudio: provider indisponível]',
        error: 'provider indisponível',
        provider: 'whisper',
      }),
    });
    const res = {};
    await handleAudioTranscriptionRoutes({
      req: makeReq({ audioData: Buffer.from('fake').toString('base64') }),
      res,
      method: 'POST',
      pathname: '/audio/transcribe',
      deps,
    });
    expect(res.statusCode).toBe(502);
    expect(res.body).toHaveProperty('error', 'transcription_failed');
  });

  test('sucesso retorna 200 com texto transcrito', async () => {
    const deps = baseDeps({
      transcribeAudio: async () => ({ text: 'olá mundo', provider: 'whisper' }),
    });
    const res = {};
    await handleAudioTranscriptionRoutes({
      req: makeReq({ audioData: Buffer.from('fake').toString('base64') }),
      res,
      method: 'POST',
      pathname: '/audio/transcribe',
      deps,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('text', 'olá mundo');
  });

  test('tenantId do contexto autenticado prevalece sobre o do body', async () => {
    let receivedTenant;
    const deps = baseDeps({
      transcribeAudio: async ({ tenantId }) => {
        receivedTenant = tenantId;
        return { text: 'ok', provider: 'whisper' };
      },
    });
    const res = {};
    await handleAudioTranscriptionRoutes({
      req: makeReq({ audioData: Buffer.from('fake').toString('base64'), tenantId: 'tenant-injetado' }, 'system'),
      res,
      method: 'POST',
      pathname: '/audio/transcribe',
      deps,
    });
    expect(res.statusCode).toBe(200);
    expect(receivedTenant).toBe('system');
  });
});
