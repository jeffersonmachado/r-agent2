/**
 * Persistência Determinística de Execuções
 * 
 * Responsabilidades:
 * - Persistir decisões por executionId
 * - Garantir determinismo: reexecução = mesma decisão
 * - Reutilizar evidência em reexecuções
 * - Não recalcular decisões já tomadas
 * 
 * REGRAS OBRIGATÓRIAS:
 * - Mesma execução = mesma decisão
 * - Evidência é reutilizada, não recalculada
 * - Decisões são imutáveis após persistidas
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const EXECUTIONS_DIR = path.join(__dirname, '..', '..', 'data', 'executions');

/**
 * Garante que o diretório de execuções existe.
 */
function ensureExecutionsDir() {
  if (!fs.existsSync(EXECUTIONS_DIR)) {
    fs.mkdirSync(EXECUTIONS_DIR, { recursive: true });
  }
}

/**
 * Persiste uma execução completa.
 * 
 * @param {Object} execution - Contexto da execução
 * @returns {Promise<void>}
 */
async function persistExecution(execution) {
  ensureExecutionsDir();
  
  const executionId = execution.executionId;
  const filePath = path.join(EXECUTIONS_DIR, `${executionId}.json`);
  
  // Prepara dados para persistência (apenas o necessário)
  const persistedData = {
    executionId,
    status: execution.status,
    payload: {
      name: execution.payload?.name,
      description: execution.payload?.description?.substring(0, 500), // Limita tamanho
      useRag: execution.payload?.useRag,
    },
    decisionAuthority: execution.decisionAuthority,
    abstentionReason: execution.abstentionReason,
    evidenceContext: execution.evidenceContext,
    stages: execution.stages,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    // Persiste contexto RAG resumido (não chunks completos para economizar espaço)
    ragContext: execution.ragContext ? {
      success: execution.ragContext.success,
      chunksCount: execution.ragContext.chunks?.length || 0,
      sourcesCount: execution.ragContext.sources?.length || 0,
      sources: execution.ragContext.sources?.map(s => ({
        documentId: s.documentId || s,
        chunksCount: s.chunksCount || 0,
      })) || [],
    } : null,
  };
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(persistedData, null, 2), 'utf8');
    logger.info('[executionPersistence] Execução persistida', {
      executionId,
      status: execution.status,
      filePath,
    });
  } catch (error) {
    logger.error('[executionPersistence] Erro ao persistir execução', {
      executionId,
      error: error.message,
    });
    throw error;
  }
}

/**
 * Recupera uma execução persistida.
 * 
 * @param {string} executionId - ID da execução
 * @returns {Object|null} Execução persistida ou null se não encontrada
 */
function retrieveExecution(executionId) {
  ensureExecutionsDir();
  
  const filePath = path.join(EXECUTIONS_DIR, `${executionId}.json`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const persistedData = JSON.parse(content);
    
    logger.info('[executionPersistence] Execução recuperada', {
      executionId,
      status: persistedData.status,
    });
    
    return persistedData;
  } catch (error) {
    logger.error('[executionPersistence] Erro ao recuperar execução', {
      executionId,
      error: error.message,
    });
    return null;
  }
}

/**
 * Verifica se uma execução já foi persistida e tem decisão final.
 * 
 * @param {string} executionId - ID da execução
 * @returns {boolean} True se execução já tem decisão final
 */
function hasFinalDecision(executionId) {
  const persisted = retrieveExecution(executionId);
  if (!persisted) {
    return false;
  }
  
  // Decisão final = approved, failed ou abstained
  return ['approved', 'failed', 'abstained'].includes(persisted.status);
}

/**
 * Reutiliza decisão de execução anterior (determinismo).
 * 
 * @param {string} executionId - ID da execução
 * @param {Object} currentExecution - Execução atual (parcial)
 * @returns {Object|null} Execução recuperada com decisão ou null
 */
function reuseDecision(executionId, currentExecution) {
  const persisted = retrieveExecution(executionId);
  if (!persisted) {
    return null;
  }
  
  // Se execução anterior tem decisão final, reutiliza
  if (hasFinalDecision(executionId)) {
    logger.info('[executionPersistence] Reutilizando decisão de execução anterior (determinismo)', {
      executionId,
      previousStatus: persisted.status,
      previousReason: persisted.abstentionReason?.code,
    });
    
    // Aplica decisão anterior à execução atual
    currentExecution.status = persisted.status;
    currentExecution.decisionAuthority = persisted.decisionAuthority;
    currentExecution.abstentionReason = persisted.abstentionReason;
    currentExecution.evidenceContext = persisted.evidenceContext;
    
    // Marca etapas como concluídas baseado na decisão anterior
    if (persisted.status === 'abstained') {
      // Se absteve, marca etapas até onde chegou
      Object.keys(persisted.stages || {}).forEach(stage => {
        if (persisted.stages[stage]) {
          currentExecution.stages[stage] = true;
        }
      });
    } else if (persisted.status === 'approved') {
      // Se aprovou, todas as etapas foram concluídas
      Object.keys(currentExecution.stages).forEach(stage => {
        currentExecution.stages[stage] = true;
      });
    }
    
    return currentExecution;
  }
  
  return null;
}

module.exports = {
  persistExecution,
  retrieveExecution,
  hasFinalDecision,
  reuseDecision,
};

