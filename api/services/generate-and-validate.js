/**
 * Orquestrador Único - generate-and-validate
 * 
 * Este é o único ponto de entrada para geração, validação e execução.
 * Tudo deve passar por este orquestrador.
 * 
 * RESPONSABILIDADES:
 * 1. Validar payload contra contrato
 * 2. Validar governança
 * 3. Montar contexto (RAG / scraping)
 * 4. Executar IA (ou simular se DRY-RUN)
 * 5. Gerar artefatos (fluxo, seed, teste RPA)
 * 6. Executar RPA
 * 7. Retornar veredito final
 * 
 * REGRAS CRÍTICAS:
 * - DRY-RUN: IA simulada, nada persistido
 * - BOOTSTRAP REAL: Nenhuma persistência antes do RPA, rollback total em falha
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../utils/logger');
const { validateGenerationContract } = require('../utils/contractValidator');
const { orchestrateGeneration } = require('./generationOrchestrator');
const { validateFlow } = require('../../engine/validator');
const { saveFlowToFile, removeFlowFromFile } = require('./generationOrchestrator');
const { enforceRateLimit } = require('../../infra/rate-limit');
const { createExecutionContext, updateStage, updateStatus, toProgressFormat } = require('./pipelineExecutionContext');
const { advancePipeline } = require('./pipelineOrchestrator');

// Cache de execuções em andamento (proteção reentrante)
const runningExecutions = new Map();

/**
 * Executa validação de governança.
 * 
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
async function validateGovernance() {
  try {
    // Validação básica de governança
    // Em produção, isso pode chamar ferramentas de governança específicas
    return { valid: true, errors: [] };
  } catch (err) {
    logger.error('Erro na validação de governança', err);
    return { valid: false, errors: [err.message] };
  }
}

/**
 * Executa validação de schema.
 * 
 * @param {Object} flow - Fluxo a ser validado
 * @returns {Promise<{valid: boolean, errors: string[]}>}
 */
async function validateSchema(flow) {
  try {
    const validation = validateFlow(flow);
    return {
      valid: validation.valid,
      errors: validation.errors.map(e => e.message || e.code),
    };
  } catch (err) {
    logger.error('Erro na validação de schema', err);
    return { valid: false, errors: [err.message] };
  }
}

/**
 * Executa teste RPA específico.
 * 
 * @param {string} rpaTestPath - Caminho do arquivo de teste RPA
 * @returns {Promise<{success: boolean, error?: string, reportPath?: string}>}
 */
async function executeRpaTest(rpaTestPath) {
  try {
    logger.info('Executando teste RPA', { rpaTestPath });

    // Executa o teste RPA usando o runner existente
    const { RpaTestRunner } = require('../../tests/rpa/rpaTestRunner');
    const runner = new RpaTestRunner({
      headless: true,
    });

    await runner.init();

    try {
      // Carrega o teste
      const testContent = fs.readFileSync(rpaTestPath, 'utf8');
      const testData = JSON.parse(testContent);

      // Executa o teste
      // O playback aceita string (nome) ou objeto (dados completos)
      const result = await runner.playback(testData, {});

      await runner.close();

      if (result.success) {
        // Gera relatório usando o método do runner
        const report = runner.generateReport();
        const reportPath = path.join(
          __dirname,
          '..',
          '..',
          'tests',
          'rpa',
          'reports',
          `rpa-report-${Date.now()}.json`
        );

        // Garante que o diretório existe
        const reportsDir = path.dirname(reportPath);
        if (!fs.existsSync(reportsDir)) {
          fs.mkdirSync(reportsDir, { recursive: true });
        }

        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

        return {
          success: true,
          reportPath,
          replayPath: result.replayPath || null,
          replayId: result.replayId || null,
        };
      } else {
        return {
          success: false,
          error: result.message || result.error || 'Teste RPA falhou',
          replayPath: result.replayPath || null,
          replayId: result.replayId || null,
        };
      }
    } catch (err) {
      await runner.close();
      throw err;
    }
  } catch (err) {
    logger.error('Erro ao executar teste RPA', err);
    return {
      success: false,
      error: err.message || 'Erro desconhecido ao executar teste RPA',
    };
  }
}

