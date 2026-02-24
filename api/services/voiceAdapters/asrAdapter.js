'use strict';

const logger = require('../../utils/logger');
const { transcribeAudio } = require('../audioTranscriptionService');

function resolveProvider() {
  return String(process.env.VOICE_ASR_PROVIDER || 'whisper').trim().toLowerCase();
}

function resolveAudioSource(event) {
  const payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
  return payload.audio_url || payload.audio_data || payload.audio || null;
}

async function transcribeEventAudio(event) {
  const provider = resolveProvider();
  const voiceMetadata = event && event.voice_metadata && typeof event.voice_metadata === 'object'
    ? event.voice_metadata
    : {};

  const preTranscribed = voiceMetadata.asr_text
    || (event && event.payload && typeof event.payload === 'object' ? event.payload.asr_text : null)
    || (event && event.payload && typeof event.payload === 'object' ? event.payload.text : null);

  if (preTranscribed && String(preTranscribed).trim()) {
    return {
      text: String(preTranscribed).trim(),
      provider: 'pre_filled',
      language: voiceMetadata.language || 'pt',
    };
  }

  const audioData = resolveAudioSource(event);
  if (!audioData) {
    return {
      text: '',
      provider,
      skipped: true,
      reason: 'audio_source_missing',
    };
  }

  try {
    const result = await transcribeAudio({
      audioData,
      provider,
      tenantId: event && event.tenant_id ? String(event.tenant_id) : undefined,
    });
    return {
      text: result && result.text ? String(result.text) : '',
      provider: result && result.provider ? result.provider : provider,
      language: result && result.language ? result.language : 'pt',
      error: result && result.error ? result.error : null,
    };
  } catch (err) {
    logger.warn('[VoiceASRAdapter] falha de transcrição (best-effort)', {
      tenantId: event && event.tenant_id ? event.tenant_id : null,
      traceId: event && event.trace_id ? event.trace_id : null,
      provider,
      error: err && err.message ? err.message : String(err),
    });
    return {
      text: '',
      provider,
      error: err && err.message ? err.message : String(err),
    };
  }
}

module.exports = {
  transcribeEventAudio,
};
