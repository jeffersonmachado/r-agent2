/**
 * Pipeline Orchestrator Determinístico
 * 
 * Este módulo é o único responsável por avançar o pipeline.
 * Nenhuma outra parte do sistema pode executar etapas diretamente.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Apenas o Orchestrator decide a próxima etapa
 * - Cada etapa só executa se não estiver concluída
 * - O estado do contexto é a fonte da verdade
 * - Nenhuma etapa pode ser executada diretamente
 */

const logger = require('../utils/logger');
const { 
  updateStage, 
  updateStatus, 
  isStageCompleted, 
  getNextPendingStage,
  toProgressFormat 
} = require('./pipelineExecutionContext');
const { validateGenerationContract } = require('../utils/contractValidator');
const { orchestrateGeneration } = require('./generationOrchestrator');
const { validateFlow } = require('../../engine/validator');
const { saveFlowToFile, removeFlowFromFile } = require('./generationOrchestrator');

/**
 * Avança o pipeline para a próxima etapa válida.
 * 
 * @param {Object} execution - Contexto da execução
 * @param {Function} onProgress - Callback para atualizar progresso (opcional)
 * @returns {Promise<{shouldContinue: boolean, error?: string}>}
 */
async function advancePipeline(execution, onProgress = null) {
  // Verifica se já está aprovado ou falhou
  if (execution.status === 'approved' || execution.status === 'failed') {
    logger.debug('[PipelineOrchestrator] Pipeline já finalizado', {
      executionId: execution.executionId,
      status: execution.status,
    });
    return { shouldContinue: false };
  }

  // Marca como running se ainda estiver idle
  if (execution.status === 'idle') {
    updateStatus(execution, 'running');
  }

  const nextStage = getNextPendingStage(execution);
  if (!nextStage) {
    // Todas as etapas concluídas
    updateStatus(execution, 'approved');
    if (onProgress) {
      onProgress(toProgressFormat(execution));
    }
    return { shouldContinue: false };
  }

  logger.info('[PipelineOrchestrator] Avançando para próxima etapa', {
    executionId: execution.executionId,
    stage: nextStage,
  });

  try {
    // Executa a próxima etapa
    await executeStage(execution, nextStage, onProgress);
    
    // Após executar, tenta avançar novamente
    return { shouldContinue: true };
  } catch (error) {
    logger.error('[PipelineOrchestrator] Erro ao executar etapa', {
      executionId: execution.executionId,
      stage: nextStage,
      error: error.message,
    });
    updateStatus(execution, 'failed');
    return { shouldContinue: false, error: error.message };
  }
}

/**
 * Executa uma etapa específica do pipeline.
 * 
 * @param {Object} execution - Contexto da execução
 * @param {string} stage - Nome da etapa
 * @param {Function} onProgress - Callback para atualizar progresso
 */
async function executeStage(execution, stage, onProgress) {
  // Verifica se já está concluída (idempotência)
  if (isStageCompleted(execution, stage)) {
    logger.debug('[PipelineOrchestrator] Etapa já concluída, pulando', {
      executionId: execution.executionId,
      stage,
    });
    return;
  }

  logger.info(`[PipelineOrchestrator][${execution.executionId}] Executando etapa: ${stage}`);

  switch (stage) {
    case 'filesInferred':
      // Esta etapa é tratada no frontend, apenas marca como concluída
      updateStage(execution, 'filesInferred', true);
      break;

    case 'payloadValid':
      await executePayloadValidation(execution);
      break;

    case 'contractValid':
      await executeContractValidation(execution);
      break;

    case 'contextBuilt':
      await executeContextBuilding(execution);
      break;

    case 'aiExecuted':
    case 'flowGenerated':
      // IA e geração de fluxo são executadas juntas
      await executeAIGeneration(execution);
      break;

    case 'seedGenerated':
      await executeSeedGeneration(execution);
      break;

    case 'rpaGenerated':
      await executeRPAGeneration(execution);
      break;

    case 'rpaExecuted':
      await executeRPAExecution(execution);
      break;

    default:
      logger.warn('[PipelineOrchestrator] Etapa desconhecida', {
        executionId: execution.executionId,
        stage,
      });
      return;
  }

  // Notifica progresso
  if (onProgress) {
    onProgress(toProgressFormat(execution));
  }
}

/**
 * Executa validação de payload.
 */
async function executePayloadValidation(execution) {
  if (isStageCompleted(execution, 'payloadValid')) return;

  // Payload já foi validado antes de criar o contexto
  // Esta etapa apenas marca como concluída
  updateStage(execution, 'payloadValid', true);
}

/**
 * Executa validação de contrato.
 */
async function executeContractValidation(execution) {
  if (isStageCompleted(execution, 'contractValid')) return;

  const contractValidation = validateGenerationContract(execution.payload);
  
  if (!contractValidation.valid) {
    throw new Error(`Validação de contrato falhou: ${contractValidation.errors.join('; ')}`);
  }

  updateStage(execution, 'contractValid', true);
}

/**
 * Executa construção de contexto.
 */
async function executeContextBuilding(execution) {
  if (isStageCompleted(execution, 'contextBuilt')) return;

  // O contexto será construído durante a geração
  // Esta etapa apenas marca como concluída
  updateStage(execution, 'contextBuilt', true);
}

