/**
 * Orquestrador de Geração de Fluxos e Testes RPA.
 * 
 * Este serviço coordena todo o processo de geração:
 * 1. Valida payload com generation.interface.json
 * 2. Resolve contexto (RAG / Scraping)
 * 3. Executa IA limitada ao escopo
 * 4. Gera FlowDefinition
 * 5. Gera arquivo de teste RPA compatível (se solicitado)
 * 6. Salva RPA em tests/rpa/flows/
 * 7. Registra metadata de auditoria
 * 
 * ⚠️ IMPORTANTE: Não executa RPA, apenas gera artefatos.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { validateGenerationContract } = require('../utils/contractValidator');
const { generateFlowFromDescription } = require('./flowGeneratorService');
const { analyzeFlowDependencies, resolveDependencies } = require('./rpaTestDependencyAnalyzer');
const { generateRpaTestFromFlow } = require('./rpaTestGeneratorService');
const { validateFlow } = require('../../engine/validator');
const { executeRecording, getExecutionStatus } = require('./rpaService');
const { ReplaySystem } = require('../../lib/replaySystem');
const { RecordingSystem } = require('../../lib/recordingSystem');

/**
 * Calcula hash do contrato para versionamento.
 * 
 * @param {Object} contract - Contrato carregado
 * @returns {string} Hash SHA256 do contrato
 */
function calculateContractHash(contract) {
  const contractString = JSON.stringify(contract, Object.keys(contract).sort());
  return crypto.createHash('sha256').update(contractString).digest('hex').substring(0, 16);
}

/**
 * Carrega o contrato de geração.
 * 
 * @returns {Object|null} Contrato carregado ou null
 */
