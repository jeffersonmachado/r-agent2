'use strict';

/**
 * @interface MediaProcessor
 * process(event: NormalizedInboundEvent) => Promise<NormalizedInboundEvent>
 */
class MediaProcessor {
  async process(_event) {
    throw new Error('MediaProcessor.process must be implemented');
  }
}

module.exports = {
  MediaProcessor,
};
