/**
 * Serviço de Pipeline RPA para Fluxos
 * 
 * Responsabilidades:
 * - Orquestra o pipeline completo de geração de gravação RPA a partir de fluxos
 * - Executa resolução de dependências
 * - Executa seeds RPA faltantes
 * - Valida estado final do sistema
 * - Converte fluxo para gravação RPA
 * - Gerencia todo o processo de forma determinística e auditável
 */

const logger = require('../utils/logger');
const rpaDependencyResolver = require('../../engine/rpaDependencyResolver');
const flowToRpaConverter = require('../../engine/flowToRpaConverter');
const rpaService = require('./rpaService');
const fs = require('fs');
const path = require('path');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');

/**
 * @typedef {Object} PipelineResult
 * @property {boolean} success - Se o pipeline foi executado com sucesso
 * @property {Object} flow - Fluxo processado
 * @property {Object} dependencyResolution - Resultado da resolução de dependências
 * @property {string[]} executedSeeds - Seeds RPA executados
 * @property {Object} recording - Gravação RPA criada (se sucesso)
 * @property {Object} snapshot - Snapshot final do ambiente
 * @property {string[]} errors - Erros encontrados
 * @property {string[]} warnings - Avisos
 */

/**
 * Executa o pipeline completo de geração de gravação RPA a partir de um fluxo.
 * 
 * Pipeline:
 * 1. Fluxo (IA ou humano)
 * 2. Análise de dependências
 * 3. Execução de seeds RPA faltantes (se necessário)
 * 4. Validação do estado final do sistema
 * 5. Conversão Fluxo → Gravação RPA de teste
 * 6. Preview dos passos
 * 7. Salvamento da gravação
 * 
 * @param {Object} flow - FlowDefinition
 * @param {Object} options - Opções do pipeline
 * @param {boolean} options.autoExecuteSeeds - Se deve executar seeds automaticamente (padrão: false)
 * @param {boolean} options.saveRecording - Se deve salvar a gravação (padrão: true)
 * @returns {Promise<PipelineResult>}
 */
