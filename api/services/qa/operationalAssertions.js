'use strict';

class BlockingOperationalError extends Error {
  constructor(reason, metadata = {}) {
    super(reason);
    this.name = 'BlockingOperationalError';
    this.reason = reason;
    this.metadata = metadata;
  }
}

function assertOperationalCondition(condition, metadata = {}) {
  if (condition) return;
  const reason = metadata.reason || 'operational_assertion_failed';
  throw new BlockingOperationalError(reason, metadata);
}

function toBlockingError(error, metadata = {}) {
  if (error instanceof BlockingOperationalError) return error;
  return new BlockingOperationalError(metadata.reason || 'operational_assertion_failed', {
    ...metadata,
    originalError: error?.message || String(error),
  });
}

module.exports = {
  BlockingOperationalError,
  assertOperationalCondition,
  toBlockingError,
};
