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

      // Salva teste RPA em arquivo
      if (rpaArtifact.rpaTest) {
        const rpaFilePath = saveRpaTestFile(rpaArtifact.rpaTest);
        rpaArtifact.rpaTest.filePath = rpaFilePath;
      }
    }

    // Passo 5: Cria metadata de auditoria
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
      },
    };
  } catch (err) {
    logger.error('Erro na orquestração de geração', {
      error: err.message,
      stack: err.stack,
      payloadName: payload.name,
    });

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
};

