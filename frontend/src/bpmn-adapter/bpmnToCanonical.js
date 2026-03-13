import { bpmnXmlToEngineFlow } from '../bpmn/bpmnXmlToEngineFlow';
import { engineFlowToCanonical } from '../process-adapters/engineFlowToCanonical';

function normalizeImportedId(value) {
  const raw = String(value || '');
  const match = raw.match(/^[A-Za-z]+_(.+)$/);
  return match ? match[1] : raw;
}

export function bpmnToCanonical(xml, options = {}) {
  const imported = bpmnXmlToEngineFlow(xml, options);
  const canonical = engineFlowToCanonical(imported.flowDefinition);
  const originalIdByImportedId = new Map(
    (imported.flowDefinition?.nodes || []).map((node) => [
      String(node.id),
      node?.config?.bpmnElementId ? normalizeImportedId(node.config.bpmnElementId) : String(node.id),
    ]),
  );

  const normalizedCanonical = {
    ...canonical,
    entrypoints: (canonical.entrypoints || []).map((nodeId) => originalIdByImportedId.get(String(nodeId)) || String(nodeId)),
    nodes: (canonical.nodes || []).map((node) => ({
      ...node,
      id: originalIdByImportedId.get(String(node.id)) || String(node.id),
    })),
    edges: (canonical.edges || []).map((edge) => ({
      ...edge,
      id: `${originalIdByImportedId.get(String(edge.source)) || String(edge.source)}:${originalIdByImportedId.get(String(edge.target)) || String(edge.target)}:${edge.metadata?.sourcePort || 'out'}`,
      source: originalIdByImportedId.get(String(edge.source)) || String(edge.source),
      target: originalIdByImportedId.get(String(edge.target)) || String(edge.target),
    })),
  };

  return {
    canonical: normalizedCanonical,
    report: imported.report,
    flowDefinition: imported.flowDefinition,
  };
}

export default bpmnToCanonical;
