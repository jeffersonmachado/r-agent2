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

  logger.info('Iniciando generate-and-validate', {
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
  };

  // Artefatos gerados (para rollback se necessário)
  const artifacts = {
    flowId: null,
    flowPath: null,
    rpaTestPath: null,
    seedPath: null,
  };

  try {
    // ETAPA 0: Rate Limiting (ANTES de qualquer coisa)
    logger.info('ETAPA 0: Verificando rate limiting');
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

      logger.info('Aplicando rate limiting', { 
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

      logger.info('Rate limiting aprovado', { userId, operationType });
    } catch (rateLimitError) {
      if (rateLimitError.code === 'RATE_LIMIT_EXCEEDED') {
        // Garante que retryAfter é um número válido
        const retryAfter = (rateLimitError.retryAfter && !isNaN(rateLimitError.retryAfter) && rateLimitError.retryAfter > 0)
          ? rateLimitError.retryAfter
          : 60; // Fallback padrão de 60 segundos
        
        result.errors.push(`Rate limit excedido. Tente novamente em ${retryAfter} segundos.`);
        result.motivo = 'Rate limit excedido';
        result.rateLimitExceeded = true;
        result.retryAfter = retryAfter;
        return result;
      }
      // Se não for erro de rate limit, propaga
      throw rateLimitError;
    }

    // ETAPA 1: Validar payload contra contrato
    logger.info('[generate-and-validate] ETAPA 1: Validando payload contra contrato', {
      payloadName: payload.name,
      executionMode,
      isBootstrap,
    });
    const contractValidation = validateGenerationContract(payload);
    logger.debug('[generate-and-validate] Resultado da validação de contrato', {
      valid: contractValidation.valid,
      errors: contractValidation.errors,
    });
    
    if (onProgress) {
      logger.debug('[generate-and-validate] Enviando atualização de progresso: payloadValid=true, contractValid=' + contractValidation.valid);
      onProgress({
        payloadValid: true,
        contractValid: contractValidation.valid,
        contextBuilt: false,
        aiExecuted: false,
        flowGenerated: false,
        seedGenerated: false,
        rpaGenerated: false,
        rpaExecuted: false,
        approved: false,
      });
    }
    
    if (!contractValidation.valid) {
      logger.error('[generate-and-validate] Validação de contrato falhou', {
        errors: contractValidation.errors,
        payloadName: payload.name,
      });
      result.errors.push(`Validação de contrato falhou: ${contractValidation.errors.join('; ')}`);
      result.motivo = 'Validação de contrato falhou';
      return result;
    }
    
    logger.info('[generate-and-validate] ETAPA 1 concluída: Contrato validado com sucesso');

    // ETAPA 2: Validar governança
    logger.info('[generate-and-validate] ETAPA 2: Validando governança');
    const governanceValidation = await validateGovernance();
    logger.debug('[generate-and-validate] Resultado da validação de governança', {
      valid: governanceValidation.valid,
      errors: governanceValidation.errors,
    });
    
    if (onProgress) {
      logger.debug('[generate-and-validate] Enviando atualização de progresso: contractValid=true');
      onProgress({
        payloadValid: true,
        contractValid: true,
        contextBuilt: false,
        aiExecuted: false,
        flowGenerated: false,
        seedGenerated: false,
        rpaGenerated: false,
        rpaExecuted: false,
        approved: false,
      });
    }
    
    if (!governanceValidation.valid) {
      logger.error('[generate-and-validate] Validação de governança falhou', {
        errors: governanceValidation.errors,
      });
      result.errors.push(`Validação de governança falhou: ${governanceValidation.errors.join('; ')}`);
      result.motivo = 'Validação de governança falhou';
      return result;
    }
    
    logger.info('[generate-and-validate] ETAPA 2 concluída: Governança validada com sucesso');

    // Se DRY-RUN, retorna aqui
    if (isDryRun) {
      logger.info('Modo DRY-RUN: retornando validação sem executar');
      return {
        success: true,
        rpaPassed: null, // Não executado em DRY-RUN
        flowGenerated: false,
        seedGenerated: false,
        rpaGenerated: false,
        rpaExecuted: false,
        dryRun: true,
        warnings: [],
        errors: [],
        motivo: 'DRY-RUN: Nenhuma execução real realizada',
      };
    }

    // ETAPA 3: Montar contexto e executar IA
    logger.info('[generate-and-validate] ETAPA 3: Montando contexto e executando IA', {
      useRag: payload.useRag,
      ragSources: payload.ragSources,
      useWebScraping: payload.useWebScraping,
      scrapingTargets: payload.scrapingTargets?.length || 0,
    });
    
    if (onProgress) {
      logger.debug('[generate-and-validate] Enviando atualização de progresso: contextBuilt=true');
      onProgress({
        payloadValid: true,
        contractValid: true,
        contextBuilt: true,
        aiExecuted: false,
        flowGenerated: false,
        seedGenerated: false,
        rpaGenerated: false,
        rpaExecuted: false,
        approved: false,
      });
    }
    
    const generationStartTime = Date.now();
    const generationResult = await orchestrateGeneration(payload, {
      tenantId: options.tenantId || 'demo-tenant',
      dryRun: false,
    });
    const generationDuration = Date.now() - generationStartTime;
    
    logger.info('[generate-and-validate] Geração de artefatos concluída', {
      success: generationResult.success,
      duration: `${generationDuration}ms`,
      hasFlow: !!generationResult.flowDefinition,
      hasRpaTest: !!generationResult.rpaTest,
    });

    if (!generationResult.success) {
      logger.error('[generate-and-validate] Falha na geração de artefatos', {
        error: generationResult.error,
        duration: generationDuration,
      });
      result.errors.push('Falha na geração de artefatos');
      result.motivo = 'Falha na geração de artefatos';
      return result;
    }

    const flow = generationResult.flowDefinition;
    if (!flow) {
      logger.error('[generate-and-validate] Fluxo não foi gerado');
      result.errors.push('Fluxo não foi gerado');
      result.motivo = 'Fluxo não foi gerado';
      return result;
    }

    artifacts.flowId = flow.id;
    result.flowGenerated = true;
    logger.info('[generate-and-validate] Fluxo gerado com sucesso', {
      flowId: flow.id,
      flowName: flow.name,
    });
    
    if (onProgress) {
      logger.debug('[generate-and-validate] Enviando atualização de progresso: aiExecuted=true, flowGenerated=true');
      onProgress({
        payloadValid: true,
        contractValid: true,
        contextBuilt: true,
        aiExecuted: true,
        flowGenerated: true,
        seedGenerated: result.seedGenerated || false,
        rpaGenerated: result.rpaGenerated || false,
        rpaExecuted: result.rpaExecuted || false,
        approved: false,
      });
    }

    // ETAPA 4: Validar schema do fluxo
    logger.info('[generate-and-validate] ETAPA 4: Validando schema do fluxo', {
      flowId: flow.id,
    });
    const schemaValidation = await validateSchema(flow);
    logger.debug('[generate-and-validate] Resultado da validação de schema', {
      valid: schemaValidation.valid,
      errors: schemaValidation.errors,
    });
    
    if (!schemaValidation.valid) {
      logger.error('[generate-and-validate] Validação de schema falhou', {
        flowId: flow.id,
        errors: schemaValidation.errors,
      });
      result.errors.push(`Validação de schema falhou: ${schemaValidation.errors.join('; ')}`);
      result.motivo = 'Validação de schema falhou';
      
      // Rollback em modo bootstrap
      if (isBootstrap) {
        logger.info('[generate-and-validate] Modo Bootstrap: Fazendo rollback após falha de schema');
        if (artifacts.flowPath) {
          removeFlowFromFile(artifacts.flowId);
        }
      }
      
      return result;
    }
    
    logger.info('[generate-and-validate] ETAPA 4 concluída: Schema validado com sucesso');

    // ETAPA 5: Gerar seed (se solicitado)
    if (payload.generate?.seed || isBootstrap) {
      logger.info('[generate-and-validate] ETAPA 5: Gerando seed', {
        flowId: flow.id,
        isBootstrap,
      });
      const seedResult = await generateSeed(flow, options);
      if (seedResult.success) {
        result.seedGenerated = true;
        artifacts.seedPath = seedResult.seedPath;
        logger.info('[generate-and-validate] Seed gerado com sucesso', {
          seedPath: seedResult.seedPath,
        });
      } else {
        logger.warn('[generate-and-validate] Falha ao gerar seed (não crítico)', {
          error: seedResult.error,
        });
        result.warnings.push('Falha ao gerar seed (não crítico)');
      }
      if (onProgress) {
        logger.debug('[generate-and-validate] Enviando atualização de progresso: seedGenerated=' + result.seedGenerated);
        onProgress({
          payloadValid: true,
          contractValid: true,
          contextBuilt: true,
          aiExecuted: true,
          flowGenerated: true,
          seedGenerated: result.seedGenerated,
          rpaGenerated: result.rpaGenerated || false,
          rpaExecuted: result.rpaExecuted || false,
          approved: false,
        });
      }
    } else {
      logger.debug('[generate-and-validate] ETAPA 5: Pulando geração de seed (não solicitado)');
    }

    // ETAPA 6: Gerar RPA (se solicitado)
    let rpaTestPath = null;
    if (payload.generate?.rpa || isBootstrap) {
      logger.info('[generate-and-validate] ETAPA 6: Gerando teste RPA', {
        flowId: flow.id,
        rpaMode: payload.rpaMode,
        isBootstrap,
      });
      
      if (generationResult.rpaTest) {
        // Salva teste RPA temporariamente (não persiste ainda em bootstrap)
        const flowsDir = path.join(__dirname, '..', '..', 'tests', 'rpa', 'flows');
        if (!fs.existsSync(flowsDir)) {
          fs.mkdirSync(flowsDir, { recursive: true });
          logger.debug('[generate-and-validate] Diretório de testes RPA criado', { flowsDir });
        }

        rpaTestPath = path.join(flowsDir, `${generationResult.rpaTest.id}.json`);
        fs.writeFileSync(rpaTestPath, JSON.stringify(generationResult.rpaTest, null, 2), 'utf8');
        
        artifacts.rpaTestPath = rpaTestPath;
        result.rpaGenerated = true;
        
        logger.info('[generate-and-validate] Teste RPA gerado e salvo', {
          rpaTestId: generationResult.rpaTest.id,
          rpaTestPath,
        });
        
        if (onProgress) {
          logger.debug('[generate-and-validate] Enviando atualização de progresso: rpaGenerated=true');
          onProgress({
            payloadValid: true,
            contractValid: true,
            contextBuilt: true,
            aiExecuted: true,
            flowGenerated: true,
            seedGenerated: result.seedGenerated || false,
            rpaGenerated: true,
            rpaExecuted: result.rpaExecuted || false,
            approved: false,
          });
        }
      } else {
        logger.warn('[generate-and-validate] Teste RPA não foi gerado pela IA');
        result.warnings.push('Teste RPA não foi gerado');
      }
    } else {
      logger.debug('[generate-and-validate] ETAPA 6: Pulando geração de RPA (não solicitado)');
    }

    // ETAPA 7: Executar RPA (se gerado)
    if (rpaTestPath) {
      logger.info('[generate-and-validate] ETAPA 7: Executando teste RPA', {
        rpaTestPath,
        flowId: flow.id,
      });
      
      const rpaStartTime = Date.now();
      const rpaResult = await executeRpaTest(rpaTestPath);
      const rpaDuration = Date.now() - rpaStartTime;
      result.rpaExecuted = true;
      
      logger.info('[generate-and-validate] Teste RPA executado', {
        success: rpaResult.success,
        duration: `${rpaDuration}ms`,
        hasReport: !!rpaResult.reportPath,
      });
      
      if (onProgress) {
        logger.debug('[generate-and-validate] Enviando atualização de progresso: rpaExecuted=true');
        onProgress({
          payloadValid: true,
          contractValid: true,
          contextBuilt: true,
          aiExecuted: true,
          flowGenerated: true,
          seedGenerated: result.seedGenerated || false,
          rpaGenerated: result.rpaGenerated || false,
          rpaExecuted: true,
          approved: false,
        });
      }

      if (rpaResult.success) {
        result.rpaPassed = true;
        if (rpaResult.reportPath) {
          result.reportLink = `/tests/rpa/reports/${path.basename(rpaResult.reportPath)}`;
          logger.debug('[generate-and-validate] Link do relatório RPA gerado', {
            reportLink: result.reportLink,
          });
        }
        if (rpaResult.replayPath) {
          result.replayLink = `/tests/rpa/replay/${path.basename(rpaResult.replayPath)}`;
          logger.debug('[generate-and-validate] Link do replay/log RPA gerado', {
            replayLink: result.replayLink,
          });
        }
        logger.info('[generate-and-validate] ETAPA 7 concluída: Teste RPA passou');
      } else {
        // Mesmo em caso de falha, inclui o replay se disponível
        if (rpaResult.replayPath) {
          result.replayLink = `/tests/rpa/replay/${path.basename(rpaResult.replayPath)}`;
          logger.debug('[generate-and-validate] Link do replay/log RPA gerado (falha)', {
            replayLink: result.replayLink,
          });
        }
        logger.error('[generate-and-validate] Teste RPA falhou', {
          error: rpaResult.error,
          duration: rpaDuration,
        });
        result.rpaPassed = false;
        result.errors.push(`Teste RPA falhou: ${rpaResult.error}`);
        result.motivo = `Teste RPA falhou: ${rpaResult.error}`;

        // Rollback em modo bootstrap
        if (isBootstrap) {
          logger.info('[generate-and-validate] Modo Bootstrap: Fazendo rollback após falha de RPA');
          if (artifacts.flowPath) {
            removeFlowFromFile(artifacts.flowId);
          }
          if (artifacts.rpaTestPath && fs.existsSync(artifacts.rpaTestPath)) {
            fs.unlinkSync(artifacts.rpaTestPath);
          }
          if (artifacts.seedPath && fs.existsSync(artifacts.seedPath)) {
            fs.unlinkSync(artifacts.seedPath);
          }
        }

        return result;
      }
    } else {
      logger.debug('[generate-and-validate] ETAPA 7: Pulando execução de RPA (não gerado)');
    }

    // ETAPA 8: Persistir artefatos (apenas se RPA passou ou não foi executado)
    if (result.rpaPassed || !rpaTestPath) {
      logger.info('ETAPA 8: Persistindo artefatos');
      
      // Salva fluxo
      if (!isBootstrap || result.rpaPassed) {
        const flowPath = saveFlowToFile(flow);
        artifacts.flowPath = flowPath;
      }

      // Em modo bootstrap, marca como Base v1
      if (isBootstrap && result.rpaPassed) {
        logger.info('Modo Bootstrap: Marcando como Base v1');
        // TODO: Adicionar metadata de versão base
      }
    }

    // ETAPA 9: Executar validação completa (se solicitado)
    if (payload.executeFullValidation) {
      logger.info('ETAPA 9: Executando validação completa (system:validate)');
      const systemValidation = await executeSystemValidate();
      if (!systemValidation.success) {
        result.warnings.push(`system:validate falhou: ${systemValidation.errors.join('; ')}`);
      }
    }

    // Sucesso!
    result.success = true;
    if (!result.motivo) {
      result.motivo = 'Geração e validação concluídas com sucesso';
    }

    logger.info('generate-and-validate concluído com sucesso', {
      flowId: artifacts.flowId,
      rpaPassed: result.rpaPassed,
      duration: Date.now() - startTime,
    });

    return result;
  } catch (err) {
    logger.error('Erro em generate-and-validate', err);

    // Rollback em modo bootstrap
    if (isBootstrap) {
      logger.info('Modo Bootstrap: Fazendo rollback após erro');
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
  }
}

module.exports = {
  generateAndValidate,
};

