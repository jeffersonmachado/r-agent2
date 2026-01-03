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
  const flowsDir = path.join(__dirname, '..', '..', 'tests', 'rpa', 'flows');
  
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
  return {
    id: rpaTest.id,
    name: rpaTest.name || `Teste RPA - ${rpaTest.flowId}`,
    description: rpaTest.description || 'Teste RPA gerado automaticamente',
    version: rpaTest.version || '1.0.0',
    steps: rpaTest.steps || [],
    data: rpaTest.data || {},
    metadata: {
      ...rpaTest.metadata,
      convertedFromTest: true,
      convertedAt: new Date().toISOString(),
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

  const fileName = `${recording.id}.json`;
  const filePath = path.join(seedsDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify(recording, null, 2), 'utf8');

  logger.info('Gravação RPA temporária salva', { recordingId: recording.id, filePath });

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

/**
 * Salva fluxo em arquivo.
 * 
 * @param {Object} flow - Fluxo a ser salvo
 * @returns {string} Caminho do arquivo salvo
 */
function saveFlowToFile(flow) {
  const dataDir = path.join(__dirname, '..', '..', 'api', 'data');
  
  // Garante que o diretório existe
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const flowsFile = path.join(dataDir, 'flows.json');
  
  // Carrega fluxos existentes
  let flows = [];
  if (fs.existsSync(flowsFile)) {
    try {
      const content = fs.readFileSync(flowsFile, 'utf8');
      flows = JSON.parse(content);
      if (!Array.isArray(flows)) {
        flows = [];
      }
    } catch (err) {
      logger.warn('Erro ao carregar fluxos existentes, criando novo arquivo', { error: err.message });
      flows = [];
    }
  }

  // Remove fluxo existente com mesmo ID se houver
  flows = flows.filter(f => f.id !== flow.id);
  
  // Adiciona novo fluxo
  flows.push(flow);

  // Salva
  fs.writeFileSync(flowsFile, JSON.stringify(flows, null, 2), 'utf8');

  logger.info('Fluxo salvo', { flowId: flow.id, flowName: flow.name, filePath: flowsFile });

  return flowsFile;
}

/**
 * Remove fluxo do arquivo (rollback).
 * 
 * @param {string} flowId - ID do fluxo
 */
function removeFlowFromFile(flowId) {
  const dataDir = path.join(__dirname, '..', '..', 'api', 'data');
  const flowsFile = path.join(dataDir, 'flows.json');
  
  if (!fs.existsSync(flowsFile)) {
    return;
  }

  try {
    const content = fs.readFileSync(flowsFile, 'utf8');
    let flows = JSON.parse(content);
    if (!Array.isArray(flows)) {
      return;
    }

    // Remove fluxo
    const originalLength = flows.length;
    flows = flows.filter(f => f.id !== flowId);

    if (flows.length < originalLength) {
      fs.writeFileSync(flowsFile, JSON.stringify(flows, null, 2), 'utf8');
      logger.info('Fluxo removido (rollback)', { flowId, filePath: flowsFile });
    }
  } catch (err) {
    logger.error('Erro ao remover fluxo (rollback)', { error: err.message, flowId });
  }
}

/**
 * Executa e valida teste RPA.
 * 
 * @param {Object} rpaTest - Teste RPA gerado
 * @param {Object} options - Opções de execução
 * @returns {Promise<{success: boolean, executionId?: string, error?: string}>}
 */
async function executeAndValidateRpa(rpaTest, options = {}) {
  try {
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
          const error = status.error || 'Execução RPA falhou';
          logger.error('Teste RPA falhou', { executionId, testId: rpaTest.id, error });
          return { success: false, error, executionId };
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

  logger.info('Iniciando orquestração de geração', { 
    payloadName: payload.name,
    useRag: payload.useRag,
    useWebScraping: payload.useWebScraping,
    generateRpaTest: payload.generateRpaTest,
    dryRun,
  });

  try {
    // Passo 1: Valida payload com contrato
    const contractValidation = validateGenerationContract(payload);
    if (!contractValidation.valid) {
      throw new Error(`Validação de contrato falhou: ${contractValidation.errors.join('; ')}`);
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
        },
      };
    }

    // Passo 3: Gera fluxo usando IA
    logger.info('Gerando fluxo por IA', { descriptionLength: payload.description.length });
    const flow = await generateFlowFromDescription(payload.description, {
      tenantId,
      flowName: payload.name,
      useRag: payload.useRag,
      ragSources: payload.ragSources,
      useWebScraping: payload.useWebScraping,
      scrapingTargets: payload.scrapingTargets,
    });

    // Valida fluxo gerado
    const flowValidation = validateFlow(flow);
    if (!flowValidation.valid) {
      logger.warn('Fluxo gerado tem erros de validação', {
        errorCount: flowValidation.errors.length,
      });
    }

    // Passo 4: Gera teste RPA se solicitado
    let rpaArtifact = null;
    if (payload.generateRpaTest) {
      logger.info('Gerando teste RPA', { flowId: flow.id, rpaMode: payload.rpaMode });
      rpaArtifact = await generateRpaArtifact(flow, {
        tenantId,
        rpaMode: payload.rpaMode || 'infer',
        autoResolveDependencies: options.autoResolveDependencies || false,
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
        logger.error('Modo Bootstrap: RPA falhou, nada será persistido', {
          flowId: flow.id,
          testId: rpaArtifact.rpaTest.id,
          error: bootstrapValidation.error,
        });
        
        throw new Error(`Validação RPA falhou no modo Bootstrap: ${bootstrapValidation.error}`);
      }

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

      // Salva fluxo
      saveFlowToFile(flow);

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

    return {
      success: true,
      flowDefinition: flow,
      rpaTest: rpaArtifact?.rpaTest || null,
      dependencies: rpaArtifact?.dependencies || null,
      resolution: rpaArtifact?.resolution || null,
      metadata: auditMetadata,
      validation: {
        flow: flowValidation,
        contract: contractValidation,
        bootstrap: bootstrapValidation || null,
      },
      bootstrap: payload.bootstrap || false,
    };
  } catch (err) {
    logger.error('Erro na orquestração de geração', {
      error: err.message,
      stack: err.stack,
      payloadName: payload.name,
      bootstrap: payload.bootstrap || false,
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
  saveFlowToFile,
  removeFlowFromFile,
};