/**
 * Executa system:validate completo.
 * 
 * @returns {Promise<{success: boolean, errors: string[]}>}
 */
async function executeSystemValidate() {
  try {
    logger.info('Executando system:validate completo');
    
    const ROOT_DIR = path.join(__dirname, '..', '..');
    execSync('npm run system:validate', {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      encoding: 'utf8',
      timeout: 300000, // 5 minutos
    });

    return { success: true, errors: [] };
  } catch (err) {
    logger.error('system:validate falhou', err);
    return {
      success: false,
      errors: [err.message || 'system:validate falhou'],
    };
  }
}

/**
 * Gera seed base (se necessário).
 * 
 * @param {Object} flow - Fluxo gerado
 * @param {Object} options - Opções
 * @returns {Promise<{success: boolean, seedPath?: string}>}
 */
async function generateSeed(flow, options = {}) {
  try {
    // Por enquanto, apenas simula geração de seed
    // Em produção, isso pode chamar scripts de seed específicos
    logger.info('Gerando seed base', { flowId: flow.id });
    
    return {
      success: true,
      seedPath: null, // Seed será gerado em produção
    };
  } catch (err) {
    logger.error('Erro ao gerar seed', err);
    return {
      success: false,
    };
  }
}

/**
 * Orquestra geração e validação completa.
 * 
 * @param {Object} payload - Payload completo
 * @param {Object} options - Opções adicionais
 * @param {Function} onProgress - Callback para atualizar progresso (opcional)
 * @returns {Promise<Object>} Resultado completo
 */
