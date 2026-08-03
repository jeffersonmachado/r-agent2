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
    requireAuth,
    validateFlow,
    validateFlowStructure,
    addUiMessage,
    flows,
  } = deps;

  if (!pathname.startsWith('/flows') || (pathname !== '/flows/validate' && pathname !== '/flows/preview')) {
    return false;
  }

  if (method === 'POST' && pathname === '/flows/validate') {
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

      const structureValidation = validateFlowStructure(body);
      if (!structureValidation.valid) {
        const structureError = addUiMessage({
          code: 'INVALID_FLOW_STRUCTURE',
          message: structureValidation.error || 'Estrutura do fluxo invalida',
          nodeIds: [],
        });
        sendJson(res, 200, {
          valid: false,
          errors: [structureError],
        });
        return true;
      }

      const result = validateFlow(body);

      sendJson(res, 200, {
        valid: Boolean(result && result.valid),
        errors: result.errors || [],
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON invalido no corpo da requisicao');
      } else if (err.message && err.message.includes('excede o tamanho maximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao validar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao validar fluxo' });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname === '/flows/preview') {
    // baseFlowId lê fluxo persistido do tenant — exige autenticação ANTES de
    // qualquer acesso ao store (vazamento estrutural observado em 2026-08-03).
    const authResult = requireAuth(req);
    if (!authResult.valid) {
      sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
      return true;
    }
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }
    try {
      const body = await parseJsonBody(req);
      const { flow, baseFlowId = null } = body || {};
      if (!flow || typeof flow !== 'object') {
        badRequest(res, 'Campo "flow" e obrigatorio e deve ser um FlowDefinition');
        return true;
      }

      const structureValidation = validateFlowStructure(flow);
      if (!structureValidation.valid) {
        sendJson(res, 200, {
          ok: false,
          valid: false,
          errors: [{ code: 'INVALID_FLOW_STRUCTURE', message: structureValidation.error || 'Estrutura do fluxo invalida' }],
        });
        return true;
      }

      function collectEdges(currentFlow) {
        const edges = [];
        const nodes = Array.isArray(currentFlow.nodes) ? currentFlow.nodes : [];
        for (const node of nodes) {
          if (!node || !node.id) continue;
          if (typeof node.next === 'string') edges.push({ from: node.id, to: node.next });
          else if (Array.isArray(node.next)) {
            for (const to of node.next) if (typeof to === 'string') edges.push({ from: node.id, to });
          }
          if (node.type === 'router' && Array.isArray(node?.config?.rules)) {
            for (const rule of node.config.rules) if (rule && typeof rule.next === 'string') edges.push({ from: node.id, to: rule.next });
          }
          if (node.type === 'schedule_router' && Array.isArray(node?.config?.schedules)) {
            for (const schedule of node.config.schedules) if (schedule && typeof schedule.next === 'string') edges.push({ from: node.id, to: schedule.next });
            if (typeof node?.config?.defaultNext === 'string') edges.push({ from: node.id, to: node.config.defaultNext });
          }
        }
        return edges;
      }

      function summarize(currentFlow) {
        const nodes = Array.isArray(currentFlow.nodes) ? currentFlow.nodes : [];
        const edges = collectEdges(currentFlow);
        const byType = {};
        for (const node of nodes) {
          const nodeType = node?.type || 'unknown';
          byType[nodeType] = (byType[nodeType] || 0) + 1;
        }
        return {
          id: currentFlow.id || null,
          tenantId: currentFlow.tenantId || null,
          version: currentFlow.version || null,
          nodeCount: nodes.length,
          edgeCount: edges.length,
          nodesByType: byType,
          hasFallback: !!byType.fallback,
          hasApiNode: !!byType.api,
          requiresReview: currentFlow?.metadata?.requiresReview === true,
          status: currentFlow?.metadata?.status || null,
        };
      }

      const base = baseFlowId ? flows.get(String(baseFlowId)) : null;
      const edges = collectEdges(flow);
      const summary = summarize(flow);
      const diff = base ? (() => {
        const baseEdges = collectEdges(base);
        const baseNodeMap = new Map((base.nodes || []).filter(Boolean).map((node) => [node.id, node]));
        const nextNodeMap = new Map((flow.nodes || []).filter(Boolean).map((node) => [node.id, node]));

        const addedNodes = [];
        const removedNodes = [];
        const changedNodes = [];

        for (const [id, node] of nextNodeMap.entries()) {
          if (!baseNodeMap.has(id)) addedNodes.push(id);
          else {
            const before = baseNodeMap.get(id);
            if (JSON.stringify(before) !== JSON.stringify(node)) changedNodes.push(id);
          }
        }
        for (const [id] of baseNodeMap.entries()) {
          if (!nextNodeMap.has(id)) removedNodes.push(id);
        }

        const edgeKey = (edge) => `${edge.from}->${edge.to}`;
        const baseSet = new Set(baseEdges.map(edgeKey));
        const nextSet = new Set(edges.map(edgeKey));
        const addedEdges = [];
        const removedEdges = [];
        for (const key of nextSet) if (!baseSet.has(key)) addedEdges.push(key);
        for (const key of baseSet) if (!nextSet.has(key)) removedEdges.push(key);

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
        badRequest(res, 'JSON invalido no corpo da requisicao');
      } else if (err.message && err.message.includes('excede o tamanho maximo')) {
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
