/**
 * FlowNormalizer
 *
 * Camada determinística de validação/normalização estrutural que roda APÓS a geração por IA
 * e ANTES da validação (`engine/validator.js`).
 *
 * Objetivo (STRICT MODE):
 * - NÃO criar nós artificiais (`merge_*`, `adapt_*`, etc.)
 * - NÃO quebrar ciclos
 * - NÃO reconectar órfãos
 * - NÃO inserir merges automaticamente
 *
 * Regra: se detectar ciclo, fan-in proibido, merge usado indevidamente (ex.: merge com <2 entradas,
 * merge->merge, merge->nó decisório), ou referências inválidas -> lançar erro.
 *
 * Notas importantes:
 * - Não altera o schema nem o validator.
 * - Não inventa novos tipos de nó (usa apenas tipos já existentes).
 */
 
const DECISION_NODE_TYPES = new Set(['router', 'options', 'semantic_router', 'ai_task', 'subflow', 'fallback']);
const ALLOWED_MULTIPLE_INPUTS = new Set(['end', 'handoff', 'merge']);
 
/**
 * @typedef {import('./flowTypes').FlowDefinition} FlowDefinition
 * @typedef {import('./flowTypes').FlowNode} FlowNode
 */
 
function deepCloneJson(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}
 
function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}
 
function normalizeFirstNext(next) {
  if (!next) return null;
  if (typeof next === 'string') return next;
  if (Array.isArray(next)) return next.length > 0 ? next.find((x) => typeof x === 'string') || null : null;
  if (typeof next === 'object') {
    const first = Object.values(next).find((v) => v != null);
    if (typeof first === 'string') return first;
    if (Array.isArray(first)) return first.find((x) => typeof x === 'string') || null;
  }
  return null;
}
 
function buildNodeMap(flow) {
  const map = new Map();
  for (const n of Array.isArray(flow.nodes) ? flow.nodes : []) {
    if (n && typeof n === 'object' && isNonEmptyString(n.id)) map.set(n.id, n);
  }
  return map;
}
 
/**
 * Espelha a lógica do validator: extrai arestas de node.next e router.config.rules[].next.
 * @param {FlowDefinition} flow
 * @returns {Array<{from: string, to: string}>}
 */
function buildEdges(flow) {
  /** @type {Array<{from: string, to: string}>} */
  const edges = [];
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  for (const node of nodes) {
    if (!node || !isNonEmptyString(node.id)) continue;
 
    // next: string | array | object(portMap)
    if (node.next) {
      if (typeof node.next === 'string') {
        edges.push({ from: node.id, to: node.next });
      } else if (Array.isArray(node.next)) {
        for (const t of node.next) {
          if (typeof t === 'string') edges.push({ from: node.id, to: t });
        }
      } else if (typeof node.next === 'object') {
        for (const rawNext of Object.values(node.next)) {
          if (!rawNext) continue;
          if (typeof rawNext === 'string') {
            edges.push({ from: node.id, to: rawNext });
          } else if (Array.isArray(rawNext)) {
            for (const t of rawNext) {
              if (typeof t === 'string') edges.push({ from: node.id, to: t });
            }
          }
        }
      }
    }
 
    // router rules
    if (node.type === 'router' && node.config && Array.isArray(node.config.rules)) {
      for (const rule of node.config.rules) {
        if (rule && isNonEmptyString(rule.next)) {
          edges.push({ from: node.id, to: rule.next });
        }
      }
    }
  }
  return edges;
}
 
function computeIndegree(edges) {
  // Importante: o mesmo nó (ex.: router) pode gerar arestas duplicadas para o mesmo target
  // (por exemplo, `router.next` e uma regra `always` apontando para o mesmo destino).
  // Para fins de múltiplas entradas e órfãos, consideramos apenas fontes únicas por destino.
  const sourcesByTarget = new Map(); // to -> Set(from)
  for (const e of edges) {
    if (!sourcesByTarget.has(e.to)) sourcesByTarget.set(e.to, new Set());
    sourcesByTarget.get(e.to).add(e.from);
  }
  const indeg = new Map();
  for (const [to, sources] of sourcesByTarget.entries()) {
    indeg.set(to, sources.size);
  }
  return indeg;
}
 
