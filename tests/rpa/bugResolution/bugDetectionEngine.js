const crypto = require('crypto');
const {
  classifyBug,
  determineFailureOwnership,
} = require('./bugClassification');

class BugDetectionEngine {
  buildFingerprint(input = {}) {
    const stablePayload = {
      actionType: input.action?.type || null,
      selector: input.action?.selector || null,
      url: input.action?.url || null,
      bugType: input.classification?.type || null,
      owner: input.owner || null,
      message: String(input.errorMessage || '').slice(0, 300),
      pageStateHash: input.pageStateHash || null,
    };

    return crypto
      .createHash('sha1')
      .update(JSON.stringify(stablePayload))
      .digest('hex');
  }

  detect(input = {}) {
    const classification = classifyBug({
      error: input.error,
      action: input.action,
      status: input.status,
      statusCode: input.statusCode,
      detectedError: input.detectedError,
    });

    const owner = determineFailureOwnership(classification);
    const errorMessage =
      (typeof input.error === 'string' && input.error) ||
      input.error?.message ||
      input.detectedError?.message ||
      'Unknown error';

    const fingerprint = this.buildFingerprint({
      action: input.action,
      classification,
      owner,
      errorMessage,
      pageStateHash: input.pageStateHash,
    });

    return {
      errorMessage,
      classification,
      owner,
      fingerprint,
      detectedAt: new Date().toISOString(),
    };
  }
}

module.exports = {
  BugDetectionEngine,
};