async function executeRpaFlowPipeline(flow, options = {}) {
  const {
    autoExecuteSeeds = false,
    saveRecording = true,
  } = options;

  // Inicializa replay
  const replay = new ReplaySystem({
    storagePath: path.join(process.cwd(), 'replays', 'rpa-pipeline'),
    context: 'rpa-pipeline',
    enableScreenshots: false,
  });

  // Inicializa gravação
  const recordingSystem = new RecordingSystem({
    storagePath: path.join(process.cwd(), 'recordings', 'rpa-pipeline'),
    context: 'rpa-pipeline',
    enableTimestamps: false,
  });

  const replayId = `rpa-pipeline-${flow.id}-${Date.now()}`;
  const recordingId = `rpa-pipeline-${flow.id}-${Date.now()}`;
  
  replay.start(replayId, {
    flowId: flow.id,
    flowName: flow.name,
    autoExecuteSeeds,
    saveRecording,
  });

  recordingSystem.start(recordingId, {
    name: `RPA Pipeline - ${flow.name}`,
    description: 'Pipeline completo de geração de gravação RPA',
    flowId: flow.id,
    flowName: flow.name,
    autoExecuteSeeds,
    saveRecording,
    source: 'automatic',
  });

  logger.info('[RpaFlowPipeline] Iniciando pipeline RPA para fluxo', {
    flowId: flow.id,
    flowName: flow.name,
    autoExecuteSeeds,
    saveRecording,
    replayId,
  });

  const result = {
    success: false,
    flow,
    dependencyResolution: null,
    executedSeeds: [],
    recording: null,
    snapshot: null,
    errors: [],
    warnings: [],
  };

  try {
    const tenantId = flow.tenantId; // Tenant deve ser fornecido no flow

    // PASSO 1: Análise de dependências
    logger.info('[RpaFlowPipeline] Passo 1: Analisando dependências...');
    replay.recordEvent('dependency_analysis_started');
    
    const depStartTime = new Date().toISOString();
    const dependencyResolution = await rpaDependencyResolver.resolveDependencies(flow, tenantId);
    const depEndTime = new Date().toISOString();
    
    replay.recordAction(
      { type: 'dependency_analysis', step: 'analyze-dependencies' },
      {
        success: !!dependencyResolution,
        startTime: depStartTime,
        endTime: depEndTime,
        actual: {
          seedsCount: dependencyResolution?.seeds?.length || 0,
        },
      }
    );
    
    result.dependencyResolution = dependencyResolution;

    if (!dependencyResolution.allSatisfied) {
      logger.warn('[RpaFlowPipeline] Dependências faltantes detectadas', {
        missingCount: dependencyResolution.missingDependencies.length,
        requiredSeeds: dependencyResolution.requiredSeeds,
      });

      if (!autoExecuteSeeds) {
        result.warnings.push(
          `Existem ${dependencyResolution.missingDependencies.length} dependência(s) faltante(s). ` +
          `Seeds necessários: ${dependencyResolution.requiredSeeds.join(', ')}`
        );
        // Não bloqueia, apenas avisa
      } else {
        // PASSO 2: Execução de seeds RPA faltantes
        logger.info('[RpaFlowPipeline] Passo 2: Executando seeds RPA faltantes...');
        replay.recordEvent('seeds_execution_started', {
          seedsCount: dependencyResolution.requiredSeeds.length,
        });
        recording.recordAction({
          type: 'seed-execution',
          step: 'execute-seeds',
          value: { seedsCount: dependencyResolution.requiredSeeds.length },
        });
        
        const seedsStartTime = new Date().toISOString();
        const seedsResult = await executeRequiredSeeds(dependencyResolution.requiredSeeds, tenantId);
        const seedsEndTime = new Date().toISOString();
        
        replay.recordAction(
          { type: 'seeds_execution', step: 'execute-seeds' },
          {
            success: seedsResult.errors.length === 0,
            startTime: seedsStartTime,
            endTime: seedsEndTime,
            actual: {
              executedCount: seedsResult.executedSeeds.length,
              errorsCount: seedsResult.errors.length,
            },
          }
        );

        recordingSystem.recordAction({
          type: 'seed-execution',
          step: 'seeds-executed',
          value: {
            executedCount: seedsResult.executedSeeds.length,
            errorsCount: seedsResult.errors.length,
          },
        });
        
        result.executedSeeds = seedsResult.executedSeeds;
        result.errors.push(...seedsResult.errors);
        result.warnings.push(...seedsResult.warnings);

        // Re-verifica dependências após executar seeds
        const recheck = await rpaDependencyResolver.resolveDependencies(flow, tenantId);
        if (!recheck.allSatisfied) {
          result.errors.push(
            `Ainda existem dependências faltantes após executar seeds: ` +
            `${recheck.missingDependencies.map(d => d.identifier).join(', ')}`
          );
        }
      }
    }

    // PASSO 3: Validação do estado final do sistema
    logger.info('[RpaFlowPipeline] Passo 3: Validando estado final do sistema...');
    const validationResult = await validateSystemState(flow, tenantId);
    if (!validationResult.valid) {
      result.errors.push(...validationResult.errors);
      result.warnings.push(...validationResult.warnings);
    }

    // Se há erros críticos, não continua
    if (result.errors.length > 0) {
      logger.error('[RpaFlowPipeline] Erros críticos encontrados, abortando pipeline', {
        errors: result.errors,
      });
      return result;
    }

    // PASSO 4: Conversão Fluxo → Gravação RPA
    logger.info('[RpaFlowPipeline] Passo 4: Convertendo fluxo para gravação RPA...');
    recording.recordAction({
      type: 'flow-conversion',
      step: 'convert-flow',
      value: { flowId: flow.id },
    });
    const rpaRecording = flowToRpaConverter.convertFlowToRpaRecording(flow, {
      dependencyResolution,
      executedSeeds: result.executedSeeds,
      snapshot: dependencyResolution.snapshot,
    });
    result.recording = rpaRecording;
    recordingSystem.recordAction({
      type: 'flow-conversion',
      step: 'flow-converted',
      value: {
        recordingId: rpaRecording.id,
        stepsCount: rpaRecording.steps.length,
      },
    });

    // PASSO 5: Preview dos passos (já está no recording)
    logger.info('[RpaFlowPipeline] Passo 5: Preview dos passos gerado', {
      stepsCount: recording.steps.length,
    });

    // PASSO 6: Salvamento da gravação
    if (saveRecording) {
      logger.info('[RpaFlowPipeline] Passo 6: Salvando gravação RPA...');
      replay.recordEvent('recording_save_started');
      recordingSystem.recordAction({
        type: 'recording-save',
        step: 'save-recording',
        value: { recordingId: rpaRecording.id },
      });
      
      const saveStartTime = new Date().toISOString();
      await saveRpaRecording(rpaRecording);
      const saveEndTime = new Date().toISOString();
      
      replay.recordAction(
        { type: 'recording_save', step: 'save-recording' },
        {
          success: true,
          startTime: saveStartTime,
          endTime: saveEndTime,
        }
      );

      recordingSystem.recordAction({
        type: 'recording-save',
        step: 'recording-saved',
        value: { status: 'success' },
      });
      
      logger.info('[RpaFlowPipeline] Gravação salva com sucesso', {
        recordingId: rpaRecording.id,
      });
    }

    result.success = true;
    result.snapshot = dependencyResolution.snapshot;

    // Finaliza e salva replay
    replay.recordEvent('pipeline_completed', {
      recordingId: rpaRecording.id,
      stepsCount: rpaRecording.steps.length,
    });
    replay.stop();
    const replayPath = replay.save(replayId);
    result.replayPath = replayPath;

    // Finaliza e salva gravação
    recordingSystem.recordAction({
      type: 'pipeline-complete',
      step: 'complete',
      value: { status: 'success', recordingId: rpaRecording.id },
    });
    recordingSystem.stop();
    const recordingPath = recordingSystem.save(recordingId);
    result.recordingPath = recordingPath;

    logger.info('[RpaFlowPipeline] Pipeline concluído com sucesso', {
      flowId: flow.id,
      recordingId: rpaRecording.id,
      stepsCount: rpaRecording.steps.length,
      replayPath,
      recordingPath,
    });

  } catch (error) {
    // Registra erro no replay
    replay.recordError(error, 'rpa-flow-pipeline');
    replay.recordEvent('pipeline_failed', {
      error: error.message,
    });
    replay.stop();
    const replayPath = replay.save(`${replayId}-error`);
    result.replayPath = replayPath;

    // Registra erro na gravação
    recordingSystem.recordCustom('error', {
      step: 'pipeline-error',
      value: { error: error.message },
    });
    recordingSystem.stop();
    const recordingPath = recordingSystem.save(`${recordingId}-error`);
    result.recordingPath = recordingPath;
    
    logger.error('[RpaFlowPipeline] Erro no pipeline', {
      error: error.message,
      stack: error.stack,
      replayPath,
      recordingPath,
    });
    result.errors.push(error.message);
  }

  return result;
}