function mapReplaceInNextValue(v, fromId, toId) {
  if (!v) return v;
  if (typeof v === 'string') return v === fromId ? toId : v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' && x === fromId ? toId : x));
  return v;
}
 
/**
 * Substitui referências de targetId em node.next e (se router) em rules[].next.
 * @param {FlowNode} node
 * @param {string} fromId
 * @param {string} toId
 */
function replaceTargetRefs(node, fromId, toId) {
  if (!node || typeof node !== 'object') return;
 
  if (node.next) {
    if (typeof node.next === 'string') {
      if (node.next === fromId) node.next = toId;
    } else if (Array.isArray(node.next)) {
      node.next = node.next.map((x) => (typeof x === 'string' && x === fromId ? toId : x));
    } else if (typeof node.next === 'object') {
      for (const k of Object.keys(node.next)) {
        node.next[k] = mapReplaceInNextValue(node.next[k], fromId, toId);
      }
    }
  }
 
  if (node.type === 'router' && node.config && Array.isArray(node.config.rules)) {
    for (const rule of node.config.rules) {
      if (rule && typeof rule === 'object' && rule.next === fromId) {
        rule.next = toId;
      }
    }
  }
}
 
function detectAnyCycle(flow) {
  const edges = buildEdges(flow);
  const nodeIds = new Set((flow.nodes || []).map((n) => n && n.id).filter(Boolean));
  const adj = new Map();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
 
  const visited = new Set();
  const inStack = new Set();
 
  function dfs(id, path) {
    if (inStack.has(id)) {
      const idx = path.indexOf(id);
      return idx >= 0 ? path.slice(idx) : path;
    }
    if (visited.has(id)) return null;
    visited.add(id);
    inStack.add(id);
    for (const n of adj.get(id) || []) {
      const cycle = dfs(n, path.concat(n));
      if (cycle) return cycle;
    }
    inStack.delete(id);
    return null;
  }
 
  for (const id of nodeIds) {
    if (!visited.has(id)) {
      const cycle = dfs(id, [id]);
      if (cycle && cycle.length > 0) return cycle;
    }
  }
  return null;
}
 
function makeNormalizationError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details && typeof details === 'object') err.details = details;
  return err;
}

function extractTargetsFromNext(next) {
  if (!next) return [];
  if (typeof next === 'string') return [next];
  if (Array.isArray(next)) return next.filter((x) => typeof x === 'string');
  if (typeof next === 'object') {
    const out = [];
    for (const raw of Object.values(next)) {
      if (typeof raw === 'string') out.push(raw);
      else if (Array.isArray(raw)) out.push(...raw.filter((x) => typeof x === 'string'));
    }
    return out;
  }
  return [];
}

function assertNoDuplicateIds(flow) {
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
  const seen = new Set();
  const dups = new Set();
  for (const n of nodes) {
    const id = n && typeof n === 'object' ? n.id : null;
    if (!isNonEmptyString(id)) continue;
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  if (dups.size > 0) {
    throw makeNormalizationError(
      'NORMALIZER_DUPLICATE_NODE_ID',
      'FlowNormalizer (strict) detectou IDs duplicados; não tenta renomear automaticamente.',
      { duplicateIds: Array.from(dups) }
    );
  }
}

function assertTargetsExist(flow) {
  const nodeMap = buildNodeMap(flow);
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];

  for (const node of nodes) {
    if (!node || !isNonEmptyString(node.id)) continue;

    for (const to of extractTargetsFromNext(node.next)) {
      if (isNonEmptyString(to) && !nodeMap.has(to)) {
        throw makeNormalizationError(
          'NORMALIZER_TARGET_MISSING',
          `FlowNormalizer (strict): nó "${node.id}" aponta para target inexistente "${to}".`,
          { from: node.id, to }
        );
      }
    }

    if (node.type === 'router' && node.config && Array.isArray(node.config.rules)) {
      for (const r of node.config.rules) {
        const to = r && isNonEmptyString(r.next) ? r.next : null;
        if (to && !nodeMap.has(to)) {
          throw makeNormalizationError(
            'NORMALIZER_TARGET_MISSING',
            `FlowNormalizer (strict): router "${node.id}" possui regra apontando para target inexistente "${to}".`,
            { from: node.id, to }
          );
        }
      }
    }
  }
}