function loadGenerationContract() {
  try {
    const contractPath = path.join(__dirname, '..', '..', 'contracts', 'generation.interface.json');
    if (!fs.existsSync(contractPath)) {
      logger.warn('Contrato de geração não encontrado');
      return null;
    }
    const content = fs.readFileSync(contractPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    logger.error('Erro ao carregar contrato de geração', err);
    return null;
  }
}

/**
 * Carrega o contrato RAG.
 * 
 * @returns {Object|null} Contrato RAG ou null
 */
function loadRagContract() {
  try {
    const contractPath = path.join(__dirname, '..', '..', 'contracts', 'rag.contract.json');
    if (!fs.existsSync(contractPath)) {
      logger.warn('[orchestrateGeneration] Contrato RAG não encontrado');
      return null;
    }
    const content = fs.readFileSync(contractPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    logger.error('[orchestrateGeneration] Erro ao carregar contrato RAG', err);
    return null;
  }
}

/**
 * Resolve contexto de conhecimento (RAG e Scraping).
 * 
 * @param {string} description - Descrição do fluxo
 * @param {Object} options - Opções (useRag, ragSources, useWebScraping, scrapingTargets)
 * @returns {Promise<Object>} Contexto resolvido
 */
async function resolveKnowledgeContext(description, options = {}) {
  const context = {
    rag: null,
    scraping: null,
    sources: [],
  };

  // RAG
  if (options.useRag && options.ragSources && options.ragSources.length > 0) {
    logger.info('Resolvendo contexto RAG', { sources: options.ragSources });
    // O contexto RAG é resolvido dentro do generateFlowFromDescription
    context.sources.push('rag');
    context.rag = {
      sources: options.ragSources,
      resolved: true,
    };
  }

  // Scraping
  if (options.useWebScraping && options.scrapingTargets && options.scrapingTargets.length > 0) {
    logger.info('Resolvendo contexto de scraping', { targets: options.scrapingTargets });
    // O scraping é resolvido dentro do generateFlowFromDescription
    context.sources.push('scraping');
    context.scraping = {
      targets: options.scrapingTargets,
      resolved: true,
    };
  }

  if (context.sources.length === 0) {
    context.sources.push('none');
  }

  return context;
}

/**
 * Gera artefato de teste RPA a partir de um fluxo.
 * 
 * @param {Object} flow - Fluxo gerado
 * @param {Object} options - Opções (rpaMode, autoResolveDependencies, tenantId)
 * @returns {Promise<Object>} Teste RPA gerado
 */
async function generateRpaArtifact(flow, options = {}) {
  const tenantId = options.tenantId || flow.tenantId || 'demo-tenant';
  const rpaMode = options.rpaMode || 'infer';
  const autoResolveDependencies = options.autoResolveDependencies || false;

  logger.info('Gerando artefato RPA', { 
    flowId: flow.id, 
    rpaMode,
    autoResolveDependencies 
  });

  // Passo 1: Analisa dependências
  const dependencies = await analyzeFlowDependencies(flow, tenantId);

  // Passo 2: Resolve dependências se solicitado
  let resolution = null;
  if (autoResolveDependencies && dependencies.seeds) {
    logger.info('Resolvendo dependências automaticamente', { flowId: flow.id });
    resolution = await resolveDependencies(dependencies.seeds, tenantId);
  }

  // Passo 3: Gera teste RPA
  const rpaTest = await generateRpaTestFromFlow(flow, dependencies, {
    tenantId,
    rpaMode,
    resolution,
  });

  return {
    rpaTest,
    dependencies,
    resolution,
  };
}

/**
 * Salva teste RPA em arquivo.
 * 
 * @param {Object} rpaTest - Teste RPA gerado
 * @returns {string} Caminho do arquivo salvo
 */
function saveRpaTestFile(rpaTest) {
  // Runtime: não gravar em `tests/`. Artefatos gerados vão para `rpa/flows/`.
  const flowsDir = path.join(__dirname, '..', '..', 'rpa', 'flows');
  
  // Garante que o diretório existe
  if (!fs.existsSync(flowsDir)) {
    fs.mkdirSync(flowsDir, { recursive: true });
  }

  const fileName = `${rpaTest.id}.json`;
  const filePath = path.join(flowsDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(rpaTest, null, 2), 'utf8');

  logger.info('Teste RPA salvo', { testId: rpaTest.id, filePath });

  return filePath;
}

/**
 * Converte teste RPA em gravação para execução.
 * 
 * @param {Object} rpaTest - Teste RPA gerado
 * @returns {Object} Gravação RPA
 */
function convertRpaTestToRecording(rpaTest) {
  // Copia os steps originais
  const steps = [...(rpaTest.steps || [])];
  
  // Converte asserts em steps de assert e insere nos steps
  if (rpaTest.asserts && rpaTest.asserts.length > 0) {
    // Ordena asserts por step
    const sortedAsserts = [...rpaTest.asserts].sort((a, b) => {
      const stepA = typeof a.step === 'number' ? a.step : parseInt(a.step) || 0;
      const stepB = typeof b.step === 'number' ? b.step : parseInt(b.step) || 0;
      return stepA - stepB;
    });
    
    // Insere asserts nos steps na posição correta
    // Começa do final para não alterar os índices
    for (let i = sortedAsserts.length - 1; i >= 0; i--) {
      const assert = sortedAsserts[i];
      const stepIndex = typeof assert.step === 'number' ? assert.step : parseInt(assert.step) || 0;
      
      // Cria step de assert a partir do assert
      const assertStep = {
        step: `step-${stepIndex + 1}`,
        action: 'assert',
        type: assert.type || 'visible',
        ...(assert.selector && { selector: assert.selector }),
        ...(assert.title && { title: assert.title }),
        ...(assert.page && { page: assert.page }),
        ...(assert.expected !== undefined && { expected: assert.expected }),
        ...(assert.exists !== undefined && { exists: assert.exists }),
        ...(assert.message && { message: assert.message }),
        ...(assert.description && { description: assert.description }),
      };
      
      // Valida que o assert tem pelo menos selector, title ou page
      if (!assertStep.selector && !assertStep.title && !assertStep.page) {
        logger.warn('Assert sem selector, title ou page - adicionando fallback', {
          assert,
          stepIndex,
          testId: rpaTest.id,
        });
        // Adiciona fallback: usa title da página se não tiver nada
        assertStep.title = assert.expected || 'Página carregada';
      }
      
      // Insere o assert step após o step correspondente
      // Se stepIndex for maior que o número de steps, adiciona no final
      if (stepIndex < steps.length) {
        steps.splice(stepIndex + 1, 0, assertStep);
      } else {
        steps.push(assertStep);
      }
    }
  }
  
  logger.info('Teste RPA convertido para gravação', {
    testId: rpaTest.id,
    originalStepsCount: rpaTest.steps?.length || 0,
    assertsCount: rpaTest.asserts?.length || 0,
    finalStepsCount: steps.length,
  });
  
  return {
    id: rpaTest.id,
    name: rpaTest.name || `Teste RPA - ${rpaTest.flowId}`,
    description: rpaTest.description || 'Teste RPA gerado automaticamente',
    version: rpaTest.version || '1.0.0',
    steps: steps,
    data: rpaTest.data || {},
    metadata: {
      ...rpaTest.metadata,
      convertedFromTest: true,
      convertedAt: new Date().toISOString(),
      originalStepsCount: rpaTest.steps?.length || 0,
      assertsCount: rpaTest.asserts?.length || 0,
    },
  };
}

/**
 * Salva gravação RPA temporária para execução.
 * 
 * @param {Object} recording - Gravação RPA
 * @returns {string} Caminho do arquivo salvo
 */
function saveTemporaryRecording(recording) {
  const seedsDir = path.join(__dirname, '..', '..', 'tests', 'rpa', 'seeds');
  
  // Garante que o diretório existe
  if (!fs.existsSync(seedsDir)) {
    fs.mkdirSync(seedsDir, { recursive: true });
  }

  // Adiciona flag source: automatic
  if (!recording.source) {
    recording.source = 'automatic';
  }

  const fileName = `${recording.id}.json`;
  const filePath = path.join(seedsDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(recording, null, 2), 'utf8');

  logger.info('Gravação RPA temporária salva', { recordingId: recording.id, filePath, source: recording.source });

  return filePath;
}

/**
 * Remove gravação RPA temporária.
 * 
 * @param {string} recordingId - ID da gravação
 */
function removeTemporaryRecording(recordingId) {
  const seedsDir = path.join(__dirname, '..', '..', 'tests', 'rpa', 'seeds');
  const filePath = path.join(seedsDir, `${recordingId}.json`);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info('Gravação RPA temporária removida', { recordingId, filePath });
  }
}

// Funções deprecated removidas - dados agora estão no banco de dados PostgreSQL

/**
 * Executa e valida teste RPA.
 * 
 * @param {Object} rpaTest - Teste RPA gerado
 * @param {Object} options - Opções de execução
 * @returns {Promise<{success: boolean, executionId?: string, error?: string}>}
 */
async function executeAndValidateRpa(rpaTest, options = {}) {
  try {
    // Normaliza URLs no teste antes de converter (garante que ações navigate tenham URL)
    const { normalizeRpaTestUrls } = require('../utils/urlNormalizer');
    normalizeRpaTestUrls(rpaTest);
    
    // Valida asserts antes de converter
    if (rpaTest.asserts && rpaTest.asserts.length > 0) {
      const invalidAsserts = [];
      rpaTest.asserts.forEach((assert, index) => {
        if (!assert.selector && !assert.title && !assert.page) {
          invalidAsserts.push({
            index,
            step: assert.step,
            assert,
          });
        }
      });
      
      if (invalidAsserts.length > 0) {
        logger.warn('Asserts inválidos encontrados - corrigindo automaticamente', {
          testId: rpaTest.id,
          invalidCount: invalidAsserts.length,
          invalidAsserts,
        });
        
        // Corrige asserts inválidos adicionando title como fallback
        invalidAsserts.forEach(({ index, assert }) => {
          if (!rpaTest.asserts[index].title && !rpaTest.asserts[index].selector && !rpaTest.asserts[index].page) {
            rpaTest.asserts[index].title = assert.expected || 'Página carregada';
            logger.info('Assert corrigido com title fallback', {
              assertIndex: index,
              step: assert.step,
              newTitle: rpaTest.asserts[index].title,
            });
          }
        });
      }
    }
    
    // Valida steps de assert antes de converter
    if (rpaTest.steps && rpaTest.steps.length > 0) {
      const invalidSteps = [];
      rpaTest.steps.forEach((step, index) => {
        if (step.action === 'assert' || step.type === 'assert') {
          if (!step.selector && !step.title && !step.page) {
            invalidSteps.push({
              index,
              step: step.step || `step-${index + 1}`,
              stepData: step,
            });
          }
        }
      });
      
      if (invalidSteps.length > 0) {
        logger.warn('Steps de assert inválidos encontrados - corrigindo automaticamente', {
          testId: rpaTest.id,
          invalidCount: invalidSteps.length,
          invalidSteps,
        });
        
        // Corrige steps inválidos
        invalidSteps.forEach(({ index, stepData }) => {
          if (!rpaTest.steps[index].title && !rpaTest.steps[index].selector && !rpaTest.steps[index].page) {
            rpaTest.steps[index].title = stepData.expected || 'Página carregada';
            logger.info('Step de assert corrigido com title fallback', {
              stepIndex: index,
              step: stepData.step,
              newTitle: rpaTest.steps[index].title,
            });
          }
        });
      }
    }
    
    // Converte teste em gravação
    const recording = convertRpaTestToRecording(rpaTest);
    
    // Salva temporariamente
    const recordingPath = saveTemporaryRecording(recording);
    
    try {
      // Executa gravação
      logger.info('Executando teste RPA para validação', { 
        testId: rpaTest.id, 
        recordingId: recording.id,
        stepsCount: recording.steps.length 
      });
      
      const executionResult = await executeRecording(recording.id, {
        headless: options.headless !== false, // Headless por padrão para validação
        slowMo: 100, // Rápido para validação
        timeout: 30000,
      }, {});
      
      const executionId = executionResult.executionId;
      
      // Aguarda conclusão (polling)
      let attempts = 0;
      const maxAttempts = 120; // 2 minutos máximo
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Aguarda 1 segundo
        
        const status = getExecutionStatus(executionId);
        
        if (!status) {
          throw new Error('Execução RPA não encontrada');
        }
        
        if (status.status === 'completed') {
          logger.info('Teste RPA executado com sucesso', { executionId, testId: rpaTest.id });
          return { success: true, executionId };
        }
        
        if (status.status === 'failed' || status.status === 'cancelled') {
          // Extrai mensagem de erro detalhada
          let error = status.error || 'Execução RPA falhou';
          
          // Tenta obter mais detalhes dos results
          if (status.results && status.results.errors && status.results.errors.length > 0) {
            const firstError = status.results.errors[0];
            const errorDetails = [];
            
            if (firstError.step) {
              errorDetails.push(`Step ${firstError.step}`);
            }
            if (firstError.action) {
              errorDetails.push(`Ação: ${firstError.action}`);
            }
            if (firstError.error) {
              errorDetails.push(firstError.error);
            }
            
            if (errorDetails.length > 0) {
              error = errorDetails.join(' - ');
            }
            
            // Se houver múltiplos erros, adiciona informação
            if (status.results.errors.length > 1) {
              error += ` (e mais ${status.results.errors.length - 1} erro(s))`;
            }
          }
          
          // Log detalhado de todos os erros
          const allErrors = status.results?.errors || [];
          logger.error('Teste RPA falhou', { 
            executionId, 
            testId: rpaTest.id, 
            error,
            errorsCount: allErrors.length,
            currentStep: status.currentStep,
            allErrors: allErrors.map((e, idx) => ({
              index: idx,
              step: e.step,
              action: e.action,
              error: e.error,
              message: e.message,
            })),
            firstError: allErrors[0] ? {
              step: allErrors[0].step,
              action: allErrors[0].action,
              error: allErrors[0].error,
              message: allErrors[0].message,
            } : null,
          });
          return { success: false, error, executionId, errors: allErrors };
        }
        
        attempts++;
      }
      
      // Timeout
      throw new Error('Timeout ao aguardar conclusão do teste RPA');
      
    } finally {
      // Remove gravação temporária
      removeTemporaryRecording(recording.id);
    }
  } catch (err) {
    logger.error('Erro ao executar teste RPA', { 
      error: err.message, 
      stack: err.stack,
      testId: rpaTest.id 
    });
    return { success: false, error: err.message };
  }
}

