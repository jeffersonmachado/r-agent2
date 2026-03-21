/**
 * RPA Test Generation Routes Handler
 * Handles: POST /flows/:flowId/generate-rpa-test, POST /rpa-tests
 * Manages: AI-driven RPA test generation, dependency resolution, gate validation, file persistence
 */

async function handleRpaTestGenerationRoutes(ctx) {
  const { req, res, method, pathname, deps } = ctx;
  const {
    sendJson,
    badRequest,
    hasJsonContentType,
    parseJsonBody,
    logger,
    flows,
    requireAuth,
    requireTenant,
    STRICT_TENANT_MODE,
  } = deps;

  if (!pathname.startsWith('/flows/') || (!pathname.match(/^\/flows\/([^/]+)\/generate-rpa-test$/) && pathname !== '/rpa-tests')) {
    return false;
  }

  if (method === 'POST' && pathname.match(/^\/flows\/([^/]+)\/generate-rpa-test$/)) {
    const flowIdMatch = pathname.match(/^\/flows\/([^/]+)\/generate-rpa-test$/);
    const flowId = flowIdMatch ? flowIdMatch[1] : null;

    if (!flowId) {
      badRequest(res, 'flowId e obrigatorio na URL');
      return true;
    }

    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    let flowVersion = 1;

    try {
      const body = await parseJsonBody(req);
      const { version, autoResolveDependencies = false } = body || {};

      const flow = flows.get(flowId);
      if (!flow) {
        sendJson(res, 404, { error: 'flow_not_found', message: `Fluxo com id "${flowId}" nao encontrado` });
        return true;
      }

      flowVersion = version || flow.version || 1;
      if (flow.version && flow.version !== flowVersion) {
        sendJson(res, 400, { error: 'version_mismatch', message: `Versao do fluxo nao corresponde. Esperado: ${flow.version}, recebido: ${flowVersion}` });
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
        if (!tenantId) return true;
        if (flow.tenantId !== tenantId) {
          sendJson(res, 403, { error: 'forbidden', message: 'Fluxo nao pertence ao seu tenant' });
          return true;
        }
      } else {
        tenantId = (authResult.valid && req.tenantId) || flow.tenantId || null;
        if (!tenantId) {
          sendJson(res, 403, { error: 'tenant_required' });
          return true;
        }
      }

      const { analyzeFlowDependencies, resolveDependencies } = require('../../../services/rpaTestDependencyAnalyzer');
      const { generateRpaTestFromFlow } = require('../../../services/rpaTestGeneratorService');

      logger.info('Iniciando geracao de teste RPA por IA', { flowId, flowVersion, tenantId });

      logger.info('Passo 1: Analisando dependencias do fluxo', { flowId });
      let dependencies;
      try {
        dependencies = await analyzeFlowDependencies(flow, tenantId);
        logger.debug('Dependencias analisadas', {
          hasSeeds: !!dependencies.seeds,
          seedsStructure: dependencies.seeds ? Object.keys(dependencies.seeds) : [],
          missingCount: dependencies.seeds?.missing?.length || 0,
        });
      } catch (depError) {
        logger.error('Erro ao analisar dependencias', {
          error: depError.message,
          stack: depError.stack,
          flowId,
        });
        throw new Error(`Erro ao analisar dependencias: ${depError.message}`);
      }

      let resolution = null;
      if (autoResolveDependencies && dependencies.seeds && dependencies.seeds.missing && dependencies.seeds.missing.length > 0) {
        logger.info('Passo 2: Resolvendo dependencias faltantes', {
          flowId,
          missingCount: dependencies.seeds.missing.length,
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
          logger.error('Erro ao resolver dependencias', {
            error: resolveError.message,
            stack: resolveError.stack,
            flowId,
          });
          logger.warn('Continuando sem resolver dependencias devido a erro');
        }
      }

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
          flowId,
        });
        throw rpaError;
      }

      logger.info('Passo 4: Validando plano gerado pelo gate de validacao', { flowId });
      const { validateGeneratedPlanOrThrow } = require('../../../engine/ai/validateGeneratedPlan');
      try {
        validateGeneratedPlanOrThrow(rpaTest, 'rpa');
        logger.info('Passo 4: Validacao do script concluida', {
          flowId,
          valid: true,
        });
      } catch (validationError) {
        logger.error('Gate de validacao bloqueou plano RPA gerado', {
          flowId,
          error: validationError.message,
        });
        throw new Error(`Validacao falhou: ${validationError.message}`);
      }

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
        badRequest(res, 'JSON invalido no corpo da requisicao');
      } else {
        logger.error('Erro ao gerar teste RPA:', {
          error: err.message,
          stack: err.stack,
          flowId,
          flowVersion,
        });

        let errorMessage = 'Erro interno ao gerar teste RPA';
        let errorDetails = err.message;

        if (err.message && err.message.includes('Servico de IA nao esta disponivel')) {
          errorMessage = 'Servico de IA nao disponivel';
          errorDetails = 'O servico de IA nao esta configurado ou nao esta disponivel no momento. Verifique a configuracao da IA e tente novamente.';
        } else if (err.message && err.message.includes('parsear resposta da IA')) {
          errorMessage = 'Erro ao processar resposta da IA';
          errorDetails = 'A resposta da IA nao esta em formato JSON valido. Tente novamente ou verifique a configuracao da IA.';
        } else if (err.message && err.message.includes('Resposta da IA nao contem texto')) {
          errorMessage = 'Resposta invalida da IA';
          errorDetails = 'A IA nao retornou uma resposta valida. Verifique a configuracao da IA.';
        }

        sendJson(res, 500, {
          error: 'internal_error',
          message: errorMessage,
          details: errorDetails,
        });
      }
    }
    return true;
  }

  if (method === 'POST' && pathname === '/rpa-tests') {
    if (!hasJsonContentType(req)) {
      badRequest(res, 'Content-Type deve ser application/json');
      return true;
    }

    try {
      const body = await parseJsonBody(req);
      const { rpaTest } = body || {};

      if (!rpaTest || !rpaTest.id) {
        badRequest(res, 'Campo "rpaTest" e obrigatorio e deve ter um "id"');
        return true;
      }

      const { validateGeneratedPlanOrThrow } = require('../../../engine/ai/validateGeneratedPlan');
      try {
        validateGeneratedPlanOrThrow(rpaTest, 'rpa');
      } catch (validationError) {
        logger.error('Gate de validacao bloqueou plano RPA', {
          testId: rpaTest.id,
          error: validationError.message,
        });
        badRequest(res, `Validacao falhou: ${validationError.message}`);
        return true;
      }

      const fs = require('fs');
      const path = require('path');
      const seedsDir = path.join(__dirname, '../../../../tests/rpa/seeds');

      if (!fs.existsSync(seedsDir)) {
        fs.mkdirSync(seedsDir, { recursive: true });
      }

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
        badRequest(res, 'JSON invalido no corpo da requisicao');
      } else {
        logger.error('Erro ao salvar teste RPA:', err);
        sendJson(res, 500, { error: 'internal_error', message: 'Erro interno ao salvar teste RPA', details: err.message });
      }
    }
    return true;
  }

  return false;
}

module.exports = { handleRpaTestGenerationRoutes };
