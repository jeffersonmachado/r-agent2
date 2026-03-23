'use strict';

function incrementNodeAttempt(context, nodeId) {
  context.metadata = {
    ...(context.metadata || {}),
    nodeAttempts: {
      ...((context.metadata && context.metadata.nodeAttempts) || {}),
      [String(nodeId)]: Number(context.metadata?.nodeAttempts?.[String(nodeId)] || 0) + 1,
    },
  };
}

module.exports = {
  incrementNodeAttempt,
};