/**
 * Cria metadata de auditoria.
 * 
 * @param {Object} payload - Payload original
 * @param {Object} context - Contexto resolvido
 * @param {Object} flow - Fluxo gerado
 * @param {Object} rpaTest - Teste RPA gerado (opcional)
 * @param {Object} contract - Contrato usado
 * @returns {Object} Metadata de auditoria
 */
function createAuditMetadata(payload, context, flow, rpaTest, contract) {
  const contractHash = contract ? calculateContractHash(contract) : null;

  return {
    generatedAt: new Date().toISOString(),
    payload: {
      name: payload.name,
      description: payload.description?.substring(0, 200), // Limita tamanho
      useRag: payload.useRag || false,
      ragSources: payload.ragSources || [],
      useWebScraping: payload.useWebScraping || false,
      scrapingTargets: payload.scrapingTargets || [],
      generateRpaTest: payload.generateRpaTest || false,
      rpaMode: payload.rpaMode || null,
    },
    context: {
      sources: context.sources,
      rag: context.rag,
      scraping: context.scraping,
    },
    artifacts: {
      flowId: flow?.id,
      flowName: flow?.name,
      nodeCount: flow?.nodes?.length || 0,
      rpaTestId: rpaTest?.id || null,
      rpaTestSteps: rpaTest?.steps?.length || 0,
      rpaTestAsserts: rpaTest?.asserts?.length || 0,
    },
    contract: {
      hash: contractHash,
      version: contract?.version || null,
    },
  };
}

