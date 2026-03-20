'use strict';

function parseListInstances(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  const status = urlObj.searchParams.get('status');
  const processId = urlObj.searchParams.get('processId');
  const limit = urlObj.searchParams.get('limit');

  return {
    status: status ? String(status) : null,
    processId: processId ? String(processId) : null,
    limit: limit != null ? Number(limit) : 50,
  };
}

function parseAnalytics(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  const processId = urlObj.searchParams.get('processId');
  const limit = urlObj.searchParams.get('limit');

  return {
    processId: processId ? String(processId) : null,
    limit: limit != null ? Number(limit) : 500,
  };
}

function parseHistory(urlString) {
  const urlObj = new URL(urlString || '/', 'http://localhost');
  const eventType = urlObj.searchParams.get('eventType');
  const nodeId = urlObj.searchParams.get('nodeId');
  const limit = urlObj.searchParams.get('limit');

  return {
    eventType: eventType ? String(eventType) : null,
    nodeId: nodeId ? String(nodeId) : null,
    limit: limit != null ? Number(limit) : null,
  };
}

function parseRuntimePayload(body) {
  return {
    processId: body?.processId || body?.flowId || null,
    processDefinition: body?.processDefinition || body?.definition || null,
    processVersion: body?.processVersion || null,
    input: body?.input || {},
  };
}

function createProcessRuntimeService({ durableProcessService }) {
  return {
    parseListInstances,
    parseAnalytics,
    parseHistory,
    parseRuntimePayload,

    listProcessInstances(params) {
      return durableProcessService.listProcessInstances(params);
    },

    startDurableProcess(params) {
      return durableProcessService.startDurableProcess(params);
    },

    getProcessAnalytics(params) {
      return durableProcessService.getProcessAnalytics(params);
    },

    simulateProcessDefinition(params) {
      return durableProcessService.simulateProcessDefinition(params);
    },

    getProcessIntelligence(params) {
      return durableProcessService.getProcessIntelligence(params);
    },

    resumeExternalProcessEvent(correlationKey, payload, tenantId) {
      return durableProcessService.resumeExternalProcessEvent(correlationKey, payload, tenantId);
    },

    getProcessInstance(executionId, tenantId) {
      return durableProcessService.getProcessInstance(executionId, tenantId);
    },

    getProcessInstanceHistory(executionId, tenantId, options) {
      return durableProcessService.getProcessInstanceHistory(executionId, tenantId, options);
    },

    cancelProcessInstance(executionId, reason, actor, tenantId) {
      return durableProcessService.cancelProcessInstance(executionId, reason, actor, tenantId);
    },

    resumeProcessInstance(executionId, payload, tenantId) {
      return durableProcessService.resumeProcessInstance(executionId, payload, tenantId);
    },
  };
}

module.exports = {
  createProcessRuntimeService,
};
