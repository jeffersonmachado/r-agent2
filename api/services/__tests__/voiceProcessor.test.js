'use strict';

jest.mock('../voiceAdapters/asrAdapter', () => ({
  transcribeEventAudio: jest.fn(),
}));

const { VoiceProcessor } = require('../mediaProcessors/VoiceProcessor');
const { transcribeEventAudio } = require('../voiceAdapters/asrAdapter');

describe('VoiceProcessor', () => {
  beforeEach(() => {
    transcribeEventAudio.mockImplementation(async () => ({
      text: 'texto transcrito',
      provider: 'whisper',
      language: 'pt',
      error: null,
    }));
  });

  test('enriquece evento com asr_text e metadados de voz', async () => {
    const processor = new VoiceProcessor();
    const out = await processor.process({
      event_type: 'message',
      channel: 'voice',
      media: 'audio',
      direction: 'inbound',
      tenant_id: 'tenant-voice',
      lead_id: 'lead-v1',
      session_id: 'session-v1',
      timestamp: new Date().toISOString(),
      payload: { audio_url: 'https://example.test/a.ogg' },
      metadata: {},
      voice_metadata: {},
      trace_id: 'trace-v1',
      correlation_id: 'corr-v1',
    });

    expect(out.media).toBe('audio');
    expect(out.payload.text).toBe('texto transcrito');
    expect(out.voice_metadata.asr_text).toBe('texto transcrito');
    expect(out.voice_metadata.asr_provider).toBe('whisper');
    expect(out.metadata.asr_processed).toBe(true);
  });
});
