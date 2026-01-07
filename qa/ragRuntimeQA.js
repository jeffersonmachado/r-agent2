/**
 * Gate de QA Específico para RAG
 * 
 * Responsabilidades:
 * - Validar uso obrigatório de RAG quando habilitado
 * - Validar quantidade mínima de fontes
 * - Validar que IA declarou uso de RAG
 * - Bloquear execução se RAG falhar
 * 
 * REGRAS OBRIGATÓRIAS:
 * - useRag === true e rag.used === false → ❌ FAIL
 * - rag.sources.length < minChunks → ❌ FAIL
 * - IA respondeu sem fontes → ❌ FAIL
 * - Etapa ragContextBuilt pulada → ❌ FAIL
 */

const logger = require('../api/utils/logger');
const fs = require('fs');
const path = require('path');

/**
 * Carrega o contrato RAG.
 * 
 * @returns {Object|null} Contrato RAG ou null
 */
function loadRagContract() {
  try {
    const contractPath = path.join(__dirname, '..', 'contracts', 'rag.contract.json');
    if (!fs.existsSync(contractPath)) {
      logger.warn('[ragRuntimeQA] Contrato RAG não encontrado');
      return null;
    }
    const content = fs.readFileSync(contractPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    logger.error('[ragRuntimeQA] Erro ao carregar contrato RAG', err);
    return null;
  }
}

/**
 * Valida uso de RAG em uma execução.
 * 
 * @param {Object} execution - Contexto da execução
 * @param {Object} aiResponse - Resposta da IA (opcional)
 * @returns {Object} Resultado da validação
 * @returns {boolean} valid - Se a validação passou
 * @returns {Array} errors - Lista de erros encontrados
 * @returns {Array} warnings - Lista de avisos
 */
function validateRagUsage(execution, aiResponse = null) {
  const errors = [];
  const warnings = [];
  
  const useRag = execution.payload?.useRag !== false;
  
  // Se RAG não está habilitado, não há validação necessária
  if (!useRag) {
    return {
      valid: true,
      errors: [],
      warnings: [],
    };
  }
  
  // Carrega contrato RAG
  const contract = loadRagContract();
  if (!contract) {
    errors.push('Contrato RAG não encontrado');
    return {
      valid: false,
      errors,
      warnings,
    };
  }
  
  const minChunks = contract.rag?.grounding?.minChunks || 3;
  const mandatoryWhenEnabled = contract.rag?.grounding?.mandatoryWhenEnabled !== false;
  
  // Validação 1: Etapa ragContextBuilt deve estar concluída
  if (!execution.stages?.ragContextBuilt) {
    const errorMsg = 'Etapa ragContextBuilt não foi concluída. RAG é obrigatório quando useRag=true.';
    errors.push(errorMsg);
    logger.error('[ragRuntimeQA] Etapa ragContextBuilt não concluída', {
      executionId: execution.executionId,
    });
  }
  
  // Validação 2: Contexto RAG deve estar disponível
  if (!execution.ragContext || !execution.ragContext.success) {
    const errorMsg = 'Contexto RAG não está disponível ou falhou. Não é possível validar uso de RAG.';
    errors.push(errorMsg);
    logger.error('[ragRuntimeQA] Contexto RAG não disponível', {
      executionId: execution.executionId,
      hasRagContext: !!execution.ragContext,
      ragContextSuccess: execution.ragContext?.success,
    });
  } else {
    // Validação 3: Quantidade mínima de chunks
    const chunksCount = execution.ragContext.chunks?.length || 0;
    if (chunksCount < minChunks) {
      const errorMsg = `RAG retornou apenas ${chunksCount} chunks, mínimo requerido: ${minChunks}`;
      if (mandatoryWhenEnabled) {
        errors.push(errorMsg);
      } else {
        warnings.push(errorMsg);
      }
      logger.warn('[ragRuntimeQA] Chunks insuficientes', {
        executionId: execution.executionId,
        chunksCount,
        minChunks,
      });
    }
    
    // Validação 4: Quantidade mínima de fontes
    const sourcesCount = execution.ragContext.sources?.length || 0;
    if (sourcesCount < 1) {
      const errorMsg = 'RAG não retornou nenhuma fonte. Grounding inválido.';
      errors.push(errorMsg);
      logger.error('[ragRuntimeQA] Nenhuma fonte RAG', {
        executionId: execution.executionId,
      });
    }
  }
  
  // Validação 5: IA deve declarar uso de RAG (se resposta disponível)
  if (aiResponse) {
    const ragUsed = aiResponse.rag?.used || false;
    const ragSources = aiResponse.rag?.sources || [];
    const ragExecutionId = aiResponse.rag?.executionId || null;
    
    if (!ragUsed) {
      const errorMsg = 'IA não declarou uso de RAG. Quando useRag=true, IA DEVE declarar uso de RAG.';
      errors.push(errorMsg);
      logger.error('[ragRuntimeQA] IA não declarou uso de RAG', {
        executionId: execution.executionId,
      });
    } else {
      // Validação 6: IA deve declarar executionId
      if (!ragExecutionId) {
        const errorMsg = 'IA declarou uso de RAG mas não declarou executionId. executionId é obrigatório.';
        errors.push(errorMsg);
        logger.error('[ragRuntimeQA] IA não declarou executionId no RAG', {
          executionId: execution.executionId,
        });
      } else {
        // Validação 7: executionId declarado deve corresponder ao da execução
        if (ragExecutionId !== execution.executionId) {
          const errorMsg = `IA declarou executionId diferente (${ragExecutionId} vs ${execution.executionId}). executionId deve corresponder à execução atual.`;
          errors.push(errorMsg);
          logger.error('[ragRuntimeQA] executionId não corresponde', {
            executionId: execution.executionId,
            declaredExecutionId: ragExecutionId,
          });
        }
      }
      
      // Validação 8: IA deve declarar fontes
      if (ragSources.length === 0) {
        const errorMsg = 'IA declarou uso de RAG mas não declarou fontes. Fontes são obrigatórias.';
        errors.push(errorMsg);
        logger.error('[ragRuntimeQA] IA não declarou fontes RAG', {
          executionId: execution.executionId,
        });
      } else {
        // Validação 9: Fontes declaradas devem corresponder ao contexto
        if (execution.ragContext && execution.ragContext.sources) {
          const contextSourceIds = execution.ragContext.sources.map(s => s.documentId || s);
          const declaredSourceIds = ragSources;
          
          // Verifica se pelo menos uma fonte declarada corresponde ao contexto
          const hasMatchingSource = declaredSourceIds.some(declared => 
            contextSourceIds.some(context => 
              context === declared || context.includes(declared) || declared.includes(context)
            )
          );
          
          if (!hasMatchingSource) {
            warnings.push('Fontes declaradas pela IA não correspondem completamente ao contexto RAG construído.');
            logger.warn('[ragRuntimeQA] Fontes não correspondem', {
              executionId: execution.executionId,
              contextSources: contextSourceIds,
              declaredSources: declaredSourceIds,
            });
          }
        }
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Valida RAG antes da execução da IA.
 * 
 * @param {Object} execution - Contexto da execução
 * @returns {Object} Resultado da validação
 */
function validateRagBeforeAI(execution) {
  return validateRagUsage(execution, null);
}

/**
 * Valida RAG após a execução da IA.
 * 
 * @param {Object} execution - Contexto da execução
 * @param {Object} aiResponse - Resposta da IA
 * @returns {Object} Resultado da validação
 */
function validateRagAfterAI(execution, aiResponse) {
  return validateRagUsage(execution, aiResponse);
}

/**
 * Valida RAG em uma execução completa.
 * 
 * @param {Object} execution - Contexto da execução
 * @param {Object} generationResult - Resultado da geração (opcional, pode conter rag)
 * @returns {Object} Resultado da validação
 */
function validateRagExecution(execution, generationResult = null) {
  const useRag = execution.payload?.useRag !== false;
  
  if (!useRag) {
    return {
      valid: true,
      errors: [],
      warnings: [],
      skipped: true,
    };
  }
  
  logger.info('[ragRuntimeQA] Validando uso de RAG (validação epistemológica)', {
    executionId: execution.executionId,
    status: execution.status,
    hasRagContext: !!execution.ragContext,
    hasGenerationResult: !!generationResult,
    hasRagInResult: !!(generationResult?.rag),
  });
  
  // VALIDAÇÃO EPISTEMOLÓGICA 1: Se sistema absteve, valida se a abstenção foi correta
  if (execution.status === 'abstained') {
    const errors = [];
    const warnings = [];
    
    // Verifica se havia evidência suficiente quando sistema absteve
    if (execution.abstentionReason) {
      const reason = execution.abstentionReason.code || 'UNKNOWN';
      
      // Valida se a abstenção foi justificada
      if (execution.ragContext && execution.ragContext.success) {
        const chunksCount = execution.ragContext.chunks?.length || 0;
        const sourcesCount = execution.ragContext.sources?.length || 0;
        
        // Se havia chunks e fontes, mas sistema absteve, verifica se foi por inconsistência
        if (chunksCount > 0 && sourcesCount > 0 && reason !== 'INCONSISTENT_SOURCES' && reason !== 'LOW_CONFIDENCE') {
          warnings.push(`Sistema absteve com código ${reason}, mas havia ${chunksCount} chunks de ${sourcesCount} fontes. Verificar se abstenção foi justificada.`);
        }
      }
      
      logger.info('[ragRuntimeQA] Validação de abstenção', {
        executionId: execution.executionId,
        reason,
        description: execution.abstentionReason.description,
      });
    } else {
      errors.push('Sistema absteve mas não há motivo formal registrado (abstentionReason ausente)');
    }
    
    // Valida se há autoridade de decisão
    if (!execution.decisionAuthority) {
      errors.push('Abstenção não possui autoridade de decisão registrada (decisionAuthority ausente)');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      warnings,
      abstained: true,
      reason: execution.abstentionReason?.code,
    };
  }
  
  // VALIDAÇÃO EPISTEMOLÓGICA 2: Se sistema aprovou, valida se havia evidência suficiente
  if (execution.status === 'approved') {
    const { validateEvidence } = require('../api/services/evidenceValidator');
    const evidenceValidation = validateEvidence(execution);
    
    if (!evidenceValidation.sufficient) {
      return {
        valid: false,
        errors: [
          `Sistema aprovou execução mas evidência é insuficiente: ${evidenceValidation.reason}`,
          'QA valida verdade epistemológica, não apenas fluxo técnico',
        ],
        warnings: [],
        epistemologicalFailure: true,
      };
    }
  }
  
  // Extrai informações de RAG do generationResult (formato do orchestrateGeneration)
  const aiResponse = generationResult?.rag ? {
    rag: {
      used: generationResult.rag.used || false,
      executionId: generationResult.rag.executionId || null,
      sources: generationResult.rag.sources || [],
    },
  } : null;
  
  const result = validateRagUsage(execution, aiResponse);
  
  // VALIDAÇÃO EPISTEMOLÓGICA 3: Se IA respondeu, valida se havia evidência suficiente
  if (result.valid && aiResponse && aiResponse.rag?.used) {
    const { validateEvidence } = require('../api/services/evidenceValidator');
    const evidenceValidation = validateEvidence(execution);
    
    if (!evidenceValidation.sufficient) {
      result.valid = false;
      result.errors.push(
        `IA respondeu mas evidência é insuficiente: ${evidenceValidation.reason}`,
        'QA valida verdade epistemológica: resposta sem evidência é inválida',
      );
      result.epistemologicalFailure = true;
    }
  }
  
  logger.info('[ragRuntimeQA] Validação RAG epistemológica concluída', {
    executionId: execution.executionId,
    valid: result.valid,
    errorsCount: result.errors.length,
    warningsCount: result.warnings.length,
    epistemologicalFailure: result.epistemologicalFailure || false,
  });
  
  return result;
}

module.exports = {
  validateRagUsage,
  validateRagBeforeAI,
  validateRagAfterAI,
  validateRagExecution,
};

