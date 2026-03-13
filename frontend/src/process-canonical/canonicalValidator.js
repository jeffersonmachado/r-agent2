import {
  CANONICAL_FALLBACK,
  CANONICAL_GATEWAY_EXCLUSIVE,
  CANONICAL_START,
  CANONICAL_TASK_AI,
  CANONICAL_TASK_USER,
  CANONICAL_WAIT_TIMER,
  isCanonicalTerminalType,
} from './canonicalTypes';
import { normalizeCanonicalProcessDefinition } from './canonicalNormalizer';

function createIssue(severity, code, message, nodeIds = [], details = {}) {
  return {
    source: 'canonical',
    severity,
    code,
    message,
    messageUi: message,
    nodeIds: Array.isArray(nodeIds) ? nodeIds : [],
    details,
  };
}

function buildAdjacency(edges) {
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.source)) outgoing.set(edge.source, []);
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
  }
  return { outgoing, incoming };
}

export function flattenCanonicalValidationIssues(report) {
  return [
    ...(Array.isArray(report?.errors) ? report.errors : []),
    ...(Array.isArray(report?.warnings) ? report.warnings : []),
    ...(Array.isArray(report?.suggestions) ? report.suggestions : []),
  ];
}

export function validateCanonicalProcessDefinition(definition) {
  const canonical = normalizeCanonicalProcessDefinition(definition);
  const errors = [];
  const warnings = [];
  const suggestions = [];
  const { outgoing, incoming } = buildAdjacency(canonical.edges);
  const nodeMap = new Map(canonical.nodes.map((node) => [node.id, node]));

  const startNodes = canonical.nodes.filter((node) => node.type === CANONICAL_START);
  if (startNodes.length === 0) {
    errors.push(createIssue('error', 'CANONICAL_START_MISSING', 'O processo canônico precisa ter pelo menos um nó start.'));
  }

  const entrypoints = canonical.entrypoints.length > 0 ? canonical.entrypoints : startNodes.map((node) => node.id);
  const visited = new Set();
  const stack = [...entrypoints];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const nextEdges = outgoing.get(current) || [];
    nextEdges.forEach((edge) => {
      if (edge.target && nodeMap.has(edge.target) && !visited.has(edge.target)) {
        stack.push(edge.target);
      }
    });
  }

  canonical.nodes.forEach((node) => {
    const incomingEdges = incoming.get(node.id) || [];
    const outgoingEdges = outgoing.get(node.id) || [];
    const subtype = node.subtype || node.metadata?.adapter?.reteType || '';

    if (node.type !== CANONICAL_START && incomingEdges.length === 0) {
      errors.push(createIssue('error', 'CANONICAL_NODE_ORPHAN', `O nó "${node.label}" está órfão no processo canônico.`, [node.id]));
    }

    if (!visited.has(node.id) && node.type !== CANONICAL_START) {
      warnings.push(createIssue('warning', 'CANONICAL_NODE_UNREACHABLE', `O nó "${node.label}" não é alcançável a partir dos entrypoints.`, [node.id]));
    }

    if (!isCanonicalTerminalType(node.type, subtype) && outgoingEdges.length === 0) {
      warnings.push(createIssue('warning', 'CANONICAL_PATH_WITHOUT_EXIT', `O nó "${node.label}" não possui saída canônica.`, [node.id]));
    }

    if (node.type === CANONICAL_GATEWAY_EXCLUSIVE && outgoingEdges.length < 2) {
      warnings.push(createIssue('warning', 'CANONICAL_GATEWAY_LOW_BRANCHING', `O gateway "${node.label}" deveria ter ao menos duas saídas.`, [node.id]));
    }

    if (node.type === CANONICAL_TASK_AI) {
      const hasFallbackEdge = outgoingEdges.some((edge) => {
        const port = String(edge.metadata?.sourcePort || '').toLowerCase();
        return port.includes('fallback') || port.includes('error');
      });
      const hasPrompt = typeof node.config?.promptTemplate === 'string' && node.config.promptTemplate.trim() !== '';
      const hasTask = typeof node.config?.task === 'string' && node.config.task.trim() !== '';

      if (!hasPrompt && !hasTask) {
        errors.push(createIssue('error', 'CANONICAL_AI_CONFIG_MISSING', `O nó de IA "${node.label}" está sem configuração mínima.`, [node.id]));
      }
      if (!hasFallbackEdge) {
        warnings.push(createIssue('warning', 'CANONICAL_AI_FALLBACK_MISSING', `O nó de IA "${node.label}" não possui caminho explícito de fallback.`, [node.id]));
      }
    }

    if (node.type === CANONICAL_WAIT_TIMER) {
      const hasTimerValue = ['delayMs', 'seconds', 'timeoutMs', 'cron', 'expression', 'timeDuration']
        .some((key) => node.config?.[key] !== undefined && node.config?.[key] !== null && node.config?.[key] !== '');
      if (!hasTimerValue) {
        errors.push(createIssue('error', 'CANONICAL_TIMER_INVALID', `O nó temporal "${node.label}" não possui configuração de tempo válida.`, [node.id]));
      }
    }

    if (node.type === CANONICAL_TASK_USER) {
      const queue = node.config?.queue || node.config?.ramal || node.config?.fila || null;
      if (!queue && String(subtype || '').includes('handoff')) {
        errors.push(createIssue('error', 'CANONICAL_HANDOFF_INCOMPLETE', `O handoff "${node.label}" está sem fila ou destino configurado.`, [node.id]));
      }
    }

    if (node.type !== CANONICAL_FALLBACK && incomingEdges.length > 1 && node.type === CANONICAL_GATEWAY_EXCLUSIVE) {
      suggestions.push(createIssue('info', 'CANONICAL_GATEWAY_MERGE_HINT', `Considere introduzir um nó de merge antes de "${node.label}" para tornar a estrutura mais explícita.`, [node.id]));
    }
  });

  const fallbackNodes = canonical.nodes.filter((node) => node.type === CANONICAL_FALLBACK);
  if (fallbackNodes.length === 0) {
    suggestions.push(createIssue('info', 'CANONICAL_FALLBACK_MISSING', 'O processo não possui um nó canônico de fallback explícito.'));
  }

  canonical.edges.forEach((edge) => {
    if (edge.metadata?.sourceMissing || edge.metadata?.targetMissing) {
      errors.push(createIssue('error', 'CANONICAL_EDGE_INCONSISTENT', `A aresta "${edge.id}" referencia nós inexistentes.`, [edge.source, edge.target].filter(Boolean), {
        sourceMissing: !!edge.metadata?.sourceMissing,
        targetMissing: !!edge.metadata?.targetMissing,
      }));
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    suggestions,
    summary: {
      nodeCount: canonical.nodes.length,
      edgeCount: canonical.edges.length,
      startCount: startNodes.length,
    },
  };
}
