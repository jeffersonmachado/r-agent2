/**
 * Validação semântica reforçada para fluxos de chatbot gerados por IA.
 *
 * Importante:
 * - O projeto já possui validação estrutural robusta em:
 *   - engine/validator.js
 *   - api/utils/validateFlowPlan.js (whitelist RAG + known errors)
 * - Este módulo adiciona hardening específico para "IA output":
 *   - safe-mode: proibir features perigosas no nascimento (ex.: nó api)
 *   - exigir fallback global
 *   - bloquear campos/injeções proibidas em configs
 *   - produzir qualityScore + riskFlags
 */

const DEFAULT_LIMITS = {
  maxNodes: 200,
  maxEdges: 500,
  maxStringScan: 20000,
  maxScanDepth: 6,
};

const FORBIDDEN_CONFIG_KEYS = new Set([
  'customCode',
  'eval',
  'script',
  'code',
  'javascript',
  'js',
  'functionBody',
  'onErrorJs',
  'onSuccessJs',
]);

const FORBIDDEN_STRING_PATTERNS = [
  /\beval\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /\brequire\s*\(/i,
  /\bprocess\.env\b/i,
  /<\s*script\b/i,
];

function safeToString(value, maxLen) {
  if (value === null || value === undefined) return '';
  let s = '';
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  if (typeof maxLen === 'number' && maxLen > 0 && s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function collectEdges(flow) {
  const edges = [];
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  for (const node of nodes) {
    if (!node || !node.id) continue;

    // next (string | array)
    if (typeof node.next === 'string') {
      edges.push({ from: node.id, to: node.next });
    } else if (Array.isArray(node.next)) {
      for (const to of node.next) {
        if (typeof to === 'string') edges.push({ from: node.id, to });
      }
    }

    // router rules: config.rules[].next
    if (node.type === 'router' || node.type === 'schedule_router') {
      const rules = node?.config?.rules || node?.config?.schedules || null;
      if (Array.isArray(rules)) {
        for (const r of rules) {
          if (r && typeof r.next === 'string') edges.push({ from: node.id, to: r.next });
          // schedule_router usa "defaultNext"
        }
      }
      if (node.type === 'schedule_router' && typeof node?.config?.defaultNext === 'string') {
        edges.push({ from: node.id, to: node.config.defaultNext });
      }
    }
  }
  return edges;
}

function deepScanForForbidden(node, { errors, maxDepth, maxStringScan }, depth = 0, path = '$') {
  if (depth > maxDepth) return;

  if (node && typeof node === 'object') {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        deepScanForForbidden(node[i], { errors, maxDepth, maxStringScan }, depth + 1, `${path}[${i}]`);
      }
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_CONFIG_KEYS.has(k)) {
        errors.push({
          type: 'FORBIDDEN_FIELD',
          message: `Campo proibido detectado em config: "${k}"`,
          rule: 'NO_CODE_FIELDS',
          path: `${path}.${k}`,
        });
      }
      deepScanForForbidden(v, { errors, maxDepth, maxStringScan }, depth + 1, `${path}.${k}`);
    }
    return;
  }

  if (typeof node === 'string') {
    const s = node.length > maxStringScan ? node.slice(0, maxStringScan) : node;
    for (const re of FORBIDDEN_STRING_PATTERNS) {
      if (re.test(s)) {
        errors.push({
          type: 'FORBIDDEN_PATTERN',
          message: `Padrão proibido detectado em string (${re.toString()})`,
          rule: 'NO_INJECTION_PATTERNS',
          path,
        });
        break;
      }
    }
  }
}

/**
 * @param {any} flow
 * @param {{ limits?: Partial<typeof DEFAULT_LIMITS>, allowApiNode?: boolean }} [options]
 * @returns {{ valid: boolean, errors: any[], warnings: any[], qualityScore: number, riskFlags: string[] }}
 */
