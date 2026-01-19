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
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');
const path = require('path');

/**
 * Avança o pipeline para a próxima etapa válida.
 * 
 * @param {Object} execution - Contexto da execução
 * @param {Function} onProgress - Callback para atualizar progresso (opcional)
 * @returns {Promise<{shouldContinue: boolean, error?: string}>}
 */
async function advancePipeline(execution, onProgress = null) {
  // Inicializa replay se não existir
  let replay = execution._replay;
  const shouldRecordReplay = process.env.ENABLE_PIPELINE_REPLAY !== 'false';
  
  if (shouldRecordReplay && !replay) {
    replay = new ReplaySystem({
      storagePath: path.join(process.cwd(), 'replays', 'pipeline'),
      context: 'pipeline',
      enableScreenshots: false,
    });
    
    const replayId = `pipeline-${execution.executionId}-${Date.now()}`;
    replay.start(replayId, {
      executionId: execution.executionId,
      status: execution.status,
    });
    
    execution._replay = replay;
  }

  // DETERMINISMO: Verifica se execução já foi persistida e tem decisão final
  const { reuseDecision, hasFinalDecision } = require('./executionPersistence');
  if (await hasFinalDecision(execution.executionId)) {
    const reused = await reuseDecision(execution.executionId, execution);
    if (reused) {
      logger.info('[PipelineOrchestrator] Reutilizando decisão de execução anterior (determinismo)', {
        executionId: execution.executionId,
        status: execution.status,
      });
      
      if (replay) {
        replay.recordEvent('decision_reused', {
          executionId: execution.executionId,
        });
      }

      if (recording) {
        recording.recordAction({
          type: 'decision-reused',
          step: 'decision-reused',
          value: { executionId: execution.executionId },
        });
      }
      
      if (onProgress) {
        onProgress(toProgressFormat(execution));
      }
      return { shouldContinue: false };
    }
  }
  
  // Verifica se já está aprovado, falhou ou absteve
  if (execution.status === 'approved' || execution.status === 'failed' || execution.status === 'abstained') {
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
    // Garante que autoridade de decisão está definida antes de aprovar
    if (!execution.decisionAuthority) {
      execution.decisionAuthority = {
        type: 'system',
        approvedBy: 'pipelineOrchestrator',
      };
    }
    updateStatus(execution, 'approved', {
      decisionAuthority: execution.decisionAuthority,
    });
    
    // Persiste execução após decisão final
    const { persistExecution } = require('./executionPersistence');
    persistExecution(execution).catch(err => {
      logger.error('[PipelineOrchestrator] Erro ao persistir execução', {
        executionId: execution.executionId,
        error: err.message,
      });
    });
    
    // Finaliza e salva replay
    if (execution._replay) {
      execution._replay.recordEvent('pipeline_completed', {
        status: execution.status,
      });
      execution._replay.stop();
      execution._replay.save(`pipeline-${execution.executionId}`);
    }
    
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

    // Registra erro na gravação
    if (execution._recording) {
      execution._recording.recordCustom('error', {
        step: 'pipeline-error',
        value: { error: error.message, stage: nextStage },
      });
      execution._recording.stop();
      execution._recording.save(`pipeline-${execution.executionId}-error`);
    }

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
  const replay = execution._replay;
  const recording = execution._recording;
  
  // Verifica se já está concluída (idempotência)
  if (isStageCompleted(execution, stage)) {
    logger.debug('[PipelineOrchestrator] Etapa já concluída, pulando', {
      executionId: execution.executionId,
      stage,
    });
    if (replay) {
      replay.recordEvent('stage_skipped', { stage, reason: 'already_completed' });
    }
    if (recording) {
      recording.recordAction({
        type: 'stage-skipped',
        step: stage,
        value: { reason: 'already_completed' },
      });
    }
    return;
  }

  logger.info(`[PipelineOrchestrator][${execution.executionId}] Executando etapa: ${stage}`);
  
  if (replay) {
    replay.recordEvent('stage_started', { stage });
  }

  if (recording) {
    recording.recordAction({
      type: 'stage',
      step: stage,
      value: { status: 'started' },
    });
  }

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

    case 'ragContextBuilt':
      await executeRagContextBuilding(execution);
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

  // Registra conclusão da etapa no replay
  if (replay) {
    replay.recordAction(
      { type: 'stage_execution', step: stage },
      { success: true }
    );
    replay.recordEvent('stage_completed', { stage });
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
 * Executa construção de contexto RAG.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Se useRag=true, DEVE construir contexto RAG válido
 * - Se useRag=true e não houver evidência suficiente, SISTEMA ABSTEVE (não falha)
 * - Se useRag=false, apenas marca como concluído
 * - Abstenção é estado legítimo, não é falha
 */
async function executeRagContextBuilding(execution) {
  if (isStageCompleted(execution, 'ragContextBuilt')) return;

  const useRag = execution.payload.useRag !== false;
  
  // Se RAG não está habilitado, apenas marca como concluído
  if (!useRag) {
    logger.debug('[PipelineOrchestrator] RAG não habilitado, pulando construção de contexto RAG', {
      executionId: execution.executionId,
    });
    updateStage(execution, 'ragContextBuilt', true);
    return;
  }

  // Carrega builder de contexto RAG e validador de evidência
  const { buildRagContext } = require('../../rag/buildRagContext');
  const { validateEvidence } = require('./evidenceValidator');
  
  logger.info('[PipelineOrchestrator] Construindo contexto RAG', {
    executionId: execution.executionId,
  });

  try {
    // Constrói contexto RAG
    const ragContext = await buildRagContext(
      execution.executionId,
      execution.payload,
      {
        tenantId: execution.options.tenantId, // Tenant deve ser fornecido explicitamente
        useRag: true,
        sessionId: execution.options.sessionId || null,
        flowId: execution.options.flowId || null,
      }
    );

    if (!ragContext.success) {
      // Falha ao construir contexto RAG = evidência insuficiente = abstenção
      logger.warn(`[Decision][${execution.executionId}] status=abstained reason=RAG_REQUIRED_BUT_MISSING`, {
        executionId: execution.executionId,
        error: ragContext.error,
      });
      
      updateStatus(execution, 'abstained', {
        abstentionReason: {
          code: 'RAG_REQUIRED_BUT_MISSING',
          description: `Falha ao construir contexto RAG: ${ragContext.error || 'erro desconhecido'}`,
        },
        decisionAuthority: {
          type: 'system',
          approvedBy: 'evidenceValidator',
        },
        evidenceContext: {
          available: false,
          type: 'rag',
          error: ragContext.error,
        },
      });
      
      // Persiste execução após decisão de abstenção
      const { persistExecution } = require('./executionPersistence');
      persistExecution(execution).catch(err => {
        logger.error('[PipelineOrchestrator] Erro ao persistir execução após abstenção', {
          executionId: execution.executionId,
          error: err.message,
        });
      });
      
      updateStage(execution, 'ragContextBuilt', true);
      return;
    }

    // Armazena contexto RAG no execution
    execution.ragContext = ragContext;

    // VALIDAÇÃO EPISTEMOLÓGICA: Verifica se há evidência suficiente
    const evidenceValidation = validateEvidence(execution);
    
    if (!evidenceValidation.sufficient || evidenceValidation.shouldAbstain) {
      // Evidência insuficiente = abstenção (não é falha, é decisão legítima)
      logger.warn(`[Decision][${execution.executionId}] status=abstained reason=${evidenceValidation.code}`, {
        executionId: execution.executionId,
        reason: evidenceValidation.reason,
        code: evidenceValidation.code,
        details: evidenceValidation.details,
      });
      
      updateStatus(execution, 'abstained', {
        abstentionReason: {
          code: evidenceValidation.code,
          description: evidenceValidation.reason,
        },
        decisionAuthority: {
          type: 'system',
          approvedBy: 'evidenceValidator',
        },
        evidenceContext: {
          available: true,
          type: 'rag',
          chunksCount: ragContext.chunks.length,
          sourcesCount: ragContext.sources.length,
          sufficient: false,
          reason: evidenceValidation.reason,
        },
      });
      
      // Persiste execução após decisão de abstenção
      const { persistExecution } = require('./executionPersistence');
      persistExecution(execution).catch(err => {
        logger.error('[PipelineOrchestrator] Erro ao persistir execução após abstenção', {
          executionId: execution.executionId,
          error: err.message,
        });
      });
      
      updateStage(execution, 'ragContextBuilt', true);
      return;
    }

    // Evidência suficiente - continua pipeline
    logger.info('[PipelineOrchestrator] Contexto RAG construído com sucesso e evidência validada', {
      executionId: execution.executionId,
      chunksCount: ragContext.chunks.length,
      sourcesCount: ragContext.sources.length,
      sources: ragContext.sources.map(s => s.documentId || s),
    });
    
    // Log estruturado para auditoria
    logger.info(`[Decision][${execution.executionId}] status=approved evidenceSources=${ragContext.sources.length}`, {
      executionId: execution.executionId,
      ragUsed: true,
      chunksCount: ragContext.chunks.length,
      sourcesCount: ragContext.sources.length,
      sources: ragContext.sources.map(s => ({
        documentId: s.documentId || s,
        chunksCount: s.chunksCount || 0,
      })),
    });

    updateStage(execution, 'ragContextBuilt', true);
  } catch (error) {
    logger.error('[PipelineOrchestrator] Erro ao construir contexto RAG', {
      executionId: execution.executionId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Executa geração de IA e fluxo.
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Se useRag=true, DEVE ter contexto RAG válido (ragContextBuilt)
 * - Se useRag=true e contexto RAG não estiver disponível, SISTEMA ABSTEVE (não executa IA)
 * - IA NUNCA decide se há evidência - essa decisão é do sistema
 * - Se sistema absteve, IA não executa
 */
async function executeAIGeneration(execution) {
  if (isStageCompleted(execution, 'aiExecuted') && isStageCompleted(execution, 'flowGenerated')) {
    return;
  }

  const isDryRun = execution.payload.executionMode === 'dry-run';
  const useRag = execution.payload.useRag !== false;
  
  // GATE EPISTEMOLÓGICO: Verifica se sistema absteve antes de executar IA
  if (execution.status === 'abstained') {
    logger.info(`[Decision][${execution.executionId}] status=abstained reason=${execution.abstentionReason?.code || 'UNKNOWN'} - IA não será executada`, {
      executionId: execution.executionId,
      reason: execution.abstentionReason?.code,
      description: execution.abstentionReason?.description,
    });
    
    // Marca etapas como concluídas (mas não executadas) devido à abstenção
    updateStage(execution, 'aiExecuted', true);
    updateStage(execution, 'flowGenerated', true);
    return;
  }
  
  // Validação obrigatória: se useRag=true, contexto RAG deve estar construído
  if (useRag && !isStageCompleted(execution, 'ragContextBuilt')) {
    logger.warn(`[Decision][${execution.executionId}] status=abstained reason=RAG_REQUIRED_BUT_MISSING - Contexto RAG não foi construído`, {
      executionId: execution.executionId,
    });
    
      updateStatus(execution, 'abstained', {
        abstentionReason: {
          code: 'RAG_REQUIRED_BUT_MISSING',
          description: 'Contexto RAG não foi construído. Etapa ragContextBuilt é obrigatória quando useRag=true',
        },
        decisionAuthority: {
          type: 'system',
          approvedBy: 'pipelineOrchestrator',
        },
      });
      
      // Persiste execução após decisão de abstenção
      const { persistExecution } = require('./executionPersistence');
      persistExecution(execution).catch(err => {
        logger.error('[PipelineOrchestrator] Erro ao persistir execução após abstenção', {
          executionId: execution.executionId,
          error: err.message,
        });
      });
      
      updateStage(execution, 'aiExecuted', true);
      updateStage(execution, 'flowGenerated', true);
      return;
  }
  
  // Validação obrigatória: se useRag=true, contexto RAG deve estar disponível e com evidência suficiente
  if (useRag) {
    const { validateEvidence } = require('./evidenceValidator');
    const evidenceValidation = validateEvidence(execution);
    
    if (!evidenceValidation.sufficient || evidenceValidation.shouldAbstain) {
      logger.warn(`[Decision][${execution.executionId}] status=abstained reason=${evidenceValidation.code || 'INSUFFICIENT_EVIDENCE'} - Evidência insuficiente, IA não será executada`, {
        executionId: execution.executionId,
        reason: evidenceValidation.reason,
        code: evidenceValidation.code,
      });
      
      updateStatus(execution, 'abstained', {
        abstentionReason: {
          code: evidenceValidation.code || 'INSUFFICIENT_EVIDENCE',
          description: evidenceValidation.reason || 'Evidência insuficiente para permitir resposta da IA',
        },
        decisionAuthority: {
          type: 'system',
          approvedBy: 'evidenceValidator',
        },
        evidenceContext: {
          available: !!execution.ragContext,
          type: 'rag',
          sufficient: false,
          reason: evidenceValidation.reason,
        },
      });
      
      // Persiste execução após decisão de abstenção
      const { persistExecution } = require('./executionPersistence');
      persistExecution(execution).catch(err => {
        logger.error('[PipelineOrchestrator] Erro ao persistir execução após abstenção', {
          executionId: execution.executionId,
          error: err.message,
        });
      });
      
      updateStage(execution, 'aiExecuted', true);
      updateStage(execution, 'flowGenerated', true);
      return;
    }
  }
  
  if (isDryRun) {
    // Em dry-run, apenas marca como concluído
    updateStage(execution, 'aiExecuted', true);
    updateStage(execution, 'flowGenerated', true);
    return;
  }

  // Prepara payload com contexto RAG explícito (OBRIGATÓRIO quando useRag=true)
  const payloadWithRag = {
    ...execution.payload,
    ragContext: useRag && execution.ragContext ? {
      enabled: true,
      executionId: execution.executionId, // SEMPRE inclui executionId
      chunks: execution.ragContext.chunks,
      sources: execution.ragContext.sources,
    } : {
      enabled: false,
      executionId: null,
      chunks: [],
      sources: [],
    },
  };

  // Executa geração
  const generationResult = await orchestrateGeneration(payloadWithRag, {
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

  // Log estruturado para auditoria RAG
  if (useRag && execution.ragContext) {
    const ragUsed = generationResult.ragUsed !== false;
    const ragExecutionId = generationResult.ragExecutionId || execution.executionId;
    const ragSources = generationResult.ragSources || execution.ragContext.sources.map(s => s.documentId || s);
    
    logger.info(`[IA][${execution.executionId}] ragUsed=${ragUsed} executionId=${ragExecutionId} sources=${ragSources.length}`, {
      executionId: execution.executionId,
      ragUsed,
      ragExecutionId,
      sourcesCount: ragSources.length,
      sources: ragSources,
      chunksCount: execution.ragContext.chunks.length,
    });
    
    // Armazena informações de RAG no resultado para validação posterior
    execution.generationResult = {
      ...execution.generationResult,
      rag: {
        used: ragUsed,
        executionId: ragExecutionId,
        sources: ragSources,
      },
    };
  }

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

