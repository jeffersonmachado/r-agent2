async function handleFlowExecutionRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    requireAuth,
    requireTenant,
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    validateFlow,
    validateFlowStructure,
    addUiMessage,
    flows,
    orchestrateGeneration,
    registerGeneration,
    generateAuditReport,
    STRICT_TENANT_MODE,
    rpaDependencyResolver,
    previewRpaFlowPipeline,
    executeRpaFlowPipeline,
    simulateFlow,
    sessionEvents,
    saveSessionEventsToFile,
    buildConversationReplay,
  } = deps;

  if (!pathname.startsWith('/flows') && pathname !== '/rpa-tests' && !pathname.startsWith('/replay/')) {
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

  // -----------------------------------------------------------------------
  // Geração de fluxo a partir de descrição
  // -----------------------------------------------------------------------

  // POST /flows/generate
  if (method === 'POST' && pathname === '/flows/generate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return true;
      }

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return true;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
        finalTenantId = finalTenantId.trim();
      }

      // Usa orquestrador de geração
      const result = await orchestrateGeneration(body, {
        tenantId: finalTenantId,
        autoResolveDependencies: body.autoResolveDependencies || false,
      });

      if (!result.success) {
        badRequest(res, result.error || 'Erro na orquestração de geração');
        return true;
      }

      // Registra para auditoria
      if (result.metadata) {
        const auditId = await registerGeneration(result.metadata);
        // Armazena auditId para vincular ao relatório
        result.metadata.auditId = auditId;
        const auditReport = await generateAuditReport({ ...result.metadata, auditId }, { format: 'json' });
        result.metadata.auditId = auditId;
        result.metadata.reportId = auditReport.reportId;
      }

      // Compatibilidade: expõe validationWarnings em formato estável para UI/testes
      if (!result.validationWarnings) {
        const flowValidation = result?.validation?.flow || null;
        const validationErrors = Array.isArray(flowValidation?.errors) ? flowValidation.errors : [];
        const codes = validationErrors
          .map((errItem) => (errItem && (errItem.code || errItem.type)) ? String(errItem.code || errItem.type) : null)
          .filter(Boolean);

        result.validationWarnings = {
          valid: flowValidation?.valid !== false,
          errors: validationErrors,
          codes,
        };
      }

      // Retorna resultado completo
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao gerar fluxo:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno ao gerar fluxo' });
      }
    }
    return true;
  }

  // POST /flows/generate/dry-run (Modo DRY-RUN)
  if (method === 'POST' && pathname === '/flows/generate/dry-run') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      if (!body || typeof body !== 'object') {
        badRequest(res, 'Body deve ser um objeto válido');
        return true;
      }

      const authResult = requireAuth(req);
      let finalTenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return true;
        }
        finalTenantId = requireTenant(req, res);
        if (!finalTenantId) return;
      } else {
        finalTenantId = (authResult.valid && req.tenantId) || body.tenantId || null;
        if (!finalTenantId || typeof finalTenantId !== 'string' || finalTenantId.trim() === '') {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
        finalTenantId = finalTenantId.trim();
      }

      // Usa orquestrador em modo DRY-RUN
      const result = await orchestrateGeneration(body, {
        tenantId: finalTenantId,
        dryRun: true,
      });

      if (!result.success) {
        badRequest(res, result.error || 'Erro na orquestração de geração (DRY-RUN)');
        return true;
      }

      // Retorna resultado do DRY-RUN
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro no DRY-RUN de geração:', err);
        sendJson(res, 500, { error: 'internal_error', message: err.message || 'Erro interno no DRY-RUN' });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Geração de teste RPA por IA
  // -----------------------------------------------------------------------

  // POST /flows/:flowId/generate-rpa-test
  if (method === 'POST' && pathname.match(/^\/flows\/([^\/]+)\/generate-rpa-test$/)) {
    const flowIdMatch = pathname.match(/^\/flows\/([^\/]+)\/generate-rpa-test$/);
    const flowId = flowIdMatch ? flowIdMatch[1] : null;

    if (!flowId) {
      badRequest(res, 'flowId é obrigatório na URL');
      return true;
    }

    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    // Declara flowVersion no escopo do try para estar disponível no catch
    let flowVersion = 1;
    
    try {
      const body = await parseJsonBody(req);
      const { version, autoResolveDependencies = false } = body || {};

      // Obtém o fluxo
      const flow = flows.get(flowId);
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return true;
      }

      // Valida versão se fornecida
      flowVersion = version || flow.version || 1;
      if (flow.version && flow.version !== flowVersion) {
        sendJson(res, 400, { error: 'version_mismatch', message: `Versão do fluxo não corresponde. Esperado: ${flow.version}, recebido: ${flowVersion}` });
        return true;
      }

      const authResult = requireAuth(req);
      let tenantId = null;
      if (STRICT_TENANT_MODE) {
        if (!authResult.valid) {
          sendJson(res, 401, { error: 'unauthorized', message: authResult.error });
          return true;
        }
        tenantId = requireTenant(req, res);
        if (!tenantId) return;
        if (flow.tenantId !== tenantId) {
          sendJson(res, 403, { error: 'forbidden', message: 'Fluxo não pertence ao seu tenant' });
          return true;
        }
      } else {
        tenantId = (authResult.valid && req.tenantId) || flow.tenantId || null;
        if (!tenantId) {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
      }

      // Importa serviços
      const { analyzeFlowDependencies, resolveDependencies } = require('../services/rpaTestDependencyAnalyzer');
      const { generateRpaTestFromFlow } = require('../services/rpaTestGeneratorService');

      logger.info('Iniciando geração de teste RPA por IA', { flowId, flowVersion, tenantId });

      // Passo 1: Analisa dependências
      logger.info('Passo 1: Analisando dependências do fluxo', { flowId });
      let dependencies;
      try {
        dependencies = await analyzeFlowDependencies(flow, tenantId);
        logger.debug('Dependências analisadas', {
          hasSeeds: !!dependencies.seeds,
          seedsStructure: dependencies.seeds ? Object.keys(dependencies.seeds) : [],
          missingCount: dependencies.seeds?.missing?.length || 0
        });
      } catch (depError) {
        logger.error('Erro ao analisar dependências', {
          error: depError.message,
          stack: depError.stack,
          flowId
        });
        throw new Error(`Erro ao analisar dependências: ${depError.message}`);
      }

      // Passo 2: Resolve dependências se solicitado
      let resolution = null;
      if (autoResolveDependencies && dependencies.seeds && dependencies.seeds.missing && dependencies.seeds.missing.length > 0) {
        logger.info('Passo 2: Resolvendo dependências faltantes', { 
          flowId,
          missingCount: dependencies.seeds.missing.length 
        });
        try {
          resolution = await resolveDependencies(dependencies, tenantId);
          if (resolution && resolution.executedSeeds && resolution.executedSeeds.length > 0) {
            if (!dependencies.seeds) {
              dependencies.seeds = {};
            }
            dependencies.seeds.executedSeeds = resolution.executedSeeds;
          }
        } catch (resolveError) {
          logger.error('Erro ao resolver dependências', {
            error: resolveError.message,
            stack: resolveError.stack,
            flowId
          });
          // Não falha o processo se a resolução de dependências falhar
          logger.warn('Continuando sem resolver dependências devido a erro');
        }
      }

      // Passo 3: Gera script de teste RPA por IA
      logger.info('Passo 3: Gerando script de teste RPA por IA', { flowId });
      let rpaTest;
      try {
        rpaTest = await generateRpaTestFromFlow(flow, dependencies, {
          tenantId,
          testId: `test-${flowId}-${Date.now()}`,
        });
      } catch (rpaError) {
        logger.error('Erro ao gerar teste RPA', {
          error: rpaError.message,
          stack: rpaError.stack,
          flowId
        });
        throw rpaError;
      }

      // Passo 4: Gate de validação obrigatória (IA nunca executa sem passar por aqui)
      logger.info('Passo 4: Validando plano gerado pelo gate de validação', { flowId });
      const { validateGeneratedPlanOrThrow } = require('../../engine/ai/validateGeneratedPlan');
      try {
        validateGeneratedPlanOrThrow(rpaTest, 'rpa');
        logger.info('Passo 4: Validação do script concluída', { 
          flowId,
          valid: true
        });
      } catch (validationError) {
        logger.error('Gate de validação bloqueou plano RPA gerado', {
          flowId,
          error: validationError.message
        });
        throw new Error(`Validação falhou: ${validationError.message}`);
      }

      // Retorna preview completo (não salva ainda)
      const preview = {
        flowId,
        flowVersion,
        flowName: flow.name,
        dependencies,
        resolution,
        rpaTest,
        readyToSave: !rpaTest.validationWarnings || rpaTest.validationWarnings.valid,
      };

      sendJson(res, 200, preview);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao gerar teste RPA:', {
          error: err.message,
          stack: err.stack,
          flowId,
          flowVersion
        });
        
        // Mensagem de erro mais específica para diferentes tipos de erro
        let errorMessage = 'Erro interno ao gerar teste RPA';
        let errorDetails = err.message;
        
        if (err.message && err.message.includes('Serviço de IA não está disponível')) {
          errorMessage = 'Serviço de IA não disponível';
          errorDetails = 'O serviço de IA não está configurado ou não está disponível no momento. Verifique a configuração da IA e tente novamente.';
        } else if (err.message && err.message.includes('parsear resposta da IA')) {
          errorMessage = 'Erro ao processar resposta da IA';
          errorDetails = 'A resposta da IA não está em formato JSON válido. Tente novamente ou verifique a configuração da IA.';
        } else if (err.message && err.message.includes('Resposta da IA não contém texto')) {
          errorMessage = 'Resposta inválida da IA';
          errorDetails = 'A IA não retornou uma resposta válida. Verifique a configuração da IA.';
        }
        
        sendJson(res, 500, { 
          error: 'internal_error', 
          message: errorMessage, 
          details: errorDetails 
        });
      }
    }
    return true;
  }

  // POST /rpa-tests (salvar teste RPA gerado)
  if (method === 'POST' && pathname === '/rpa-tests') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { rpaTest } = body || {};

      if (!rpaTest || !rpaTest.id) {
        badRequest(res, 'Campo "rpaTest" é obrigatório e deve ter um "id"');
        return true;
      }

      // Gate de validação obrigatória (IA nunca executa sem passar por aqui)
      // ARQUITETURA: RAG define LIMITES | Schema valida FORMA | Gate valida SEMÂNTICA
      // TODO conteúdo gerado por IA passa por este gate antes de qualquer execução
      const { validateGeneratedPlanOrThrow } = require('../../engine/ai/validateGeneratedPlan');
      try {
        validateGeneratedPlanOrThrow(rpaTest, 'rpa');
      } catch (validationError) {
        logger.error('Gate de validação bloqueou plano RPA', {
          testId: rpaTest.id,
          error: validationError.message
        });
        badRequest(res, `Validação falhou: ${validationError.message}`);
        return true;
      }

      // Salva o teste RPA em arquivo
      const fs = require('fs');
      const path = require('path');
      // UNIFICADO: Tudo salva em /seeds/
      const seedsDir = path.join(__dirname, '../../tests/rpa/seeds');
      
      if (!fs.existsSync(seedsDir)) {
        fs.mkdirSync(seedsDir, { recursive: true });
      }

      // Adiciona flag source: automatic
      if (!rpaTest.source) {
        rpaTest.source = 'automatic';
      }

      const testFilePath = path.join(seedsDir, `${rpaTest.id}.json`);
      fs.writeFileSync(testFilePath, JSON.stringify(rpaTest, null, 2), 'utf8');

      logger.info('Teste RPA salvo com sucesso', { testId: rpaTest.id, filePath: testFilePath });

      sendJson(res, 200, {
        success: true,
        testId: rpaTest.id,
        filePath: testFilePath,
        message: 'Teste RPA salvo com sucesso',
      });
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else {
        logger.error('Erro ao salvar teste RPA:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao salvar teste RPA', details: err.message });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Simulação de fluxo
  // -----------------------------------------------------------------------

  // POST /flows/simulate
  if (method === 'POST' && pathname === '/flows/simulate') {
    // Valida Content-Type para requisições com body
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { flowId, ...options } = body || {};

      if (!flowId || typeof flowId !== 'string' || flowId.trim() === '') {
        badRequest(res, 'Campo "flowId" é obrigatório e deve ser uma string não vazia');
        return true;
      }

      // Validação de opções
      if (options.maxSteps !== undefined) {
        if (typeof options.maxSteps !== 'number' || !Number.isInteger(options.maxSteps) || options.maxSteps < 1 || options.maxSteps > 1000) {
          badRequest(res, 'Campo "maxSteps" deve ser um número inteiro entre 1 e 1000');
          return true;
        }
      }

      const flow = flows.get(flowId.trim());
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return true;
      }

      // Valida o fluxo antes de simular
      const validationResult = validateFlow(flow);
      if (!validationResult.valid && validationResult.errors.length > 0) {
        sendJson(res, 400, {
          error: 'flow_invalid',
          message: 'O fluxo não passou na validação e não pode ser simulado',
          errors: validationResult.errors,
        });
        return true;
      }

      const result = await simulateFlow(flow, options || {});

      // Guarda eventos por sessão para permitir /replay/:sessionId
      const sessionId =
        result &&
        result.replay &&
        typeof result.replay.sessionId === 'string'
          ? result.replay.sessionId
          : null;

      if (sessionId) {
        sessionEvents.set(sessionId, Array.isArray(result.events) ? result.events : []);
        // Salva conversas após adicionar eventos
        saveSessionEventsToFile();
      }

      // Retorna resultado completo da simulação (SimulationResultUi)
      sendJson(res, 200, result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        badRequest(res, 'JSON inválido no corpo da requisição');
      } else if (err.message && err.message.includes('excede o tamanho máximo')) {
        badRequest(res, err.message);
      } else {
        logger.error('Erro ao simular fluxo', err);
        sendJson(res, 500, {
          error: 'simulation_error',
          message: err && err.message ? err.message : 'Erro interno ao simular fluxo',
        });
      }
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // RPA Flow Pipeline - Resolução de Dependências e Conversão
  // -----------------------------------------------------------------------

  // POST /flows/:id/resolve-dependencies
  if (method === 'POST' && pathname.match(/^\/flows\/[^\/]+\/resolve-dependencies$/)) {
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
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);
      
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return true;
      }

      const tenantId = flow.tenantId || req.tenantId;
      const resolution = await rpaDependencyResolver.resolveDependencies(flow, tenantId);

      sendJson(res, 200, resolution);
    } catch (err) {
      logger.error('Erro ao resolver dependências:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao resolver dependências' });
    }
    return true;
  }

  // POST /flows/:id/preview-rpa
  if (method === 'POST' && pathname.match(/^\/flows\/[^\/]+\/preview-rpa$/)) {
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
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);
      
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return true;
      }

      const preview = await previewRpaFlowPipeline(flow);

      sendJson(res, 200, preview);
    } catch (err) {
      logger.error('Erro ao gerar preview RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar preview RPA' });
    }
    return true;
  }

  // POST /flows/:id/generate-rpa
  if (method === 'POST' && pathname.match(/^\/flows\/[^\/]+\/generate-rpa$/)) {
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
      const flowId = pathname.split('/')[2];
      const flow = flows.get(flowId);
      
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" não encontrado` });
        return true;
      }

      const options = {
        autoExecuteSeeds: body.autoExecuteSeeds || false,
        saveRecording: body.saveRecording !== false,
      };

      const result = await executeRpaFlowPipeline(flow, options);

      if (result.success) {
        sendJson(res, 200, result);
      } else {
        sendJson(res, 400, result);
      }
    } catch (err) {
      logger.error('Erro ao gerar gravação RPA:', err);
      sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao gerar gravação RPA' });
    }
    return true;
  }

  // -----------------------------------------------------------------------
  // Replay
  // -----------------------------------------------------------------------

  // GET /replay/:sessionId
  if (method === 'GET' && pathname.startsWith('/replay/')) {
    const sessionId = decodeURIComponent(pathname.slice('/replay/'.length));
    const events = sessionEvents.get(sessionId);
    if (!events) {
      sendJson(res, 404, { error: 'session_not_found' });
      return true;
    }

    const replay = buildConversationReplay(events);
    sendJson(res, 200, replay);
    return true;
  }

  return false;
}

module.exports = { handleFlowExecutionRoutes };
