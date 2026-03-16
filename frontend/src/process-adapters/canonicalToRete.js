import { getNodeInputs, getNodeOutputs, DEFAULT_SOCKET_NAME } from '../editor/nodeSchemas';
import { normalizeCanonicalProcessDefinition } from '../process-canonical/canonicalNormalizer';
import { inferReteType, rewriteConfigNodeReferences } from './adapterShared';

function createNodeShell(numericId, reteType, config, position) {
  const baseNode = {
    id: numericId,
    data: {
      type: reteType,
      config: config || {},
      __engineId: String(config?.__engineId || ''),
    },
    position,
    name: 'FlowNode',
    inputs: {},
    outputs: {},
  };

  const inputDefs = getNodeInputs(reteType, { id: String(numericId), type: reteType, config });
  inputDefs.forEach((inputDef) => {
    baseNode.inputs[inputDef.key] = {
      socket: { name: inputDef.socketName || DEFAULT_SOCKET_NAME },
      label: inputDef.label,
      connections: [],
    };
  });

  const outputDefs = getNodeOutputs(reteType, { id: String(numericId), type: reteType, config });
  outputDefs.forEach((outputDef) => {
    baseNode.outputs[outputDef.key] = {
      socket: { name: outputDef.socketName || DEFAULT_SOCKET_NAME },
      label: outputDef.label,
      connections: [],
    };
  });

  return baseNode;
}

export function canonicalToRete(definition) {
  const canonical = normalizeCanonicalProcessDefinition(definition);
  const canonicalIdToNumeric = new Map();
  const reteNodes = {};

  canonical.nodes.forEach((node, index) => {
    const numericId = Number.isNaN(Number(node.id)) ? index + 1 : Number(node.id);
    canonicalIdToNumeric.set(node.id, numericId);
  });

  canonical.nodes.forEach((node, index) => {
    const numericId = canonicalIdToNumeric.get(node.id) || index + 1;
    const reteType = inferReteType(node);
    const position = Array.isArray(node?.observability?.layout?.position) && node.observability.layout.position.length >= 2
      ? [Number(node.observability.layout.position[0]) || 0, Number(node.observability.layout.position[1]) || 0]
      : [(index % 5) * 250, Math.floor(index / 5) * 160];
    const config = rewriteConfigNodeReferences(
      reteType,
      node.config || {},
      (value) => String(canonicalIdToNumeric.get(String(value)) || value),
    );
    reteNodes[String(numericId)] = createNodeShell(numericId, reteType, config, position);
    reteNodes[String(numericId)].data.__engineId = String(node.id);
  });

  canonical.edges.forEach((edge) => {
    const sourceNumeric = canonicalIdToNumeric.get(edge.source);
    const targetNumeric = canonicalIdToNumeric.get(edge.target);
    if (!sourceNumeric || !targetNumeric) return;
    const sourceNode = reteNodes[String(sourceNumeric)];
    const outputKey = String(edge.metadata?.sourcePort || 'out');
    if (!sourceNode.outputs[outputKey]) {
      sourceNode.outputs[outputKey] = {
        socket: { name: DEFAULT_SOCKET_NAME },
        label: outputKey,
        connections: [],
      };
    }
    sourceNode.outputs[outputKey].connections.push({
      node: targetNumeric,
      input: edge.metadata?.targetInput || 'in',
    });
  });

  const reteJson = {
    id: 'chatbot-flow@0.1.0',
    nodes: reteNodes,
  };

  return {
    ...reteJson,
    reteJson,
  };
}