async function generateAndValidate(payload, options = {}, onProgress = null) {
  const startTime = Date.now();
  const executionMode = payload.executionMode || 'dry-run';
  const isDryRun = executionMode === 'dry-run';
  const isBootstrap = payload.bootstrap === true;

  // Cria Execution Context
  const execution = createExecutionContext(payload, options);

  // Proteção reentrante: verifica se já existe uma execução em andamento
  // Usa executionId como chave única
  const executionKey = execution.executionId;
  if (runningExecutions.has(executionKey)) {
    logger.warn(`[Pipeline][${execution.executionId}] Execução já em andamento, ignorando chamada duplicada`);
    return {
      success: false,
      errors: ['Execução já em andamento'],
      motivo: 'Execução duplicada detectada',
      executionId: execution.executionId,
    };
  }

  // Verifica se há outra execução em andamento para o mesmo payload (proteção adicional)
  // Compara payload.name e tenantId para evitar execuções simultâneas do mesmo sistema
  const payloadKey = `${payload.name}-${options.tenantId || 'default'}`;
  for (const [key, existingExecution] of runningExecutions.entries()) {
    if (existingExecution.payload.name === payload.name && 
        (existingExecution.options.tenantId || 'default') === (options.tenantId || 'default') &&
        existingExecution.status === 'running') {
      logger.warn(`[Pipeline][${execution.executionId}] Execução similar já em andamento`, {
        existingExecutionId: existingExecution.executionId,
        payloadKey,
      });
      return {
        success: false,
        errors: ['Execução similar já em andamento'],
        motivo: 'Execução duplicada detectada',
        executionId: execution.executionId,
      };
    }
  }

  // Marca como em execução
  runningExecutions.set(executionKey, execution);

  logger.info(`[Pipeline][${execution.executionId}] Iniciando generate-and-validate`, {
    name: payload.name,
    executionMode,
    bootstrap: isBootstrap,
  });

  const result = {
    success: false,
    rpaPassed: false,
    flowGenerated: false,
    seedGenerated: false,
    rpaGenerated: false,
    rpaExecuted: false,
    warnings: [],
    errors: [],
    motivo: null,
    replayLink: null,
    reportLink: null,
    executionId: execution.executionId,
  };

  // Artefatos gerados (para rollback se necessário)
  const artifacts = {
    flowId: null,
    flowPath: null,
    rpaTestPath: null,
    seedPath: null,
  };

  // Callback wrapper que inclui executionId
  const progressCallback = (progress) => {
    if (onProgress) {
      onProgress({
        ...progress,
        executionId: execution.executionId,
      });
    }
  };

  try {
    // ETAPA 0: Rate Limiting (ANTES de qualquer coisa)
    logger.info(`[Pipeline][${execution.executionId}] ETAPA 0: Verificando rate limiting`);
    try {
      // Identifica tipo de operação
      // Prioriza BOOTSTRAP sobre DRY_RUN porque é mais restritivo
      let operationType;
      if (isBootstrap) {
        operationType = 'BOOTSTRAP';
      } else if (isDryRun) {
        operationType = 'DRY_RUN';
      } else {
        operationType = 'GENERATION_REAL';
      }

      // Identifica usuário (ou sessão)
      const userId = options.userId || options.tenantId || 'anonymous';

      logger.info(`[Pipeline][${execution.executionId}] Aplicando rate limiting`, { 
        userId, 
        operationType, 
        isBootstrap, 
        isDryRun,
        executionMode 
      });

      // Aplica rate limiting
      await enforceRateLimit({
        userId,
        operationType,
      });

      logger.info(`[Pipeline][${execution.executionId}] Rate limiting aprovado`, { userId, operationType });
    } catch (rateLimitError) {
      if (rateLimitError.code === 'RATE_LIMIT_EXCEEDED') {
        // Garante que retryAfter é um número válido
        const retryAfter = (rateLimitError.retryAfter && !isNaN(rateLimitError.retryAfter) && rateLimitError.retryAfter > 0)
          ? rateLimitError.retryAfter
          : 60; // Fallback padrão de 60 segundos
        
        logger.warn(`[Pipeline][${execution.executionId}] Rate limit excedido`, { retryAfter });
        result.errors.push(`Rate limit excedido. Tente novamente em ${retryAfter} segundos.`);
        result.motivo = 'Rate limit excedido';
        result.rateLimitExceeded = true;
        result.retryAfter = retryAfter;
        updateStatus(execution, 'failed');
        return result;
      }
      // Se não for erro de rate limit, propaga
      throw rateLimitError;
    }

    // Marca filesInferred como concluído (já foi tratado no frontend)
    updateStage(execution, 'filesInferred', true);
    updateStage(execution, 'payloadValid', true);

    // Executa validação de governança (antes do orchestrator)
    logger.info(`[Pipeline][${execution.executionId}] Validando governança`);
    const governanceValidation = await validateGovernance();
    if (!governanceValidation.valid) {
      logger.error(`[Pipeline][${execution.executionId}] Validação de governança falhou`, {
        errors: governanceValidation.errors,
      });
      result.errors.push(`Validação de governança falhou: ${governanceValidation.errors.join('; ')}`);
      result.motivo = 'Validação de governança falhou';
      updateStatus(execution, 'failed');
      return result;
    }
    logger.info(`[Pipeline][${execution.executionId}] Governança validada`);

    // Se DRY-RUN, retorna aqui
    if (isDryRun) {
      logger.info(`[Pipeline][${execution.executionId}] Modo DRY-RUN: retornando validação sem executar`);
      updateStatus(execution, 'approved');
      progressCallback(toProgressFormat(execution));
      return {
        success: true,
        rpaPassed: null,
        flowGenerated: false,
        seedGenerated: false,
        rpaGenerated: false,
        rpaExecuted: false,
        dryRun: true,
        warnings: [],
        errors: [],
        motivo: 'DRY-RUN: Nenhuma execução real realizada',
        executionId: execution.executionId,
      };
    }

    // Usa o Orchestrator para avançar o pipeline
    // O orchestrator controla todas as etapas de forma determinística
    let shouldContinue = true;
    while (shouldContinue) {
      const advanceResult = await advancePipeline(execution, progressCallback);
      shouldContinue = advanceResult.shouldContinue;
      
      if (advanceResult.error) {
        result.errors.push(advanceResult.error);
        result.motivo = advanceResult.error;
        updateStatus(execution, 'failed');
        break;
      }
    }

    // Se chegou aqui, todas as etapas foram concluídas
    if (execution.status === 'approved') {
      // BLOCO 4.5: Validação obrigatória de RAG
      const useRag = execution.payload?.useRag !== false;
      if (useRag) {
        logger.info(`[Pipeline][${execution.executionId}] BLOCO 4.5: Validando uso de RAG no gate obrigatório`);
        const { validateRagExecution } = require('../../qa/ragRuntimeQA');
        try {
          const ragValidation = validateRagExecution(execution, execution.generationResult);
          if (!ragValidation.valid) {
            const errorMsg = `Validação RAG falhou: ${ragValidation.errors.join('; ')}`;
            logger.error(`[Pipeline][${execution.executionId}] BLOCO 4.5: Gate de RAG bloqueou execução`, {
              errors: ragValidation.errors,
              warnings: ragValidation.warnings,
            });
            result.errors.push(...ragValidation.errors);
            if (ragValidation.warnings.length > 0) {
              result.warnings = result.warnings || [];
              result.warnings.push(...ragValidation.warnings);
            }
            result.motivo = 'Validação RAG falhou - execução não pode ser aprovada sem grounding válido';
            
            updateStatus(execution, 'failed');
            return result;
          }
          logger.info(`[Pipeline][${execution.executionId}] BLOCO 4.5: Validação RAG passou no gate`, {
            warnings: ragValidation.warnings,
          });
        } catch (ragError) {
          logger.error(`[Pipeline][${execution.executionId}] BLOCO 4.5: Erro na validação RAG`, {
            error: ragError.message,
          });
          result.errors.push(`Erro na validação RAG: ${ragError.message}`);
          result.motivo = 'Erro na validação RAG';
          updateStatus(execution, 'failed');
          return result;
        }
      }
      
      // BLOCO 5: Validação obrigatória do fluxo gerado
      if (execution.flow) {
        // 🚫 Gate de validação OBRIGATÓRIA para fluxos gerados por IA
        // Fluxos gerados por IA DEVEM passar pelo gate antes de serem persistidos
        const isAiGenerated = execution.flow.metadata?.generatedBy === 'ai' || 
                               execution.flow.metadata?.generated === true;
        
        if (isAiGenerated) {
          logger.info(`[Pipeline][${execution.executionId}] BLOCO 5: Validando fluxo gerado por IA no gate obrigatório`);
          const { validateGeneratedPlanOrThrow } = require('../../engine/ai/validateGeneratedPlan');
          try {
            validateGeneratedPlanOrThrow(execution.flow, 'chatbot');
            logger.info(`[Pipeline][${execution.executionId}] BLOCO 5: Fluxo gerado por IA passou no gate de validação`, {
              flowId: execution.flow.id,
              flowName: execution.flow.name
            });
          } catch (validationError) {
            logger.error(`[Pipeline][${execution.executionId}] BLOCO 5: Gate de validação bloqueou fluxo gerado por IA`, {
              flowId: execution.flow.id,
              flowName: execution.flow.name,
              error: validationError.message
            });
            result.errors.push(`Gate de validação bloqueou fluxo gerado por IA: ${validationError.message}`);
            result.motivo = 'Fluxo gerado por IA não passou na validação obrigatória do gate';
            
            // Rollback em modo bootstrap
            if (isBootstrap && artifacts.flowPath) {
              logger.info(`[Pipeline][${execution.executionId}] Modo Bootstrap: Fazendo rollback após falha do gate de IA`);
              removeFlowFromFile(execution.flow.id);
            }
            
            updateStatus(execution, 'failed');
            return result;
          }
        }

        // Valida schema do fluxo (se gerado)
        const schemaValidation = await validateSchema(execution.flow);
        if (!schemaValidation.valid) {
          logger.error(`[Pipeline][${execution.executionId}] BLOCO 5: Validação de schema falhou`, {
            flowId: execution.flow.id,
            errors: schemaValidation.errors,
          });
          result.errors.push(`Validação de schema falhou: ${schemaValidation.errors.join('; ')}`);
          result.motivo = 'Validação de schema falhou';
          
          // Rollback em modo bootstrap
          if (isBootstrap && artifacts.flowPath) {
            logger.info(`[Pipeline][${execution.executionId}] Modo Bootstrap: Fazendo rollback após falha de schema`);
            removeFlowFromFile(execution.flow.id);
          }
          
          updateStatus(execution, 'failed');
          return result;
        }
      }

      // Persiste artefatos (apenas se RPA passou ou não foi executado)
      if (execution.rpaPassed !== false || !execution.rpaTestPath) {
        if (execution.flow) {
          if (!isBootstrap || execution.rpaPassed) {
            const flowPath = saveFlowToFile(execution.flow);
            artifacts.flowPath = flowPath;
            artifacts.flowId = execution.flow.id;
          }
        }
      }

      // Executa validação completa (se solicitado)
      if (payload.executeFullValidation) {
        logger.info(`[Pipeline][${execution.executionId}] Executando validação completa (system:validate)`);
        const systemValidation = await executeSystemValidate();
        if (!systemValidation.success) {
          result.warnings.push(`system:validate falhou: ${systemValidation.errors.join('; ')}`);
        }
      }

      // Preenche resultado final
      result.success = true;
      result.flowGenerated = execution.stages.flowGenerated;
      result.seedGenerated = execution.stages.seedGenerated;
      result.rpaGenerated = execution.stages.rpaGenerated;
      result.rpaExecuted = execution.stages.rpaExecuted;
      result.rpaPassed = execution.rpaPassed || false;

      if (execution.rpaResult) {
        if (execution.rpaResult.reportPath) {
          result.reportLink = `/tests/rpa/reports/${path.basename(execution.rpaResult.reportPath)}`;
        }
        if (execution.rpaResult.replayPath) {
          result.replayLink = `/tests/rpa/replay/${path.basename(execution.rpaResult.replayPath)}`;
        }
      }

      if (!result.motivo) {
        result.motivo = 'Geração e validação concluídas com sucesso';
      }

      logger.info(`[Pipeline][${execution.executionId}] Pipeline concluído com sucesso`, {
        flowId: artifacts.flowId,
        rpaPassed: result.rpaPassed,
        duration: Date.now() - startTime,
      });
    } else {
      // Pipeline falhou
      result.success = false;
      if (!result.motivo) {
        result.motivo = 'Pipeline falhou';
      }
    }

    return result;
  } catch (err) {
    logger.error(`[Pipeline][${execution.executionId}] Erro em generate-and-validate`, err);

    updateStatus(execution, 'failed');

    // Rollback em modo bootstrap
    if (isBootstrap) {
      logger.info(`[Pipeline][${execution.executionId}] Modo Bootstrap: Fazendo rollback após erro`);
      if (artifacts.flowId && artifacts.flowPath) {
        removeFlowFromFile(artifacts.flowId);
      }
      if (artifacts.rpaTestPath && fs.existsSync(artifacts.rpaTestPath)) {
        fs.unlinkSync(artifacts.rpaTestPath);
      }
      if (artifacts.seedPath && fs.existsSync(artifacts.seedPath)) {
        fs.unlinkSync(artifacts.seedPath);
      }
    }

    result.errors.push(err.message || 'Erro desconhecido');
    result.motivo = err.message || 'Erro desconhecido';
    return result;
  } finally {
    // Remove da lista de execuções em andamento
    runningExecutions.delete(executionKey);
  }
}

module.exports = {
  generateAndValidate,
  executeRpaTest, // Exporta para uso no orchestrator
};

