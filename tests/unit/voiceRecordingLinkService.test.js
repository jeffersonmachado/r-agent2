'use strict';

/**
 * Voice + Digital — link gravação ↔ mensagem de chamada + transcrição
 * (voiceRecordingLinkService). Models/policy/transcrição mockados;
 * fs real com arquivo .wav temporário (o serviço lê o áudio do disco).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const transcribeAudio = jest.fn();
const getRecordingPolicy = jest.fn();
const processCallInsight = jest.fn();
const emitEvent = jest.fn();

function buildMessageModel(store) {
  return {
    findOne: jest.fn(async ({ where } = {}) => {
      const found = store.find((item) =>
        (!where?.tenant_key || item.tenant_key === where.tenant_key) &&
        (!where?.external_message_id || item.external_message_id === where.external_message_id));
      if (!found) return null;
      return Object.assign(found, {
        update: jest.fn(async (patch) => {
          Object.assign(found, patch);
          return found;
        }),
      });
    }),
  };
}

function buildRecordingModel(store) {
  return {
    findOne: jest.fn(async ({ where } = {}) =>
      store.find((item) =>
        (!where?.tenantKey || item.tenantKey === where.tenantKey) &&
        (!where?.uniqueid || item.uniqueid === where.uniqueid)) || null),
  };
}

function loadService({ messages = [], recordings = [] } = {}) {
  jest.resetModules();
  transcribeAudio.mockClear();
  getRecordingPolicy.mockClear();
  processCallInsight.mockClear();
  processCallInsight.mockResolvedValue({ processed: false });
  emitEvent.mockClear();
  jest.doMock('../../api/db/models', () => ({
    ChannelMessage: () => buildMessageModel(messages),
    PbxRecording: () => buildRecordingModel(recordings),
  }));
  jest.doMock('../../api/services/pbx/pbxRecordingPolicyService', () => ({
    getRecordingPolicy,
  }));
  jest.doMock('../../api/services/audioTranscriptionService', () => ({
    transcribeAudio,
  }));
  jest.doMock('../../api/services/voice/callInsightBridgeService', () => ({
    processCallInsight,
  }));
  jest.doMock('../../api/services/websocketService', () => ({
    emitEvent,
  }));
  // eslint-disable-next-line global-require
  const service = require('../../api/services/pbx/voiceRecordingLinkService');
  return { service, messages, recordings };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function makeWav() {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rap-rec-')), 'system__1700000000.1.wav');
  fs.writeFileSync(filePath, Buffer.from('RIFF fake wav'));
  return filePath;
}

const baseMessage = {
  id: 'cmsg-1',
  tenant_key: 'system',
  external_message_id: 'pbx-call:system:1700000000.1',
  type: 'call',
  body: {
    type: 'call',
    text: '📞 Chamada recebida de 5511999887766 — 1 min 5 s',
    call: { uniqueid: '1700000000.1', direction: 'in', answered: true, phone: '5511999887766' },
  },
};

describe('voiceRecordingLinkService.linkRecordingToCallMessage', () => {
  test('gravação + policy enabled: anexa recordingId e transcrição à mensagem', async () => {
    const wav = makeWav();
    const messages = [{ ...baseMessage, body: JSON.parse(JSON.stringify(baseMessage.body)) }];
    const recordings = [{ id: 'rec-system-1700000000.1', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: wav } }];
    getRecordingPolicy.mockResolvedValue({ ok: true, policy: { enabled: true } });
    transcribeAudio.mockResolvedValue({ text: 'Olá, gostaria de confirmar meu horário.', language: 'pt', provider: 'whisper' });

    const { service } = loadService({ messages, recordings });
    const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });

    expect(out).toMatchObject({ linked: true, recordingId: 'rec-system-1700000000.1', transcribed: true });
    expect(messages[0].body.call.recordingId).toBe('rec-system-1700000000.1');
    expect(messages[0].body.transcription).toMatchObject({
      text: 'Olá, gostaria de confirmar meu horário.',
      language: 'pt',
      provider: 'whisper',
    });
    expect(transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'whisper',
      tenantId: 'system',
      audioData: expect.any(Buffer),
    }));
  });

  test('policy disabled: anexa recordingId mas NÃO transcreve', async () => {
    const wav = makeWav();
    const messages = [{ ...baseMessage, body: JSON.parse(JSON.stringify(baseMessage.body)) }];
    const recordings = [{ id: 'rec-1', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: wav } }];
    getRecordingPolicy.mockResolvedValue({ ok: true, policy: { enabled: false } });

    const { service } = loadService({ messages, recordings });
    const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });

    expect(out).toMatchObject({ linked: true, recordingId: 'rec-1', transcribed: false });
    expect(messages[0].body.call.recordingId).toBe('rec-1');
    expect(messages[0].body.transcription).toBeUndefined();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test('falha da transcrição (sem API key do tenant) é fail-soft: recordingId permanece', async () => {
    const wav = makeWav();
    const messages = [{ ...baseMessage, body: JSON.parse(JSON.stringify(baseMessage.body)) }];
    const recordings = [{ id: 'rec-2', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: wav } }];
    getRecordingPolicy.mockResolvedValue({ ok: true, policy: { enabled: true } });
    transcribeAudio.mockResolvedValue({ text: '[Erro ao transcrever áudio: OpenAI API key não configurada]', error: 'no_api_key' });

    const { service } = loadService({ messages, recordings });
    const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });

    expect(out).toMatchObject({ linked: true, recordingId: 'rec-2', transcribed: false });
    expect(messages[0].body.call.recordingId).toBe('rec-2');
    expect(messages[0].body.transcription).toBeUndefined();
  });

  test('idempotente: já linkado e transcrito não refaz trabalho', async () => {
    const messages = [{
      ...baseMessage,
      body: {
        ...JSON.parse(JSON.stringify(baseMessage.body)),
        call: { ...baseMessage.body.call, recordingId: 'rec-3' },
        transcription: { text: 'já transcrito', language: 'pt', provider: 'whisper' },
      },
    }];
    const recordings = [{ id: 'rec-3', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: makeWav() } }];

    const { service } = loadService({ messages, recordings });
    const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });

    expect(out).toMatchObject({ linked: true, skipped: true });
    expect(getRecordingPolicy).not.toHaveBeenCalled();
    expect(transcribeAudio).not.toHaveBeenCalled();
  });

  test('timeout da transcrição (rede lenta/provider travado) é fail-soft', async () => {
    const wav = makeWav();
    const messages = [{ ...baseMessage, body: JSON.parse(JSON.stringify(baseMessage.body)) }];
    const recordings = [{ id: 'rec-timeout', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: wav } }];
    getRecordingPolicy.mockResolvedValue({ ok: true, policy: { enabled: true } });
    // Provider nunca resolve (rede travada): o scan não pode ficar refém.
    transcribeAudio.mockImplementation(() => new Promise(() => {}));
    process.env.VOICE_TRANSCRIPTION_TIMEOUT_MS = '1000';

    try {
      const { service } = loadService({ messages, recordings });
      const started = Date.now();
      const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });

      expect(Date.now() - started).toBeLessThan(8000);
      expect(out).toMatchObject({ linked: true, recordingId: 'rec-timeout', transcribed: false });
      expect(messages[0].body.call.recordingId).toBe('rec-timeout');
      expect(messages[0].body.transcription).toBeUndefined();
    } finally {
      delete process.env.VOICE_TRANSCRIPTION_TIMEOUT_MS;
    }
  });

  test('sem mensagem de chamada → message_not_found', async () => {
    const { service } = loadService({ messages: [], recordings: [] });
    const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });
    expect(out).toEqual({ linked: false, reason: 'message_not_found' });
  });

  test('P5.15: transcrição nova dispara processCallInsight (Voice → Intent → NBA) e emite conversation.updated', async () => {
    const wav = makeWav();
    const messages = [{ ...baseMessage, conversation_id: 'conv-voice-1', body: JSON.parse(JSON.stringify(baseMessage.body)) }];
    const recordings = [{ id: 'rec-insight', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: wav } }];
    getRecordingPolicy.mockResolvedValue({ ok: true, policy: { enabled: true } });
    transcribeAudio.mockResolvedValue({ text: 'quero remarcar para sexta', language: 'pt', provider: 'whisper' });

    const { service } = loadService({ messages, recordings });
    // loadService rearma o default ({processed:false}); override depois dele.
    processCallInsight.mockResolvedValue({ processed: true, insight: { intent: 'reagendar' }, insightPersisted: true });
    await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });
    await flushMicrotasks();

    expect(processCallInsight).toHaveBeenCalledWith({
      tenantId: 'system',
      message: expect.objectContaining({ conversation_id: 'conv-voice-1' }),
    });
    expect(emitEvent).toHaveBeenCalledWith('conversation.updated', expect.objectContaining({
      conversationId: 'conv-voice-1',
      transcriptInsight: true,
    }));
  });

  test('P5.15: transcrição já existente NÃO dispara o insight (idempotente)', async () => {
    const messages = [{
      ...baseMessage,
      body: {
        ...JSON.parse(JSON.stringify(baseMessage.body)),
        call: { ...baseMessage.body.call },
        transcription: { text: 'já transcrito', language: 'pt', provider: 'whisper' },
      },
    }];
    const recordings = [{ id: 'rec-9', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: makeWav() } }];

    const { service } = loadService({ messages, recordings });
    await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });
    await flushMicrotasks();

    expect(processCallInsight).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  test('P5.15: falha do insight não derruba o link (fire-and-forget fail-soft)', async () => {
    const wav = makeWav();
    const messages = [{ ...baseMessage, body: JSON.parse(JSON.stringify(baseMessage.body)) }];
    const recordings = [{ id: 'rec-err', tenantKey: 'system', uniqueid: '1700000000.1', storage: { path: wav } }];
    getRecordingPolicy.mockResolvedValue({ ok: true, policy: { enabled: true } });
    transcribeAudio.mockResolvedValue({ text: 'texto da chamada', language: 'pt', provider: 'whisper' });
    processCallInsight.mockRejectedValue(new Error('db down'));

    const { service } = loadService({ messages, recordings });
    const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });
    await flushMicrotasks();

    expect(out).toMatchObject({ linked: true, transcribed: true });
    expect(emitEvent).not.toHaveBeenCalled();
  });

  test('sem gravação → recording_not_found', async () => {
    const messages = [{ ...baseMessage }];
    const { service } = loadService({ messages, recordings: [] });
    const out = await service.linkRecordingToCallMessage({ tenantId: 'system', uniqueid: '1700000000.1' });
    expect(out).toEqual({ linked: false, reason: 'recording_not_found' });
  });
});
