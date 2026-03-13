/**
 * Validador de fluxos de VOZ/URA (kind=voice).
 *
 * Objetivo:
 * - Validar regras estruturais mínimas para execução via ARI runtime
 * - Não impor regras específicas de chatbot (ex.: fallback obrigatório)
 *
 * Retorno segue o padrão usado pelo editor/backend:
 * { valid: boolean, errors: Array<{code,message,messageUi,severity,nodeIds?,details?}> }
 */

function err(code, message, messageUi, nodeIds = [], severity = 'error', details = undefined) {
  const e = { code, message, messageUi, severity, nodeIds };
  if (details) e.details = details;
  return e;
}

function collectEdges(flow) {
  const edges = [];
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  for (const n of nodes) {
    if (!n || !n.id) continue;
    const from = String(n.id);
    const next = n.next;
    if (typeof next === 'string') edges.push({ from, to: String(next) });
    else if (Array.isArray(next)) {
      for (const to of next) if (typeof to === 'string') edges.push({ from, to: String(to) });
    } else if (next && typeof next === 'object') {
      for (const to of Object.values(next)) {
        if (typeof to === 'string') edges.push({ from, to: String(to) });
        else if (Array.isArray(to)) for (const x of to) if (typeof x === 'string') edges.push({ from, to: String(x) });
      }
    }

    // voice_branch pode ter rules similares ao router
    if ((n.type === 'router' || n.type === 'voice_branch') && Array.isArray(n?.config?.rules)) {
      for (const r of n.config.rules) if (r && typeof r.next === 'string') edges.push({ from, to: String(r.next) });
      if (typeof n?.config?.defaultNext === 'string') edges.push({ from, to: String(n.config.defaultNext) });
    }
  }
  return edges;
}

function detectCycle(nodes, edges) {
  const out = new Map();
  for (const { from, to } of edges) {
    if (!out.has(from)) out.set(from, []);
    out.get(from).push(to);
  }
  const visited = new Set();
  const stack = new Set();
  const parent = new Map();

  function dfs(u) {
    visited.add(u);
    stack.add(u);
    for (const v of out.get(u) || []) {
      if (!visited.has(v)) {
        parent.set(v, u);
        const cyc = dfs(v);
        if (cyc) return cyc;
      } else if (stack.has(v)) {
        // reconstrói ciclo
        const cycle = [v];
        let cur = u;
        while (cur && cur !== v) {
          cycle.push(cur);
          cur = parent.get(cur);
        }
        cycle.push(v);
        cycle.reverse();
        return cycle;
      }
    }
    stack.delete(u);
    return null;
  }

  for (const n of nodes) {
    const id = String(n.id);
    if (!visited.has(id)) {
      const cyc = dfs(id);
      if (cyc) return cyc;
    }
  }
  return null;
}

