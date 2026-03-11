import { validateCanonicalProcess } from '../process-canonical/canonicalValidator';

export function canonicalOptimizationHints(canonicalProcessDefinition) {
  const validation = validateCanonicalProcess(canonicalProcessDefinition);
  const hints = [];

  validation.warnings.forEach((warning) => {
    if (warning.code === 'canonical_orphan_nodes') {
      hints.push('Connect orphan nodes to a valid entrypoint or remove them.');
    }
    if (warning.code === 'canonical_potentially_dangerous_loops') {
      hints.push('Add explicit loop break conditions and timeouts.');
    }
    if (warning.code === 'canonical_route_without_termination') {
      hints.push('Ensure each route reaches end/fallback to prevent dead paths.');
    }
  });

  validation.suggestions.forEach((suggestion) => {
    if (suggestion.code === 'canonical_high_fanout_non_gateway') {
      hints.push('Model high fan-out transitions using gateway.exclusive for clarity.');
    }
  });

  return {
    hints,
    validationSummary: validation.summary,
  };
}

export default canonicalOptimizationHints;
