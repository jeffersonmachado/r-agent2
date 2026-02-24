'use strict';

const { MediaProcessor } = require('./MediaProcessor');
const { createNormalizedInboundEvent } = require('../../contracts/normalizedInboundEvent');

class VoiceProcessor extends MediaProcessor {
  async process(event) {
    const base = createNormalizedInboundEvent(event);
    return {
      ...base,
      media: base.media || 'audio',
      voice_metadata: {
        asr_text: null,
        tts_text: null,
        partials: [],
        barge_in: false,
        ...(base.voice_metadata || {}),
      },
      metadata: {
        ...(base.metadata || {}),
        voice_stub: true,
      },
      // TODO(phase-2): integrar ASR provider e preencher voice_metadata.asr_text
      // TODO(phase-2): integrar TTS provider usando voice_metadata.tts_text
      // TODO(phase-2): suportar partial transcripts e barge-in em tempo real
    };
  }
}

module.exports = {
  VoiceProcessor,
};
