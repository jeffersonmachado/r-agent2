'use strict';

/**
 * Durable Execution Evidence Adapter — converte evidências do Process Runtime
 * em formato compatível com o Validation Engine e Outcome Contracts.
 *
 * O Execution Router em modo DURABLE não pode entregar steps: [] e
 * toolsExecuted: [] — o Validation Engine precisa de evidência real.
 *
 * Este adapter deriva evidência de:
 *  - process events (node entered, completed, failed)
 *  - state transitions
 *  - context variables (outputs das tools)
 *  - tool calls registradas
 *  - human tasks
 *  - wait events
 *  - completed nodes
 *
 * NUNCA inventa execução — apenas extrai o que realmente aconteceu.
 */

function defaultLogger() {
  try {
    return require('../../../../api/utils/logger');
  } catch (_) {
    return { info: () => {}, warn: () => {}, error: () => {} };
  }
}

/**
 * Constrói evidência de execução a partir do resultado do Process Runtime.
 *
 * @param {object} processResult — resultado do ProcessRuntimeService.startProcess()
 * @param {string} processResult.instanceId
 * @param {string} processResult.status — completed | failed | running | waiting
 * @param {Array}  processResult.events — eventos emitidos durante a execução
 * @param {object} processResult.variables — variáveis de contexto do processo
 * @param {Array}  processResult.nodeResults — resultados por nó (opcional)
 * @returns {object} { steps, toolsExecuted, status, evidence }
 */
function buildDurableEvidence(processResult = {}) {
  if (!processResult || !processResult.instanceId) {
    return {
      steps: [],
      toolsExecuted: [],
      status: 'no_evidence',
      evidence: { error: 'process_result_missing_instance_id' },
    };
  }

  const events = Array.isArray(processResult.events) ? processResult.events : [];
  const nodeResults = Array.isArray(processResult.nodeResults) ? processResult.nodeResults : [];
  const variables = processResult.variables || {};

  const steps = [];
  const toolsExecuted = [];
  const nodeMap = new Map();

  // Extrai steps dos eventos de nó
  for (const event of events) {
    const nodeId = event.nodeId || event.node_id || null;
    if (!nodeId) continue;

    if (!nodeMap.has(nodeId)) {
      nodeMap.set(nodeId, {
        id: event.planStepId || nodeId,
        nodeId,
        status: 'pending',
        toolId: null,
        output: null,
        error: null,
      });
    }

    const step = nodeMap.get(nodeId);
    const eventType = event.type || event.event || '';

    if (eventType.includes('enter') || eventType.includes('start')) {
      step.status = 'executing';
    } else if (eventType.includes('complete') || eventType.includes('success')) {
      step.status = 'executed';
      step.output = event.output || event.data || null;
      if (event.toolId) {
        step.toolId = event.toolId;
        if (!toolsExecuted.includes(event.toolId)) {
          toolsExecuted.push(event.toolId);
        }
      }
    } else if (eventType.includes('fail') || eventType.includes('error')) {
      step.status = 'failed';
      step.error = event.error || event.message || 'unknown';
    }
  }

  // Complementa com nodeResults explícitos
  for (const nr of nodeResults) {
    const step = nodeMap.get(nr.nodeId) || {
      id: nr.planStepId || nr.nodeId,
      nodeId: nr.nodeId,
      status: 'pending',
      toolId: null,
      output: null,
      error: null,
    };
    step.status = nr.status || step.status;
    step.output = nr.output || step.output;
    step.error = nr.error || step.error;
    if (nr.toolId) {
      step.toolId = nr.toolId;
      if (!toolsExecuted.includes(nr.toolId)) {
        toolsExecuted.push(nr.toolId);
      }
    }
    nodeMap.set(nr.nodeId, step);
  }

  // Extrai tool calls das variáveis de contexto (formato: <nodeId>_result)
  for (const [key, value] of Object.entries(variables)) {
    if (key.endsWith('_result') && value && typeof value === 'object') {
      if (value.toolId && !toolsExecuted.includes(value.toolId)) {
        toolsExecuted.push(value.toolId);
      }
    }
  }

  for (const step of nodeMap.values()) {
    steps.push(step);
  }

  const status = processResult.status === 'completed' ? 'completed'
    : processResult.status === 'running' || processResult.status === 'waiting' ? 'running'
    : 'failed';

  return {
    steps,
    toolsExecuted,
    status,
    processInstanceId: processResult.instanceId,
    processStatus: processResult.status,
    evidence: {
      nodeCount: nodeMap.size,
      toolCount: toolsExecuted.length,
      eventCount: events.length,
    },
  };
}

module.exports = { buildDurableEvidence };