function assertNoProhibitedFanIn(flow) {
  const nodeMap = buildNodeMap(flow);
  const edges = buildEdges(flow);
  const indeg = computeIndegree(edges);

  for (const [toId, count] of indeg.entries()) {
    if (count <= 1) continue;
    const targetNode = nodeMap.get(toId);
    const targetType = targetNode?.type || null;
    if (!targetType) continue;
    if (ALLOWED_MULTIPLE_INPUTS.has(targetType)) continue;

    throw makeNormalizationError(
      'NORMALIZER_PROHIBITED_MULTIPLE_INPUTS',
      `FlowNormalizer (strict): nó "${toId}" (tipo "${targetType}") tem múltiplas entradas (${count}), o que é proibido.`,
      { nodeId: toId, nodeType: targetType, inputCount: count }
    );
  }
}

function assertNoMergeChainAndNoMergeMisuse(flow) {
  const nodeMap = buildNodeMap(flow);
  const edges = buildEdges(flow);
  const indeg = computeIndegree(edges);

  for (const node of Array.isArray(flow.nodes) ? flow.nodes : []) {
    if (!node || !isNonEmptyString(node.id)) continue;
    if (node.type !== 'merge') continue;

    const inCount = indeg.get(node.id) || 0;
    if (inCount < 2) {
      throw makeNormalizationError(
        'NORMALIZER_MERGE_NOT_FANIN',
        `FlowNormalizer (strict): merge "${node.id}" deve ser fan-in estrutural e ter >=2 entradas (tem ${inCount}).`,
        { nodeId: node.id, inputCount: inCount }
      );
    }

    for (const to of extractTargetsFromNext(node.next)) {
      const target = nodeMap.get(to);
      const targetType = target?.type || null;
      // Regra: merge só pode apontar para end/handoff/merge (destinos estruturais).
      if (targetType && !ALLOWED_MULTIPLE_INPUTS.has(targetType)) {
        throw makeNormalizationError(
          'NORMALIZER_MERGE_INVALID_TARGET',
          `FlowNormalizer (strict): merge "${node.id}" só pode apontar para end/handoff/merge (aponta para "${to}" do tipo "${targetType}").`,
          { from: node.id, to, toType: targetType }
        );
      }
      if (targetType === 'merge') {
        throw makeNormalizationError(
          'NORMALIZER_MERGE_CHAIN',
          `FlowNormalizer (strict): cadeia merge->merge é proibida ("${node.id}" -> "${to}").`,
          { from: node.id, to }
        );
      }
      if (DECISION_NODE_TYPES.has(targetType)) {
        throw makeNormalizationError(
          'NORMALIZER_MERGE_TO_DECISION',
          `FlowNormalizer (strict): merge "${node.id}" não pode apontar para nó decisório "${to}" (tipo "${targetType}").`,
          { from: node.id, to, toType: targetType }
        );
      }
    }
  }
}
 
/**
 * normalizeFlow(flow): retorna novo objeto FlowDefinition normalizado, sem mutar input.
 * @param {FlowDefinition} flow
 * @returns {FlowDefinition}
 */
function normalizeFlow(flow) {
  const out = deepCloneJson(flow);

  if (!out || typeof out !== 'object') {
    throw makeNormalizationError('NORMALIZER_INVALID_FLOW', 'FlowNormalizer (strict): flow inválido (não-objeto).');
  }
  if (!Array.isArray(out.nodes)) {
    throw makeNormalizationError('NORMALIZER_INVALID_NODES', 'FlowNormalizer (strict): flow.nodes deve ser um array.');
  }

  // STRICT: não tenta consertar nada. Apenas valida invariantes estruturais.
  assertNoDuplicateIds(out);
  assertTargetsExist(out);

  const cycle = detectAnyCycle(out);
  if (cycle && cycle.length > 0) {
    throw makeNormalizationError(
      'NORMALIZER_STRUCTURAL_LOOP',
      'FlowNormalizer (strict): ciclo estrutural detectado; loops são proibidos.',
      { cyclePath: cycle }
    );
  }

  assertNoProhibitedFanIn(out);
  assertNoMergeChainAndNoMergeMisuse(out);

  return out;
}
 
module.exports = {
  normalizeFlow,
};

