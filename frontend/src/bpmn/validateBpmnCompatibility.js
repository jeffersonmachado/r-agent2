import {
  BPMN_COMPATIBILITY_STATUS,
  getNodeBpmnMapping,
  requiresExtension,
} from './bpmnNodeMapping';

function normalizeNodes(reteJson) {
  if (!reteJson || typeof reteJson !== 'object') return [];

  if (Array.isArray(reteJson.nodes)) {
    return reteJson.nodes
      .map((node, index) => ({
        id: String(node?.id ?? index + 1),
        type: String(node?.type || node?.data?.type || '').trim(),
      }))
      .filter((node) => node.type);
  }

  if (reteJson.nodes && typeof reteJson.nodes === 'object') {
    return Object.entries(reteJson.nodes)
      .map(([id, node]) => ({
        id: String(id),
        type: String(node?.data?.type || node?.type || '').trim(),
      }))
      .filter((node) => node.type);
  }

  return [];
}

function buildWarning({ code, message, nodeId, details }) {
  return {
    code,
    message,
    messageUi: message,
    severity: 'warning',
    nodeIds: nodeId ? [String(nodeId)] : [],
    details: details && typeof details === 'object' ? details : {},
  };
}

export function validateBpmnCompatibility(reteJson) {
  const nodes = normalizeNodes(reteJson);
  const warnings = [];

  let startCount = 0;
  let endCount = 0;

  nodes.forEach((node) => {
    if (node.type === 'start') startCount += 1;
    if (node.type === 'end') endCount += 1;

    const mapping = getNodeBpmnMapping(node.type);
    if (!mapping) {
      warnings.push(
        buildWarning({
          code: 'BPMN_UNMAPPED_NODE_TYPE',
          message: `Tipo de no \"${node.type}\" nao possui mapeamento oficial BPMN MVP e sera exportado com degradacao.`,
          nodeId: node.id,
          details: { nodeType: node.type },
        }),
      );
      return;
    }

    if (mapping.status === BPMN_COMPATIBILITY_STATUS.SUPPORTED_WITH_DEGRADATION) {
      warnings.push(
        buildWarning({
          code: 'BPMN_NODE_DEGRADATION',
          message: `No \"${node.type}\" possui suporte BPMN com degradacao controlada.`,
          nodeId: node.id,
          details: { nodeType: node.type, bpmnElement: mapping.bpmnElement },
        }),
      );
    }

    if (requiresExtension(node.type)) {
      warnings.push(
        buildWarning({
          code: 'BPMN_NODE_REQUIRES_EXTENSION',
          message: `No \"${node.type}\" depende de extensionElements do r-agent2 para preservar semantica no BPMN.`,
          nodeId: node.id,
          details: { nodeType: node.type, bpmnElement: mapping.bpmnElement },
        }),
      );
    }
  });

  if (nodes.length > 0 && startCount === 0) {
    warnings.push(
      buildWarning({
        code: 'BPMN_START_EVENT_MISSING',
        message: 'Fluxo sem no de inicio (start). Exportacao BPMN pode ficar menos interoperavel.',
        details: { startCount },
      }),
    );
  }

  if (startCount > 1) {
    warnings.push(
      buildWarning({
        code: 'BPMN_MULTIPLE_START_EVENTS',
        message: `Fluxo possui ${startCount} nos de inicio. Revise a interoperabilidade BPMN esperada.`,
        details: { startCount },
      }),
    );
  }

  if (nodes.length > 0 && endCount === 0) {
    warnings.push(
      buildWarning({
        code: 'BPMN_END_EVENT_MISSING',
        message: 'Fluxo sem no de fim (end). Exportacao BPMN pode ficar menos interoperavel.',
        details: { endCount },
      }),
    );
  }

  return {
    compatible: warnings.length === 0,
    warnings,
    warningCount: warnings.length,
  };
}

export default validateBpmnCompatibility;
