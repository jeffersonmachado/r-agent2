'use strict';

const { TextProcessor } = require('./TextProcessor');
const { VoiceProcessor } = require('./VoiceProcessor');

const textProcessor = new TextProcessor();
const voiceProcessor = new VoiceProcessor();

function getMediaProcessor(media) {
  const normalized = String(media || '').toLowerCase();
  if (normalized === 'audio') return voiceProcessor;
  return textProcessor;
}

async function processMedia(event) {
  const processor = getMediaProcessor(event && event.media);
  return processor.process(event);
}

module.exports = {
  getMediaProcessor,
  processMedia,
  textProcessor,
  voiceProcessor,
};
