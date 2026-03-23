'use strict';

function resolveCalledElement(node) {
  return node?.config?.flowId || node?.config?.calledElement || null;
}

function isSubprocessResumeInput(input = {}) {
  return input?.resumeType === 'subprocess' || input?.childExecutionId || input?.childStatus;
}

function isAsyncSubprocessNode(node) {
  return node?.config?.async === true || node?.config?.waitForCompletion === false;
}

function buildChildExecutionId({ context, node, input = {} }) {
  return input?.childExecutionId || `${context.executionId}:${String(node.id)}:child:${Date.now()}`;
}

function buildResolvedSubprocessResult({ node, context, input = {}, calledElement, clone }) {
  context.setVariable(`${node.id}_subprocess`, {
    executionId: input?.childExecutionId || null,
    status: input?.childStatus || 'completed',
    output: clone(input?.output || null),
  });
  return {
    nextState: context.toSnapshot(),
    events: [],
    output: {
      type: 'subprocess_resolved',
      calledElement,
      childExecutionId: input?.childExecutionId || null,
      childStatus: input?.childStatus || 'completed',
    },
  };
}

function buildSubprocessMissingChildResult({ node, context, calledElement, childExecutionId }) {
  const waitForInput = isAsyncSubprocessNode(node);
  return {
    nextState: context.toSnapshot(),
    events: [],
    output: {
      type: waitForInput ? 'subprocess_wait' : 'subprocess',
      calledElement,
      waitForInput,
      childExecutionId,
    },
  };
}

function buildSubprocessChildInput({ context, node, input = {}, childExecutionId, calledElement, clone }) {
  return {
    executionId: childExecutionId,
    variables: clone(input?.variables || context.variables || {}),
    tenantId: context.metadata?.tenantId || null,
    metadata: {
      parentExecutionId: context.executionId,
      parentNodeId: node.id,
      parentCorrelationKey: `${context.executionId}:${node.id}:subprocess`,
      calledElement,
    },
  };
}

function applyAsyncSubprocessMetadata({ context, node, compiledChild, childExecutionId }) {
  context.metadata = {
    ...(context.metadata || {}),
    childProcesses: {
      ...((context.metadata && context.metadata.childProcesses) || {}),
      [String(node.id)]: {
        executionId: childExecutionId,
        processId: compiledChild.id,
        processVersion: compiledChild.version || 1,
      },
    },
  };
}

function buildAsyncSubprocessResult({ context, calledElement, childExecutionId, compiledChild, childInput }) {
  return {
    nextState: context.toSnapshot(),
    events: [],
    output: {
      type: 'subprocess_wait',
      calledElement,
      childExecutionId,
      deferredSubprocessStart: {
        compiledChild,
        childInput,
      },
      waitForInput: true,
    },
  };
}

function buildSyncSubprocessResult({ node, context, calledElement, childExecutionId, childResult }) {
  context.setVariable(`${node.id}_subprocess`, {
    executionId: childExecutionId,
    status: childResult.status,
    output: childResult.output || null,
  });
  return {
    nextState: context.toSnapshot(),
    events: [],
    output: {
      type: 'subprocess',
      calledElement,
      childExecutionId,
      childStatus: childResult.status,
    },
  };
}

function buildParentResumePayload({ context, compiledProcess, output = null }) {
  return {
    resumeType: 'subprocess',
    parentExecutionId: context.metadata?.parentExecutionId || null,
    childExecutionId: context.executionId,
    childProcessId: compiledProcess?.id || context.processId,
    childProcessVersion: compiledProcess?.version || context.processVersion || 1,
    childStatus: context.status,
    output,
  };
}

module.exports = {
  resolveCalledElement,
  isSubprocessResumeInput,
  isAsyncSubprocessNode,
  buildChildExecutionId,
  buildResolvedSubprocessResult,
  buildSubprocessMissingChildResult,
  buildSubprocessChildInput,
  applyAsyncSubprocessMetadata,
  buildAsyncSubprocessResult,
  buildSyncSubprocessResult,
  buildParentResumePayload,
};