/**
 * Executa seeds RPA necessários.
 */
async function executeRequiredSeeds(requiredSeeds, tenantId) {
  const result = {
    executedSeeds: [],
    errors: [],
    warnings: [],
  };

  for (const seedName of requiredSeeds) {
    try {
      logger.info('[RpaFlowPipeline] Executando seed RPA', { seedName });

      // Tenta encontrar a gravação RPA correspondente ao seed
      const recordings = rpaService.listRecordings();
      const seedRecording = recordings.find(r => 
        r.name === seedName || 
        r.name.includes(seedName) ||
        r.id === seedName
      );

      if (!seedRecording) {
        result.warnings.push(`Seed RPA não encontrado: ${seedName}`);
        continue;
      }

      // Executa a gravação RPA
      const executionResult = await rpaService.executeRecording(seedRecording.id, {
        headless: true,
        slowMo: 100,
        timeout: 30000,
      }, {}, null);

      if (executionResult.success) {
        result.executedSeeds.push(seedName);
        logger.info('[RpaFlowPipeline] Seed executado com sucesso', { seedName });
      } else {
        result.errors.push(`Falha ao executar seed: ${seedName}`);
        logger.error('[RpaFlowPipeline] Falha ao executar seed', {
          seedName,
          error: executionResult.error,
        });
      }
    } catch (error) {
      result.errors.push(`Erro ao executar seed ${seedName}: ${error.message}`);
      logger.error('[RpaFlowPipeline] Erro ao executar seed', {
        seedName,
        error: error.message,
      });
    }
  }

  return result;
}

/**
 * Valida o estado final do sistema.
 */
async function validateSystemState(flow, tenantId) {
  const result = {
    valid: true,
    errors: [],
    warnings: [],
  };

  // Re-executa resolução de dependências para validar
  const resolution = await rpaDependencyResolver.resolveDependencies(flow, tenantId);

  if (!resolution.allSatisfied) {
    result.valid = false;
    result.errors.push(
      `Estado do sistema inválido: ${resolution.missingDependencies.length} dependência(s) ainda faltando`
    );
  }

  // Validações adicionais podem ser adicionadas aqui

  return result;
}

/**
 * Salva uma gravação RPA em arquivo.
 */
async function saveRpaRecording(recording) {
  // UNIFICADO: Tudo salva em /seeds/ agora
  const seedsDir = path.join(__dirname, '../../tests/rpa/seeds');
  
  // Garante que o diretório existe
  if (!fs.existsSync(seedsDir)) {
    fs.mkdirSync(seedsDir, { recursive: true });
  }

  // Adiciona flag source: automatic
  if (!recording.source) {
    recording.source = 'automatic';
  }

  const filename = `${recording.id}.json`;
  const filepath = path.join(seedsDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(recording, null, 2), 'utf8');

  logger.info('[RpaFlowPipeline] Gravação salva', {
    filepath,
    recordingId: recording.id,
    source: recording.source,
  });
}

/**
 * Obtém preview do pipeline sem executar.
 */
async function previewRpaFlowPipeline(flow, options = {}) {
  const tenantId = flow.tenantId; // Tenant deve ser fornecido no flow

  // Apenas resolve dependências e converte para preview
  const dependencyResolution = await rpaDependencyResolver.resolveDependencies(flow, tenantId);
  const recording = flowToRpaConverter.convertFlowToRpaRecording(flow, {
    dependencyResolution,
    executedSeeds: [],
    snapshot: dependencyResolution.snapshot,
  });

  return {
    dependencyResolution,
    recordingPreview: {
      id: recording.id,
      name: recording.name,
      stepsCount: recording.steps.length,
      steps: recording.steps.slice(0, 10), // Primeiros 10 passos como preview
      metadata: recording.metadata,
    },
  };
}

module.exports = {
  executeRpaFlowPipeline,
  previewRpaFlowPipeline,
};

