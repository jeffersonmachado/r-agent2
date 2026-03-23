'use strict';

function deriveWaitingState(node, context, result, input) {
  if (!result?.waiting) return null;
  const outputType = result?.output?.type || null;
  if (outputType === 'timer_wait') {
    return {
      type: 'timer',
      resumeAt: context.metadata?.waitingTimer?.resumeAt || null,
      correlationKey: input?.correlationKey || `${context.executionId}:${node.id}`,
      externalRef: context.metadata?.waitingTimer?.timerId || null,
      nodeId: node.id,
      metadata: {
        timerId: context.metadata?.waitingTimer?.timerId || null,
        durationMs: result.output?.durationMs || null,
      },
    };
  }
  if (node.type === 'task.message.receive') {
    return {
      type: 'message',
      resumeAt: null,
      correlationKey: input?.correlationKey || context.metadata?.correlationKey || `${context.executionId}:${node.id}:message`,
      externalRef: null,
      nodeId: node.id,
      metadata: {
        variable: result.output?.variable || node.config?.variable || 'user_input',
      },
    };
  }
  if (node.type === 'task.user') {
    return {
      type: 'human',
      resumeAt: null,
      correlationKey: input?.correlationKey || `${context.executionId}:${node.id}:human`,
      externalRef: context.metadata?.handoffQueue || null,
      nodeId: node.id,
      metadata: {
        queue: context.metadata?.handoffQueue || null,
      },
    };
  }
  if (node.type === 'call.subprocess') {
    return {
      type: 'subprocess',
      resumeAt: null,
      correlationKey: input?.correlationKey || `${context.executionId}:${node.id}:subprocess`,
      externalRef: result.output?.childExecutionId || result.output?.calledElement || null,
      nodeId: node.id,
      metadata: {
        calledElement: result.output?.calledElement || null,
        childExecutionId: result.output?.childExecutionId || null,
        resumeSchema: node.inputSchema || node.config?.resumeSchema || null,
      },
    };
  }
  return {
    type: 'external_event',
    resumeAt: null,
    correlationKey: input?.correlationKey || `${context.executionId}:${node.id}:external`,
    externalRef: null,
    nodeId: node.id,
    metadata: {
      resumeSchema: node.inputSchema || node.config?.resumeSchema || null,
    },
  };
}

module.exports = {
  deriveWaitingState,
};