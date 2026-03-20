/**
 * Flow Validation Routes Handler
 * Handles: POST /flows/validate, POST /flows/preview
 * Manages: Flow structure validation, preview/diff generation
 */

async function handleFlowValidationRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    validateFlow,
    validateFlowStructure,
    addUiMessage,
    flows,
  } = deps;

  if (!pathname.startsWith('/flows') || (pathname !== '/flows/validate' && pathname !== '/flows/preview')) {
    return false;
  }

  // -----------------------------------------------------------------------
  // Validação de fluxo
  // -----------------------------------------------------------------------

  // POST /flows/validate
  if (method === 'POST' && pathname === '/flows/validate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto FlowDefinition');
        return true;
      }

      // Validação estrutural básica primeiro
      const structureValidation = validateFlowStructure(body);
      if (!structureValidation.valid) {
        // ✅ Mapeia erro estrutural também
        const structureError = addUiMessage({
          code: 'INVALID_FLOW_STRUCTURE',
          message: structureValidation.error || 'Estrutura do fluxo inválida',
          nodeIds: [],
        });
        sendJson(res, 200, {
          valid: false,
          errors: [structureError], // ✅ Já vem com messageUi do validator
        });
        return true;
      }

      const result = validateFlow(body);
      
      sendJson(res, 200, {
        valid: Boolean(result && result.valid),
        errors: result.errors || [], // ✅ Já vem com messageUi do validator
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao validar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao validar fluxo' });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Preview / Diff de fluxo (read-only, safe)
  // -----------------------------------------------------------------------
  // POST /flows/preview
  if (method === 'POST' && pathname === '/flows/preview') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const { flow, baseFlowId = null } = body || {};
      if (!flow || typeof flow !== 'object') {
        badRequest(res, 'Campo "flow" é obrigatório e deve ser um FlowDefinition');
        return true;
      }

      const structureValidation = validateFlowStructure(flow);
      if (!structureValidation.valid) {
        sendJson(res, 200, {
          ok: false,
          valid: false,
          errors: [{ code: 'INVALID_FLOW_STRUCTURE', message: structureValidation.error || 'Estrutura do fluxo inválida' }],
        });
        return true;
      }

      function collectEdges(f) {
        const edges = [];
        const nodes = Array.isArray(f.nodes) ? f.nodes : [];
        for (const n of nodes) {
          if (!n || !n.id) continue;
          if (typeof n.next === 'string') edges.push({ from: n.id, to: n.next });
          else if (Array.isArray(n.next)) {
            for (const to of n.next) if (typeof to === 'string') edges.push({ from: n.id, to });
          }
          if (n.type === 'router' && Array.isArray(n?.config?.rules)) {
            for (const r of n.config.rules) if (r && typeof r.next === 'string') edges.push({ from: n.id, to: r.next });
          }
          if (n.type === 'schedule_router' && Array.isArray(n?.config?.schedules)) {
            for (const s of n.config.schedules) if (s && typeof s.next === 'string') edges.push({ from: n.id, to: s.next });
            if (typeof n?.config?.defaultNext === 'string') edges.push({ from: n.id, to: n.config.defaultNext });
          }
        }
        return edges;
      }

      function summarize(f) {
        const nodes = Array.isArray(f.nodes) ? f.nodes : [];
        const edges = collectEdges(f);
        const byType = {};
        for (const n of nodes) {
          const t = n?.type || 'unknown';
          byType[t] = (byType[t] || 0) + 1;
        }
        return {
          id: f.id || null,
          tenantId: f.tenantId || null,
          version: f.version || null,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          nodesByType: byType,
          hasFallback: !!byType.fallback,
          hasApiNode: !!byType.api,
          requiresReview: f?.metadata?.requiresReview === true,
          status: f?.metadata?.status || null,
        };
      }

      const base = baseFlowId ? flows.get(String(baseFlowId)) : null;
      const edges = collectEdges(flow);
      const summary = summarize(flow);
      const diff = base ? (() => {
        const baseEdges = collectEdges(base);
        const baseNodeMap = new Map((base.nodes || []).filter(Boolean).map(n => [n.id, n]));
        const nextNodeMap = new Map((flow.nodes || []).filter(Boolean).map(n => [n.id, n]));

        const addedNodes = [];
        const removedNodes = [];
        const changedNodes = [];

        for (const [id, n] of nextNodeMap.entries()) {
          if (!baseNodeMap.has(id)) addedNodes.push(id);
          else {
            const before = baseNodeMap.get(id);
            if (JSON.stringify(before) !== JSON.stringify(n)) changedNodes.push(id);
          }
        }
        for (const [id] of baseNodeMap.entries()) {
          if (!nextNodeMap.has(id)) removedNodes.push(id);
        }

        const edgeKey = (e) => `${e.from}->${e.to}`;
        const baseSet = new Set(baseEdges.map(edgeKey));
        const nextSet = new Set(edges.map(edgeKey));
        const addedEdges = [];
        const removedEdges = [];
        for (const k of nextSet) if (!baseSet.has(k)) addedEdges.push(k);
        for (const k of baseSet) if (!nextSet.has(k)) removedEdges.push(k);

        return {
          baseFlowId,
          addedNodes,
          removedNodes,
          changedNodes,
          addedEdges,
          removedEdges,
        };
      })() : null;

      sendJson(res, 200, {
        ok: true,
        valid: true,
        summary,
        edges,
        diff,
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao gerar preview/diff do fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar preview/diff do fluxo' });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleFlowValidationRoutes };
