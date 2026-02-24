'use strict';

const { MediaProcessor } = require('./MediaProcessor');
const { createNormalizedInboundEvent } = require('../../contracts/normalizedInboundEvent');

class TextProcessor extends MediaProcessor {
  async process(event) {
    const base = createNormalizedInboundEvent(event);
    const payloadText = typeof base.payload === 'string'
      ? base.payload
      : (base.payload && typeof base.payload.text === 'string' ? base.payload.text : '');
    return {
      ...base,
      media: 'text',
      payload: {
        ...(base.payload && typeof base.payload === 'object' ? base.payload : {}),
        text: payloadText,
      },
      voice_metadata: base.voice_metadata || {},
    };
  }
}

module.exports = {
  TextProcessor,
};