function validateChatbotFlowSemantic(flow, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(options.limits || {}) };
  const allowApiNode = options.allowApiNode === true;

  const errors = [];
  const warnings = [];
  const riskFlags = [];
  let qualityScore = 100;

  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const edges = collectEdges(flow);

  // Regra: exigir fallback/global error node
  const fallbackCount = nodes.filter(n => n && n.type === 'fallback').length;
  if (fallbackCount < 1) {
    errors.push({
      type: 'MISSING_FALLBACK_NODE',
      message: 'Fluxo gerado por IA deve conter pelo menos 1 nó "fallback" (erro global)',
      rule: 'REQUIRE_GLOBAL_FALLBACK',
    });
  }

  // Regra: limitar tamanho (hard)
  if (nodes.length > limits.maxNodes) {
    errors.push({
      type: 'FLOW_TOO_LARGE_AI',
      message: `Fluxo excede o limite para geração por IA (${nodes.length} nós > ${limits.maxNodes})`,
      rule: 'MAX_NODES_AI',
      details: { nodeCount: nodes.length, maxNodes: limits.maxNodes },
    });
  } else if (nodes.length > Math.floor(limits.maxNodes * 0.75)) {
    warnings.push({
      type: 'FLOW_LARGE_WARNING',
      message: `Fluxo grande para revisão humana (${nodes.length} nós)`,
      rule: 'FLOW_SIZE_WARNING',
      details: { nodeCount: nodes.length },
    });
    qualityScore -= 10;
  }

  if (edges.length > limits.maxEdges) {
    errors.push({
      type: 'FLOW_TOO_CONNECTED_AI',
      message: `Fluxo excede o limite de conexões para geração por IA (${edges.length} edges > ${limits.maxEdges})`,
      rule: 'MAX_EDGES_AI',
      details: { edgeCount: edges.length, maxEdges: limits.maxEdges },
    });
  }

  // Regra: bloquear nó api (por padrão) e sinalizar risco
  const hasApiNode = nodes.some(n => n && n.type === 'api');
  if (hasApiNode) {
    riskFlags.push('EXTERNAL_CALLS');
    if (!allowApiNode) {
      errors.push({
        type: 'API_NODE_NOT_ALLOWED',
        message: 'Nó "api" é bloqueado para fluxos gerados por IA (requer revisão/ativação explícita)',
        rule: 'NO_EXTERNAL_CALLS_BY_DEFAULT',
      });
    } else {
      warnings.push({
        type: 'API_NODE_PRESENT',
        message: 'Fluxo contém nó "api" (chamadas externas) - revisão obrigatória',
        rule: 'RISK_EXTERNAL_CALLS',
      });
      qualityScore -= 20;
    }
  }

  // Scan de configs por campos/padrões proibidos (hard)
  for (let i = 0; i < nodes.length; i += 1) {
    const n = nodes[i];
    if (!n) continue;
    // Scan em config e no próprio nó
    deepScanForForbidden(n, { errors, maxDepth: limits.maxScanDepth, maxStringScan: limits.maxStringScan }, 0, `$nodes[${i}]`);
  }

  // Risk flags (não-bloqueantes) adicionais
  const aiNodesCount = nodes.filter(n => n && (n.type === 'ai' || n.type === 'ai_task')).length;
  if (aiNodesCount > 0) {
    riskFlags.push('USES_AI_NODES');
    if (aiNodesCount > 3) {
      warnings.push({
        type: 'MANY_AI_NODES',
        message: `Fluxo contém muitos nós de IA (${aiNodesCount})`,
        rule: 'AI_NODES_COUNT_WARNING',
        details: { aiNodesCount },
      });
      qualityScore -= 10;
    }
  }

  const handoffCount = nodes.filter(n => n && n.type === 'handoff').length;
  if (handoffCount > 0) {
    riskFlags.push('HANDOFF_PRESENT');
  }

  if (qualityScore < 0) qualityScore = 0;
  if (qualityScore > 100) qualityScore = 100;

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    qualityScore,
    riskFlags: Array.from(new Set(riskFlags)),
  };
}

module.exports = {
  validateChatbotFlowSemantic,
};