function validateVoiceFlow(flow) {
  const errors = [];
  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];

  const allowedTypes = new Set([
    'start',
    'merge',
    'end',
    'router',
    // Voice nodes
    'voice_prompt_listen',
    'voice_listen_asr',
    'voice_gather_dtmf',
    'voice_branch',
    'voice_transfer_ramal',
    'voice_transfer_fila',
    'voice_transfer_utils',
    'voice_hangup',
  ]);

  // IDs únicos
  const ids = new Set();
  for (const n of nodes) {
    const id = String(n?.id || '').trim();
    if (!id) {
      errors.push(err(
        'VOICE_NODE_MISSING_ID',
        'Nó sem id',
        'Existe um nó sem identificador (id). Remova e crie novamente.',
        [],
        'error'
      ));
      continue;
    }
    if (ids.has(id)) {
      errors.push(err(
        'VOICE_DUPLICATE_NODE_ID',
        `ID de nó duplicado: ${id}`,
        `Existe mais de um nó com o mesmo id: "${id}".`,
        [id],
        'error'
      ));
    }
    ids.add(id);
  }

  // Start
  const startNodes = nodes.filter((n) => n && n.type === 'start');
  if (startNodes.length !== 1) {
    errors.push(err(
      'VOICE_START_NODE_COUNT',
      `Fluxo de voz deve ter exatamente 1 nó start (encontrado: ${startNodes.length})`,
      'Fluxo de voz deve ter exatamente 1 nó de Início (start).',
      [],
      'error',
      { count: startNodes.length }
    ));
  }
  const start = startNodes[0];
  if (start) {
    const startNext = start.next;
    const hasNext = typeof startNext === 'string' || (Array.isArray(startNext) && startNext.length > 0) || (startNext && typeof startNext === 'object');
    if (!hasNext) {
      errors.push(err(
        'VOICE_START_MISSING_NEXT',
        'Nó start sem saída (next)',
        'O nó de início precisa estar conectado ao próximo nó.',
        [String(start.id)],
        'error'
      ));
    }
  }

  // Tipos suportados
  for (const n of nodes) {
    if (!n) continue;
    const t = String(n.type || '').trim();
    if (!allowedTypes.has(t)) {
      errors.push(err(
        'VOICE_UNSUPPORTED_NODE_TYPE',
        `Tipo de nó não suportado em voice: ${t}`,
        `Tipo de nó "${t}" não é suportado em fluxo de voz.`,
        [String(n.id || '')],
        'error',
        { type: t }
      ));
    }
  }

  // Referências existentes
  const edges = collectEdges(flow);
  for (const { from, to } of edges) {
    if (!ids.has(to)) {
      errors.push(err(
        'VOICE_MISSING_NODE_REFERENCE',
        `Referência para nó inexistente: ${from} -> ${to}`,
        `O fluxo referencia um nó que não existe: "${to}".`,
        [String(from), String(to)],
        'error'
      ));
    }
  }

  // Alcance
  if (start && ids.has(String(start.id))) {
    const out = new Map();
    for (const { from, to } of edges) {
      if (!out.has(from)) out.set(from, []);
      out.get(from).push(to);
    }
    const reachable = new Set([String(start.id)]);
    const q = [String(start.id)];
    while (q.length) {
      const u = q.shift();
      for (const v of out.get(u) || []) {
        if (!reachable.has(v)) {
          reachable.add(v);
          q.push(v);
        }
      }
    }
    const orphan = Array.from(ids).filter((id) => !reachable.has(id));
    if (orphan.length) {
      errors.push(err(
        'VOICE_ORPHAN_NODE',
        `Nós não alcançáveis a partir do start: ${orphan.join(', ')}`,
        `Existem nós órfãos (não conectados ao início): ${orphan.join(', ')}.`,
        orphan,
        'error'
      ));
    }
  }

  // Terminação: folhas precisam ser terminal/transfer
  const outCount = new Map();
  for (const { from } of edges) outCount.set(from, (outCount.get(from) || 0) + 1);
  const terminals = new Set(['voice_hangup', 'end', 'voice_transfer_ramal', 'voice_transfer_fila', 'voice_transfer_utils']);
  for (const n of nodes) {
    if (!n || !n.id) continue;
    const id = String(n.id);
    const outgoing = outCount.get(id) || 0;
    if (outgoing === 0 && !terminals.has(String(n.type))) {
      errors.push(err(
        'VOICE_PATH_WITHOUT_TERMINATION',
        `Nó sem saída em fluxo de voz: ${id} (${n.type})`,
        `O nó "${id}" não tem saída. Todo caminho deve terminar em Hangup/Transferência/Fim.`,
        [id],
        'error',
        { type: n.type }
      ));
    }
  }

  // Loops: warning (permitidos, mas sinaliza)
  const cycle = detectCycle(nodes, edges);
  if (cycle && cycle.length) {
    errors.push(err(
      'VOICE_STRUCTURAL_LOOP',
      `Loop detectado: ${cycle.join(' -> ')}`,
      `Loop detectado no fluxo: ${cycle.join(' -> ')}. Verifique se isso é intencional (retries).`,
      cycle,
      'warning',
      { cycle }
    ));
  }

  const blocking = errors.some((e) => String(e.severity || 'error').toLowerCase() === 'error');
  return { valid: !blocking, errors };
}

module.exports = { validateVoiceFlow };