/**
 * Orquestra a geração completa de fluxo e teste RPA.
 * 
 * @param {Object} payload - Payload validado contra generation.interface.json
 * @param {Object} options - Opções adicionais (tenantId, dryRun)
 * @returns {Promise<Object>} Resultado da geração
 */
async function orchestrateGeneration(payload, options = {}) {
  const startTime = Date.now();
  const tenantId = options.tenantId || 'demo-tenant';
  const dryRun = options.dryRun || false;

  // Inicializa Sistema de Replay
  const replay = new ReplaySystem({
    storagePath: path.join(process.cwd(), 'replays', 'generation'),
    context: 'generation',
    enableScreenshots: false,
  });

  const replayId = `generate-${payload.name || 'unknown'}-${Date.now()}`;
  replay.start(replayId, {
    tenantId,
    payloadName: payload.name,
    useRag: payload.useRag,
    useWebScraping: payload.useWebScraping,
    generateRpaTest: payload.generateRpaTest,
    generateFlow: payload.generateFlow,
    generateSeed: payload.generateSeed,
    bootstrap: payload.bootstrap,
    dryRun,
  });

  logger.info('Iniciando orquestração de geração', { 
    payloadName: payload.name,
    useRag: payload.useRag,
    useWebScraping: payload.useWebScraping,
    generateRpaTest: payload.generateRpaTest,
    dryRun,
    replayId,
  });

  try {
    // Passo 1: Valida payload com contrato
    const validationStartTime = new Date().toISOString();
    const contractValidation = validateGenerationContract(payload);
    const validationEndTime = new Date().toISOString();
    
    replay.recordAction(
      { type: 'validation', step: 'validate-payload' },
      {
        success: contractValidation.valid,
        startTime: validationStartTime,
        endTime: validationEndTime,
        actual: {
          valid: contractValidation.valid,
          errors: contractValidation.errors,
        },
      }
    );

    recording.recordAction({
      type: 'validation',
      step: 'validate-payload',
      value: {
        valid: contractValidation.valid,
        errors: contractValidation.errors,
      },
    });
    
    if (!contractValidation.valid) {
      const error = new Error(`Validação de contrato falhou: ${contractValidation.errors.join('; ')}`);
      replay.recordError(error, 'validate-payload');
      recording.recordCustom('error', {
        step: 'validate-payload-error',
        value: { error: error.message },
      });
      replay.stop();
      replay.save(replayId);
      recording.stop();
      recording.save(recordingId);
      throw error;
    }

    // Carrega contrato para hash
    const contract = loadGenerationContract();

    // Passo 2: Resolve contexto de conhecimento
    const context = await resolveKnowledgeContext(payload.description, {
      useRag: payload.useRag,
      ragSources: payload.ragSources,
      useWebScraping: payload.useWebScraping,
      scrapingTargets: payload.scrapingTargets,
    });

    // Se for dry-run, retorna apenas validação e contexto
    if (dryRun) {
      logger.info('Modo DRY-RUN: retornando apenas validação e contexto');
      replay.recordEvent('dry_run_completed');
      recording.recordCustom('dry-run', {
        step: 'dry-run-completed',
        value: { status: 'completed' },
      });
      replay.stop();
      const replayPath = replay.save(replayId);
      recording.stop();
      const recordingPath = recording.save(recordingId);
      
      return {
        success: true,
        dryRun: true,
        validation: {
          contract: contractValidation,
          contractHash: contract ? calculateContractHash(contract) : null,
        },
        context,
        metadata: {
          generatedAt: new Date().toISOString(),
          duration: Date.now() - startTime,
          replayPath,
          recordingPath,
        },
      };
    }

    // Passo 3: Gera fluxo usando IA
    logger.info('Gerando fluxo por IA', { descriptionLength: payload.description.length });
    replay.recordEvent('flow_generation_started');
    recording.recordGeneration('flow', {
      description: payload.description,
      useRag: payload.useRag,
      useWebScraping: payload.useWebScraping,
    }, {
      step: 'generate-flow',
    });
    
    // Prepara opções com contexto RAG do pipeline (se disponível)
    const generationOptions = {
      tenantId,
      flowName: payload.name,
      useRag: payload.useRag,
      ragSources: payload.ragSources,
      useWebScraping: payload.useWebScraping,
      scrapingTargets: payload.scrapingTargets,
    };
    
    // Se contexto RAG foi fornecido pelo pipeline, usa ele (obrigatório quando useRag=true)
    if (payload.ragContext && payload.ragContext.enabled) {
      generationOptions.ragContext = {
        enabled: true,
        executionId: payload.ragContext.executionId || options.executionId || null,
        chunks: payload.ragContext.chunks || [],
        sources: payload.ragContext.sources || [],
      };
      
      logger.info('[orchestrateGeneration] Usando contexto RAG do pipeline', {
        executionId: generationOptions.ragContext.executionId,
        chunksCount: generationOptions.ragContext.chunks.length,
        sourcesCount: generationOptions.ragContext.sources.length,
      });
      
      // Validação obrigatória: se useRag=true, deve ter chunks suficientes
      const contract = loadRagContract();
      const minChunks = contract?.rag?.grounding?.minChunks || 3;
      if (generationOptions.ragContext.chunks.length < minChunks) {
        throw new Error(`Contexto RAG do pipeline tem apenas ${generationOptions.ragContext.chunks.length} chunks, mínimo requerido: ${minChunks}`);
      }
    } else if (payload.useRag) {
      // Se useRag=true mas não há contexto RAG, isso é um erro
      throw new Error('useRag=true mas contexto RAG não foi fornecido pelo pipeline. Etapa ragContextBuilt deve ser concluída antes.');
    }
    
    const flow = await generateFlowFromDescription(payload.description, generationOptions);

    // Valida fluxo gerado
    const flowValidation = validateFlow(flow);
    if (!flowValidation.valid) {
      logger.warn('Fluxo gerado tem erros de validação', {
        errorCount: flowValidation.errors.length,
      });
    }

    // Passo 4: Gera teste RPA se solicitado
    // Verifica tanto generateRpaTest quanto generate?.rpa ou bootstrap
    const shouldGenerateRpa = payload.generateRpaTest || 
                              payload.generate?.rpa || 
                              payload.bootstrap === true;
    
    let rpaArtifact = null;
    if (shouldGenerateRpa) {
      logger.info('Gerando teste RPA', { 
        flowId: flow.id, 
        rpaMode: payload.rpaMode,
        reason: payload.generateRpaTest ? 'generateRpaTest' : 
                payload.generate?.rpa ? 'generate.rpa' : 
                'bootstrap'
      });
      replay.recordEvent('rpa_generation_started', {
        flowId: flow.id,
        rpaMode: payload.rpaMode,
      });

      recording.recordGeneration('rpa', {
        flowId: flow.id,
        rpaMode: payload.rpaMode,
      }, {
        step: 'generate-rpa',
      });
      
      const rpaStartTime = new Date().toISOString();
      rpaArtifact = await generateRpaArtifact(flow, {
        tenantId,
        rpaMode: payload.rpaMode || 'infer',
        autoResolveDependencies: options.autoResolveDependencies || false,
      });
      const rpaEndTime = new Date().toISOString();
      
      replay.recordAction(
        { type: 'rpa_generation', step: 'generate-rpa' },
        {
          success: !!rpaArtifact?.rpaTest,
          startTime: rpaStartTime,
          endTime: rpaEndTime,
          actual: {
            rpaTestId: rpaArtifact?.rpaTest?.id,
            dependenciesCount: rpaArtifact?.dependencies?.seeds?.length || 0,
          },
        }
      );
      replay.recordEvent('rpa_generation_completed', {
        rpaTestId: rpaArtifact?.rpaTest?.id,
      });

      // No modo bootstrap, NÃO salva ainda - só salva se RPA passar
      if (!payload.bootstrap && rpaArtifact.rpaTest) {
        const rpaFilePath = saveRpaTestFile(rpaArtifact.rpaTest);
        rpaArtifact.rpaTest.filePath = rpaFilePath;
      }
    }

    // Passo 4.5: Modo Bootstrap - Executa e valida RPA antes de persistir
    let bootstrapValidation = null;
    if (payload.bootstrap === true && rpaArtifact?.rpaTest) {
      logger.info('Modo Bootstrap: Executando e validando RPA antes de persistir', {
        flowId: flow.id,
        testId: rpaArtifact.rpaTest.id,
      });

      bootstrapValidation = await executeAndValidateRpa(rpaArtifact.rpaTest, {
        headless: options.headless !== false,
      });

      if (!bootstrapValidation.success) {
        // Rollback: nada foi persistido ainda, apenas retorna erro
        const errorMessage = bootstrapValidation.error || 'Erro desconhecido na validação RPA';
        const errors = bootstrapValidation.errors || [];
        
        // Log detalhado com todos os erros
        logger.error('Modo Bootstrap: RPA falhou, nada será persistido', {
          flowId: flow.id,
          testId: rpaArtifact.rpaTest.id,
          error: errorMessage,
          executionId: bootstrapValidation.executionId,
          errorsCount: errors.length,
          allErrors: errors.map((e, idx) => ({
            index: idx,
            step: e.step,
            action: e.action,
            error: e.error,
            message: e.message,
          })),
          firstError: errors[0] ? {
            step: errors[0].step,
            action: errors[0].action,
            error: errors[0].error,
            message: errors[0].message,
          } : null,
          fullBootstrapValidation: JSON.stringify(bootstrapValidation, null, 2),
        });
        
        replay.recordEvent('bootstrap_validation_failed', {
          error: errorMessage,
          errorsCount: errors.length,
        });
        throw new Error(`Validação RPA falhou no modo Bootstrap: ${errorMessage}`);
      }

      replay.recordEvent('bootstrap_validation_passed', {
        rpaTestId: rpaArtifact.rpaTest.id,
      });
      
      logger.info('Modo Bootstrap: RPA passou, prosseguindo com persistência', {
        flowId: flow.id,
        testId: rpaArtifact.rpaTest.id,
      });
    }

    // Passo 5: Persiste artefatos (apenas se não for bootstrap ou se RPA passou)
    if (payload.bootstrap !== true) {
      // Modo normal: persiste fluxo se necessário
      // (O fluxo geralmente é persistido pelo chamador, mas podemos salvar aqui também)
    } else {
      // Modo Bootstrap: persiste tudo agora que RPA passou
      logger.info('Modo Bootstrap: Persistindo artefatos após validação RPA bem-sucedida', {
        flowId: flow.id,
      });

      // 🚫 Gate de validação OBRIGATÓRIA para fluxos gerados por IA antes de persistir
      // Fluxos gerados por IA DEVEM passar pelo gate antes de serem salvos
      const isAiGenerated = flow.metadata?.generatedBy === 'ai' || flow.metadata?.generated === true;
      if (isAiGenerated) {
        const { validateGeneratedPlanOrThrow } = require('../../engine/ai/validateGeneratedPlan');
        try {
          validateGeneratedPlanOrThrow(flow, 'chatbot');
          logger.info('[orchestrateGeneration] Fluxo gerado por IA passou no gate de validação antes de persistir', {
            flowId: flow.id,
            flowName: flow.name
          });
        } catch (validationError) {
          logger.error('[orchestrateGeneration] Gate de validação bloqueou fluxo gerado por IA', {
            flowId: flow.id,
            flowName: flow.name,
            error: validationError.message
          });
          throw new Error(`Gate de validação bloqueou fluxo gerado por IA: ${validationError.message}`);
        }
      }

      // Salva fluxo
      // Dados agora estão no banco de dados PostgreSQL

      // Salva teste RPA
      if (rpaArtifact?.rpaTest) {
        const rpaFilePath = saveRpaTestFile(rpaArtifact.rpaTest);
        rpaArtifact.rpaTest.filePath = rpaFilePath;
      }

      // TODO: Salvar seed base se necessário
      // (Implementar quando houver serviço de seed)
    }

    // Passo 6: Cria metadata de auditoria
    const auditMetadata = createAuditMetadata(
      payload,
      context,
      flow,
      rpaArtifact?.rpaTest,
      contract
    );

    const duration = Date.now() - startTime;

    logger.info('Orquestração de geração concluída', {
      flowId: flow.id,
      rpaTestId: rpaArtifact?.rpaTest?.id,
      bootstrap: payload.bootstrap || false,
      bootstrapValidation: bootstrapValidation?.success || null,
      duration,
    });

    // Prepara informações de RAG para o resultado (obrigatório quando useRag=true)
    const ragInfo = {
      used: false,
      executionId: null,
      sources: [],
    };
    
    if (payload.useRag && payload.ragContext && payload.ragContext.enabled) {
      ragInfo.used = true;
      ragInfo.executionId = payload.ragContext.executionId || options.executionId || null;
      ragInfo.sources = payload.ragContext.sources.map(s => s.documentId || s);
      
      logger.info('[orchestrateGeneration] RAG utilizado na geração', {
        executionId: ragInfo.executionId,
        sourcesCount: ragInfo.sources.length,
      });
    }

    // Finaliza e salva replay
    replay.recordEvent('generation_completed', {
      flowId: flow?.id,
      rpaTestId: rpaArtifact?.rpaTest?.id,
    });
    replay.stop();
    const replayPath = replay.save(replayId);
    
    logger.info('Orquestração de geração concluída', {
      payloadName: payload.name,
      replayPath,
    });

    return {
      success: true,
      flowDefinition: flow,
      rpaTest: rpaArtifact?.rpaTest || null,
      dependencies: rpaArtifact?.dependencies || null,
      resolution: rpaArtifact?.resolution || null,
      metadata: {
        ...auditMetadata,
        replayPath,
      },
      validation: {
        flow: flowValidation,
        contract: contractValidation,
        bootstrap: bootstrapValidation || null,
      },
      bootstrap: payload.bootstrap || false,
      // Informações de RAG (obrigatórias quando useRag=true)
      ragUsed: ragInfo.used,
      ragExecutionId: ragInfo.executionId,
      ragSources: ragInfo.sources,
    };
  } catch (err) {
    // Registra erro no replay
    replay.recordError(err, 'orchestrate-generation');
    replay.recordEvent('generation_failed', {
      error: err.message,
    });
    replay.stop();
    const replayPath = replay.save(`${replayId}-error`);

    // Registra erro na gravação
    recording.recordCustom('error', {
      step: 'generation-error',
      value: { error: err.message },
    });
    recording.stop();
    const recordingPath = recording.save(`${recordingId}-error`);
    
    logger.error('Erro na orquestração de geração', {
      error: err.message,
      stack: err.stack,
      payloadName: payload.name,
      bootstrap: payload.bootstrap || false,
      replayPath,
      recordingPath,
    });

    // No modo bootstrap, se algo falhou, garante que nada foi persistido
    if (payload.bootstrap === true) {
      logger.info('Modo Bootstrap: Garantindo rollback completo após erro', {
        payloadName: payload.name,
      });
      // Nada foi persistido ainda (ou já foi removido), então apenas log
    }

    throw err;
  }
}

module.exports = {
  orchestrateGeneration,
  resolveKnowledgeContext,
  generateRpaArtifact,
  saveRpaTestFile,
  createAuditMetadata,
  calculateContractHash,
  executeAndValidateRpa,
};

