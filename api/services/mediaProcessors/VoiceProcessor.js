'use strict';

const { MediaProcessor } = require('./MediaProcessor');
const { createNormalizedInboundEvent } = require('../../contracts/normalizedInboundEvent');
const { transcribeEventAudio } = require('../voiceAdapters/asrAdapter');

class VoiceProcessor extends MediaProcessor {
  async process(event) {
    const base = createNormalizedInboundEvent(event);
    const asr = await transcribeEventAudio(base);
    const payloadObj = base.payload && typeof base.payload === 'object'
      ? base.payload
      : {};
    const asrText = asr && typeof asr.text === 'string' ? asr.text : '';

    return {
      ...base,
      media: base.media || 'audio',
      payload: {
        ...payloadObj,
        text: asrText || payloadObj.text || '',
        asr_text: asrText || null,
      },
      voice_metadata: {
        asr_text: asrText || null,
        tts_text: null,
        partials: Array.isArray(payloadObj.partials) ? payloadObj.partials : [],
        barge_in: false,
        asr_provider: asr && asr.provider ? asr.provider : null,
        asr_language: asr && asr.language ? asr.language : null,
        asr_error: asr && asr.error ? asr.error : null,
        ...(base.voice_metadata || {}),
      },
      metadata: {
        ...(base.metadata || {}),
        voice_stub: true,
        asr_processed: true,
      },
      // TODO(phase-2): plugar NLU de streaming para atualizar partials em tempo real
      // TODO(phase-2): suportar partial transcripts e barge-in em tempo real
    };
  }
}

module.exports = {
  VoiceProcessor,
};
