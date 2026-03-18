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
// Funções saveFlowToFile e removeFlowFromFile removidas - dados agora estão no banco de dados PostgreSQL
const { enforceRateLimit } = require('../../infra/rate-limit');
const { ensureExecutionContext, requireStages, updateStage, updateStatus, tryApprove, toProgressFormat } = require('./pipelineExecutionContext');
const { advancePipeline } = require('./pipelineOrchestrator');
const { isSuperAdmin } = require('./superAdminService');

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  try { return err.message || String(err) || fallback; } catch (_) { return fallback; }
}
function safeGet(obj, key, fallback = null) {
  if (!obj) return fallback;
  try {
    const value = obj[key];
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

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
    return { valid: false, errors: [safeErrorMessage(err)] };
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
    return { valid: false, errors: [safeErrorMessage(err)] };
  }
}

/**
 * Executa teste RPA específico.
 * 
 * @param {string} rpaTestPath - Caminho do arquivo de teste RPA
 * @returns {Promise<{success: boolean, error?: string, reportPath?: string}>}
 */
async function executeRpaTest(rpaTestPath) {
  let runner = null;
  let result = null;
  let reportPath = null;

  try {
    logger.info('Executando teste RPA', { rpaTestPath });

    // Em DEV, o server pode ficar vivo (nodemon) sem observar `tests/rpa/**`.
    // Como o pipeline executa código em `tests/rpa`, garantimos que a execução
    // sempre use a versão atual do runner/executor (evita cache antigo do require()).
    try {
      const runnerModulePath = require.resolve('../../tests/rpa/rpaTestRunner');
      const actionExecutorPath = require.resolve('../../tests/rpa/actionExecutor');
      // Limpa cache em ordem: executor primeiro ou ambos (seguro)
      delete require.cache[actionExecutorPath];
      delete require.cache[runnerModulePath];
    } catch (e) {
      // Se algo falhar aqui, não deve impedir a execução do RPA.
    }

    // Executa o teste RPA usando o runner existente
    const { RpaTestRunner } = require('../../tests/rpa/rpaTestRunner');
    runner = new RpaTestRunner({
      headless: true,
    });

    await runner.init();

    // Carrega o teste
    const testContent = fs.readFileSync(rpaTestPath, 'utf8');
    const testData = JSON.parse(testContent);

    // Executa o teste
    // O playback aceita string (nome) ou objeto (dados completos)
    result = await runner.playback(testData, {});

    // Sempre gera relatório (mesmo quando falha), para diagnóstico detalhado.
    // O report inclui `details` com os steps e agora também `step.debug`.
    const report = runner.generateReport();
    reportPath = path.join(
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

    // Encerra o runner após gerar relatório
    await runner.close();

    if (result.success) {
      return {
        success: true,
        reportPath,
        replayPath: result.replayPath || null,
        replayId: result.replayId || null,
      };
    }

    // Mensagem de erro com resumo do step que falhou (se disponível)
    const failedStep = Array.isArray(result.steps) ? result.steps.find((s) => s && s.success === false) : null;
    const diagSummary = failedStep?.debug?.diagnostics
      ? {
          kind: failedStep.debug.diagnostics.kind,
          selectorsTried: failedStep.debug.diagnostics.selectorsTried,
        }
      : null;

    const derivedError =
      result.message ||
      result.error ||
      failedStep?.error ||
      (Array.isArray(result.errors) && result.errors.length ? result.errors[0] : null) ||
      'Teste RPA falhou';

    return {
      success: false,
      error: derivedError,
      failedStep: failedStep
        ? { step: failedStep.step, action: failedStep.action, selector: failedStep.selector, diagSummary }
        : null,
      reportPath,
      replayPath: result.replayPath || null,
      replayId: result.replayId || null,
    };
  } catch (err) {
    logger.error('Erro ao executar teste RPA', err);
    try {
      if (runner) await runner.close();
    } catch (e) {
      // ignora
    }
    return {
      success: false,
      error: safeErrorMessage(err, 'Erro desconhecido ao executar teste RPA'),
      reportPath,
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
      errors: [safeErrorMessage(err, 'system:validate falhou')],
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
  const isTenantPipeline = payload?.tenantPipeline === true;

  // Cria ou reaproveita Execution Context (execução unificada por executionId)
  const execution = ensureExecutionContext(payload, options);
  // Se o frontend sinalizar que essa execução faz parte do pipeline tenant, exige as etapas extras.
  if (isTenantPipeline) {
    requireStages(execution, ['faqGenerated', 'initialFlowGenerated']);
    // Como virou "requerido", começa pendente até os endpoints concluírem.
    if (execution.stages.faqGenerated !== true) execution.stages.faqGenerated = false;
    if (execution.stages.initialFlowGenerated !== true) execution.stages.initialFlowGenerated = false;
  }

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
    
    // Verifica se é super-admin (rate limit é apenas informativo para super-admins)
    const agent = options.agent || null;
    const isSuperAdminUser = agent ? isSuperAdmin(agent) : false;
    
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
        executionMode,
        isSuperAdmin: isSuperAdminUser
      });

      // Para super-admins, verifica rate limit mas apenas para logging (não bloqueia)
      if (isSuperAdminUser) {
        try {
          await enforceRateLimit({
            userId,
            operationType,
          });
          logger.info(`[Pipeline][${execution.executionId}] Rate limiting verificado (super-admin - apenas informativo)`, { userId, operationType });
        } catch (rateLimitError) {
          if (rateLimitError.code === 'RATE_LIMIT_EXCEEDED') {
            const retryAfter = (rateLimitError.retryAfter && !isNaN(rateLimitError.retryAfter) && rateLimitError.retryAfter > 0)
              ? rateLimitError.retryAfter
              : 60;
            
            // Apenas loga, não bloqueia para super-admin
            logger.warn(`[Pipeline][${execution.executionId}] Rate limit excedido (super-admin - apenas informativo)`, { 
              retryAfter,
              userId,
              operationType,
              agentId: agent?.id,
              username: agent?.username
            });
            // Continua execução normalmente para super-admin
          } else {
            // Se não for erro de rate limit, propaga
            throw rateLimitError;
          }
        }
      } else {
        // Para usuários normais, rate limit é bloqueante
        await enforceRateLimit({
          userId,
          operationType,
        });

        logger.info(`[Pipeline][${execution.executionId}] Rate limiting aprovado`, { userId, operationType });
      }
    } catch (rateLimitError) {
      // Este catch só é alcançado para usuários não-super-admin
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
        updateStatus(execution, 'failed', {
          currentStage: execution.currentStage || 'providerValidated',
          stageStatus: 'error',
          reason: { code: 'RATE_LIMIT_EXCEEDED', retryAfter },
          message: `Rate limit excedido. Tente novamente em ${retryAfter} segundos.`,
          source: 'generate-and-validate.rate-limit',
        });
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
      updateStatus(execution, 'failed', {
        currentStage: execution.currentStage || 'payloadValid',
        stageStatus: 'error',
        reason: { code: 'GOVERNANCE_FAILED' },
        message: `Validação de governança falhou: ${governanceValidation.errors.join('; ')}`,
        source: 'generate-and-validate.governance',
      });
      return result;
    }
    logger.info(`[Pipeline][${execution.executionId}] Governança validada`);

    // Se DRY-RUN, retorna aqui
    if (isDryRun) {
      logger.info(`[Pipeline][${execution.executionId}] Modo DRY-RUN: retornando validação sem executar`);
      // Em DRY-RUN, ainda emitimos um pipeline consistente para o frontend:
      // - Marca etapas como "concluídas (simuladas)" para não aparecer "Aprovado" com etapas pendentes
      // - Não persiste artefatos nem executa RPA de verdade
      const nowIso = new Date().toISOString();
      const mkCompleted = (message) => ({
        status: 'completed',
        progress: 100,
        timestamp: nowIso,
        message,
      });

      const shouldGenerateFlow = (payload.generate?.flow === true) || isBootstrap === true;
      const shouldGenerateSeed = (payload.generate?.seed === true) || isBootstrap === true;
      const shouldGenerateRpa = (payload.generate?.rpa === true) || isBootstrap === true || payload.generateRpaTest === true;
      const useRag = payload.useRag !== false;

      updateStage(execution, 'contractValid', true);
      updateStage(execution, 'contextBuilt', true);
      // Em dry-run, não construímos RAG de verdade; marcamos como concluído para consistência visual.
      if (!useRag) {
        updateStage(execution, 'ragContextBuilt', true);
      } else {
        updateStage(execution, 'ragContextBuilt', true);
      }
      // IA/fluxo: simulados
      updateStage(execution, 'aiExecuted', true);
      updateStage(execution, 'flowGenerated', true);
      // Seed/RPA: simulados (sem criar arquivo/execução real)
      if (shouldGenerateSeed) updateStage(execution, 'seedGenerated', true);
      if (shouldGenerateRpa) {
        updateStage(execution, 'rpaGenerated', true);
        updateStage(execution, 'rpaExecuted', true);
      }

      // Não aprova automaticamente se houver etapas extras pendentes (modo tenant).
      // `tryApprove` só aprova quando todas as etapas requeridas estiverem concluídas.
      tryApprove(execution, { source: 'generate-and-validate.dry-run' });

      progressCallback({
        ...toProgressFormat(execution),
        contractValid: mkCompleted('DRY-RUN: contrato validado (simulado)'),
        contextBuilt: mkCompleted('DRY-RUN: contexto montado (simulado)'),
        ragContextBuilt: mkCompleted(useRag ? 'DRY-RUN: contexto RAG (simulado)' : 'DRY-RUN: RAG desativado'),
        aiExecuted: mkCompleted('DRY-RUN: IA simulada (nenhuma chamada executada)'),
        flowGenerated: mkCompleted(shouldGenerateFlow ? 'DRY-RUN: fluxo simulado' : 'DRY-RUN: geração de fluxo não solicitada'),
        seedGenerated: mkCompleted(shouldGenerateSeed ? 'DRY-RUN: seed simulado' : 'DRY-RUN: geração de seed não solicitada'),
        rpaGenerated: mkCompleted(shouldGenerateRpa ? 'DRY-RUN: RPA simulado' : 'DRY-RUN: geração de RPA não solicitada'),
        rpaExecuted: mkCompleted(shouldGenerateRpa ? 'DRY-RUN: execução RPA simulada' : 'DRY-RUN: execução RPA não solicitada'),
        // Em tenantPipeline, "approved" só aparece quando faqGenerated + initialFlowGenerated concluírem.
        ...(execution.status === 'approved' ? { approved: mkCompleted('DRY-RUN: aprovado (sem execução real)') } : {}),
      });
      return {
        success: true,
        rpaPassed: null,
        flowGenerated: shouldGenerateFlow,
        seedGenerated: shouldGenerateSeed,
        rpaGenerated: shouldGenerateRpa,
        rpaExecuted: shouldGenerateRpa,
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
          // Propaga diagnóstico do RPA (quando a falha ocorreu após executar RPA),
          // mesmo quando o erro vem do orchestrator (e não cai no catch abaixo).
          try {
            result.rpaGenerated = !!execution.stages?.rpaGenerated;
            result.rpaExecuted = !!execution.stages?.rpaExecuted;
            result.rpaPassed = execution.rpaPassed === true;

            if (execution.rpaResult?.reportPath) {
              result.reportLink = `/tests/rpa/reports/${path.basename(execution.rpaResult.reportPath)}`;
            }
            if (execution.rpaResult?.replayPath) {
              result.replayLink = `/tests/rpa/replay/${path.basename(execution.rpaResult.replayPath)}`;
            }
            if (execution.rpaResult?.failedStep) {
              result.rpaFailedStep = execution.rpaResult.failedStep;
            }
          } catch (e) {
            // best-effort
          }
        
        // Inclui artefatos gerados mesmo quando há erro no pipeline
        if (execution.generationResult) {
          const genResult = execution.generationResult;
          if (genResult.flowDefinition) {
            result.flowDefinition = genResult.flowDefinition;
            result.flowGenerated = true;
          }
          if (genResult.rpaTest) {
            result.rpaTest = genResult.rpaTest;
            result.rpaGenerated = true;
          }
          if (genResult.seed) {
            result.seed = genResult.seed;
            result.seedGenerated = true;
          }
          if (genResult.validation) {
            result.validation = genResult.validation;
          }
          if (genResult.dependencies) {
            result.dependencies = genResult.dependencies;
          }
        }
        
        break;
      }
    }

    // Se o pipeline absteve (evidência insuficiente), não trata como falha técnica.
    if (execution.status === 'abstained') {
      const abstention = execution.abstentionReason || null;
      result.success = false;
      result.abstained = true;
      result.abstentionReason = abstention;
      result.evidenceContext = execution.evidenceContext || null;
      result.motivo =
        abstention?.description
          ? `Abstenção: ${abstention.description}`
          : 'Abstenção: evidência insuficiente para continuar';

      // Emite status final para UI
      progressCallback(toProgressFormat(execution));

      return result;
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
            
            // Inclui artefatos gerados mesmo quando há erro
            if (execution.generationResult) {
              const genResult = execution.generationResult;
              if (genResult.flowDefinition) result.flowDefinition = genResult.flowDefinition;
              if (genResult.rpaTest) result.rpaTest = genResult.rpaTest;
              if (genResult.seed) result.seed = genResult.seed;
              if (genResult.validation) result.validation = genResult.validation;
              if (genResult.dependencies) result.dependencies = genResult.dependencies;
            }
            
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
          
          // Inclui artefatos gerados mesmo quando há erro
          if (execution.generationResult) {
            const genResult = execution.generationResult;
            if (genResult.flowDefinition) result.flowDefinition = genResult.flowDefinition;
            if (genResult.rpaTest) result.rpaTest = genResult.rpaTest;
            if (genResult.seed) result.seed = genResult.seed;
            if (genResult.validation) result.validation = genResult.validation;
            if (genResult.dependencies) result.dependencies = genResult.dependencies;
          }
          
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
            // SAFE-MODE (tenantPipeline): não aborta a execução — conclui com avisos para revisão humana.
            // Mantém o tenant em pending_review/draft, mas permite persistir artefatos e anexar diagnósticos.
            if (isTenantPipeline) {
              result.warnings.push(`Gate de validação sinalizou problema no fluxo: ${validationError.message}`);
              if (!result.motivo) result.motivo = 'Concluído com avisos (revisão humana necessária)';
            } else {
              result.errors.push(`Gate de validação bloqueou fluxo gerado por IA: ${validationError.message}`);
              result.motivo = 'Fluxo gerado por IA não passou na validação obrigatória do gate';
            }
            
            // Inclui artefatos gerados mesmo quando há erro
            if (execution.flow) {
              result.flowDefinition = execution.flow;
              result.flowGenerated = true;
            }
            if (execution.generationResult) {
              const genResult = execution.generationResult;
              if (genResult.rpaTest) result.rpaTest = genResult.rpaTest;
              if (genResult.seed) result.seed = genResult.seed;
              if (genResult.validation) result.validation = genResult.validation;
              if (genResult.dependencies) result.dependencies = genResult.dependencies;
            }
            
            // Em modo estrito, aborta. Em tenantPipeline, segue com avisos.
            if (!isTenantPipeline) {
              // Rollback em modo bootstrap
              if (isBootstrap && artifacts.flowPath) {
                logger.info(`[Pipeline][${execution.executionId}] Modo Bootstrap: Fazendo rollback após falha do gate de IA`);
                // Dados agora estão no banco de dados PostgreSQL - rollback não necessário
              }
              updateStatus(execution, 'failed');
              return result;
            }
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
          
          // Inclui artefatos gerados mesmo quando há erro
          if (execution.flow) {
            result.flowDefinition = execution.flow;
            result.flowGenerated = true;
          }
          if (execution.generationResult) {
            const genResult = execution.generationResult;
            if (genResult.rpaTest) result.rpaTest = genResult.rpaTest;
            if (genResult.seed) result.seed = genResult.seed;
            if (genResult.validation) result.validation = genResult.validation;
            if (genResult.dependencies) result.dependencies = genResult.dependencies;
          }
          
          // Rollback em modo bootstrap
          if (isBootstrap && artifacts.flowPath) {
            logger.info(`[Pipeline][${execution.executionId}] Modo Bootstrap: Fazendo rollback após falha de schema`);
            // Dados agora estão no banco de dados PostgreSQL - rollback não necessário
          }
          
          updateStatus(execution, 'failed');
          return result;
        }
      }

      // Persiste artefatos:
      // - padrão: apenas se RPA passou ou não foi executado
      // - tenantPipeline: persiste mesmo se RPA falhar (safe-mode), mantendo revisão humana obrigatória
      if (isTenantPipeline || execution.rpaPassed !== false || !execution.rpaTestPath) {
        if (execution.flow) {
          if (!isBootstrap || execution.rpaPassed) {
            // Dados agora estão no banco de dados PostgreSQL - não precisa salvar em arquivo
            artifacts.flowPath = null; // Não há mais arquivo físico
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
      if (execution.seed) {
        result.seed = execution.seed;
      }

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
    logger.error(`[Pipeline][${execution.executionId}] Erro em generate-and-validate`, {
      error: safeErrorMessage(err),
      stack: safeGet(err, 'stack'),
      name: safeGet(err, 'name'),
      code: safeGet(err, 'code'),
      fullError: safeErrorMessage(err),
      executionId: execution.executionId,
      flowId: execution.flow?.id,
      testId: execution.rpaTest?.id,
    });

    updateStatus(execution, 'failed');

    // Rollback em modo bootstrap
    if (isBootstrap) {
      logger.info(`[Pipeline][${execution.executionId}] Modo Bootstrap: Fazendo rollback após erro`);
      if (artifacts.flowId && artifacts.flowPath) {
        // Dados agora estão no banco de dados PostgreSQL - rollback não necessário
      }
      if (artifacts.rpaTestPath && fs.existsSync(artifacts.rpaTestPath)) {
        fs.unlinkSync(artifacts.rpaTestPath);
      }
      if (artifacts.seedPath && fs.existsSync(artifacts.seedPath)) {
        fs.unlinkSync(artifacts.seedPath);
      }
    }

    result.errors.push(safeErrorMessage(err, 'Erro desconhecido'));
    result.motivo = safeErrorMessage(err, 'Erro desconhecido');
    
    // Inclui artefatos gerados mesmo quando há erro, para que possam ser visualizados
    if (execution.flow) {
      result.flowDefinition = execution.flow;
      result.flowGenerated = true;
    }
    if (execution.rpaTest) {
      result.rpaTest = execution.rpaTest;
      result.rpaGenerated = true;
    }
    if (execution.seed) {
      result.seed = execution.seed;
      result.seedGenerated = true;
    }

    // Se houver resultado de RPA (mesmo falhando), expõe links para diagnóstico.
    try {
      if (execution.rpaResult?.reportPath) {
        result.reportLink = `/tests/rpa/reports/${path.basename(execution.rpaResult.reportPath)}`;
      }
      if (execution.rpaResult?.replayPath) {
        result.replayLink = `/tests/rpa/replay/${path.basename(execution.rpaResult.replayPath)}`;
      }
      if (execution.rpaResult?.failedStep) {
        result.rpaFailedStep = execution.rpaResult.failedStep;
      }
    } catch (e) {
      // best-effort
    }
    
    // Inclui todos os artefatos do generationResult se disponíveis
    if (execution.generationResult) {
      const genResult = execution.generationResult;
      
      // Inclui flowDefinition se não foi incluído acima
      if (!result.flowDefinition && genResult.flowDefinition) {
        result.flowDefinition = genResult.flowDefinition;
        result.flowGenerated = true;
      }
      
      // Inclui rpaTest se não foi incluído acima
      if (!result.rpaTest && genResult.rpaTest) {
        result.rpaTest = genResult.rpaTest;
        result.rpaGenerated = true;
      }
      
      // Inclui seed se não foi incluído acima
      if (!result.seed && genResult.seed) {
        result.seed = genResult.seed;
        result.seedGenerated = true;
      }
      
      // Inclui informações de validação
      if (genResult.validation) {
        result.validation = genResult.validation;
      }
      
      // Inclui dependências
      if (genResult.dependencies) {
        result.dependencies = genResult.dependencies;
      }
      
      // Inclui metadata
      if (genResult.metadata) {
        result.metadata = genResult.metadata;
      }
    }
    
    logger.info(`[Pipeline][${execution.executionId}] Retornando resultado com artefatos gerados mesmo após erro`, {
      hasFlow: !!result.flowDefinition,
      hasRpaTest: !!result.rpaTest,
      hasSeed: !!result.seed,
      error: safeErrorMessage(err),
    });
    
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

