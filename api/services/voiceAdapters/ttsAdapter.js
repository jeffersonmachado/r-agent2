'use strict';

const logger = require('../../utils/logger');

async function getTenantOpenAiKey(tenantId) {
  if (!tenantId) return null;
  try {
    const { getDecryptedAPIKey } = require('../tenantAIService');
    return await getDecryptedAPIKey(String(tenantId), 'openai');
  } catch (_) {
    return null;
  }
}

function resolveProvider() {
  return String(process.env.VOICE_TTS_PROVIDER || 'none').trim().toLowerCase();
}

function shouldSynthesizeAudio(event) {
  const metadata = event && event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  if (String(process.env.VOICE_TTS_ENABLED || '').toLowerCase() === 'true') return true;
  return metadata.request_tts === true;
}

async function synthesizeText(event, text) {
  const provider = resolveProvider();
  const safeText = String(text || '').trim();
  if (!safeText) return { tts_text: null, provider, audio_base64: null, skipped: true, reason: 'empty_text' };

  if (!shouldSynthesizeAudio(event) || provider === 'none') {
    return {
      tts_text: safeText,
      provider,
      audio_base64: null,
      skipped: true,
      reason: 'tts_disabled',
    };
  }

  if (provider !== 'openai') {
    return {
      tts_text: safeText,
      provider,
      audio_base64: null,
      skipped: true,
      reason: 'provider_not_supported',
    };
  }

  try {
    const apiKey = await getTenantOpenAiKey(event && event.tenant_id ? event.tenant_id : null);
    if (!apiKey) {
      return {
        tts_text: safeText,
        provider,
        audio_base64: null,
        skipped: true,
        reason: 'tenant_api_key_missing',
      };
    }

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.VOICE_TTS_OPENAI_MODEL || 'gpt-4o-mini-tts',
        voice: process.env.VOICE_TTS_OPENAI_VOICE || 'alloy',
        input: safeText,
        format: 'mp3',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'tts_error');
      return {
        tts_text: safeText,
        provider,
        audio_base64: null,
        skipped: true,
        reason: 'tts_api_error',
        error: errorText,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return {
      tts_text: safeText,
      provider,
      audio_base64: base64,
      mime_type: 'audio/mpeg',
      skipped: false,
    };
  } catch (err) {
    logger.warn('[VoiceTTSAdapter] falha de síntese (best-effort)', {
      tenantId: event && event.tenant_id ? event.tenant_id : null,
      traceId: event && event.trace_id ? event.trace_id : null,
      provider,
      error: err && err.message ? err.message : String(err),
    });
    return {
      tts_text: safeText,
      provider,
      audio_base64: null,
      skipped: true,
      reason: 'tts_exception',
      error: err && err.message ? err.message : String(err),
    };
  }
}

module.exports = {
  synthesizeText,
};