/**
 * Executa geração de IA e fluxo.
 */
async function executeAIGeneration(execution) {
  if (isStageCompleted(execution, 'aiExecuted') && isStageCompleted(execution, 'flowGenerated')) {
    return;
  }

  const isDryRun = execution.payload.executionMode === 'dry-run';
  
  if (isDryRun) {
    // Em dry-run, apenas marca como concluído
    updateStage(execution, 'aiExecuted', true);
    updateStage(execution, 'flowGenerated', true);
    return;
  }

  // Executa geração
  const generationResult = await orchestrateGeneration(execution.payload, {
    tenantId: execution.options.tenantId || 'demo-tenant',
    dryRun: false,
  });

  if (!generationResult.success) {
    throw new Error('Falha na geração de artefatos');
  }

  if (!generationResult.flowDefinition) {
    throw new Error('Fluxo não foi gerado');
  }

  // Armazena o fluxo no contexto
  execution.flow = generationResult.flowDefinition;
  execution.generationResult = generationResult;

  updateStage(execution, 'aiExecuted', true);
  updateStage(execution, 'flowGenerated', true);
}

/**
 * Executa geração de seed.
 */
async function executeSeedGeneration(execution) {
  if (isStageCompleted(execution, 'seedGenerated')) return;

  const shouldGenerateSeed = execution.payload.generate?.seed || execution.payload.bootstrap === true;
  
  if (!shouldGenerateSeed) {
    // Pula geração de seed se não solicitado
    updateStage(execution, 'seedGenerated', true);
    return;
  }

  if (!execution.flow) {
    throw new Error('Fluxo não disponível para gerar seed');
  }

  // Por enquanto, apenas simula geração de seed
  // Em produção, isso pode chamar scripts de seed específicos
  logger.info('[PipelineOrchestrator] Seed gerado (simulado)', {
    executionId: execution.executionId,
    flowId: execution.flow.id,
  });

  updateStage(execution, 'seedGenerated', true);
}

/**
 * Executa geração de RPA.
 */
async function executeRPAGeneration(execution) {
  if (isStageCompleted(execution, 'rpaGenerated')) return;

  const shouldGenerateRpa = execution.payload.generate?.rpa || 
                            execution.payload.bootstrap === true ||
                            execution.payload.generateRpaTest;

  if (!shouldGenerateRpa) {
    // Pula geração de RPA se não solicitado
    updateStage(execution, 'rpaGenerated', true);
    return;
  }

  if (!execution.generationResult || !execution.generationResult.rpaTest) {
    logger.warn(`[PipelineOrchestrator][${execution.executionId}] Teste RPA não foi gerado pela IA`);
    // Não é erro crítico, apenas marca como não gerado
    updateStage(execution, 'rpaGenerated', true);
    return;
  }

  // Salva RPA temporariamente para execução posterior
  const fs = require('fs');
  const path = require('path');
  const flowsDir = path.join(__dirname, '..', '..', 'tests', 'rpa', 'flows');
  if (!fs.existsSync(flowsDir)) {
    fs.mkdirSync(flowsDir, { recursive: true });
  }

  const rpaTestPath = path.join(flowsDir, `${execution.generationResult.rpaTest.id}.json`);
  fs.writeFileSync(rpaTestPath, JSON.stringify(execution.generationResult.rpaTest, null, 2), 'utf8');
  execution.rpaTestPath = rpaTestPath;

  logger.info(`[PipelineOrchestrator][${execution.executionId}] RPA gerado e salvo`, {
    rpaTestId: execution.generationResult.rpaTest.id,
    rpaTestPath,
  });

  // RPA já foi gerado durante orchestrateGeneration, agora está salvo
  updateStage(execution, 'rpaGenerated', true);
}

/**
 * Executa execução de RPA.
 */
async function executeRPAExecution(execution) {
  if (isStageCompleted(execution, 'rpaExecuted')) return;

  if (!execution.rpaTestPath) {
    // Não há RPA para executar
    logger.debug(`[PipelineOrchestrator][${execution.executionId}] Nenhum RPA para executar`);
    updateStage(execution, 'rpaExecuted', true);
    return;
  }

  logger.info(`[PipelineOrchestrator][${execution.executionId}] Executando teste RPA`, {
    rpaTestPath: execution.rpaTestPath,
  });

  // Executa RPA usando a função do generate-and-validate
  // Importa dinamicamente para evitar dependência circular
  const generateAndValidateModule = require('./generate-and-validate');
  const rpaResult = await generateAndValidateModule.executeRpaTest(execution.rpaTestPath);
  
  execution.rpaResult = rpaResult;
  execution.rpaPassed = rpaResult.success;

  logger.info(`[PipelineOrchestrator][${execution.executionId}] Teste RPA executado`, {
    success: rpaResult.success,
    hasReport: !!rpaResult.reportPath,
  });

  updateStage(execution, 'rpaExecuted', true);

  if (!rpaResult.success) {
    throw new Error(`Teste RPA falhou: ${rpaResult.error}`);
  }
}

module.exports = {
  advancePipeline,
  executeStage,
};

