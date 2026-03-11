import { CANONICAL_NODE_TYPES } from '../process-canonical/canonicalTypes';

const REQUIRED_FOR_OPERATIONAL_READINESS = [
  CANONICAL_NODE_TYPES.START,
  CANONICAL_NODE_TYPES.END,
  CANONICAL_NODE_TYPES.GATEWAY_EXCLUSIVE,
  CANONICAL_NODE_TYPES.TASK_SERVICE,
  CANONICAL_NODE_TYPES.FALLBACK,
];

export function canonicalGapAnalysis(canonicalProcessDefinition = {}) {
  const nodes = Array.isArray(canonicalProcessDefinition.nodes)
    ? canonicalProcessDefinition.nodes
    : [];

  const availableTypes = new Set(nodes.map((node) => String(node?.type || '').trim()));

  const missingNodeTypes = REQUIRED_FOR_OPERATIONAL_READINESS.filter(
    (type) => !availableTypes.has(type),
  );

  return {
    readiness: missingNodeTypes.length === 0 ? 'ready' : 'partial',
    missingNodeTypes,
    recommendations: missingNodeTypes.map(
      (type) => `Add at least one node of type "${type}" for stronger operational coverage.`,
    ),
  };
}

export default canonicalGapAnalysis;
