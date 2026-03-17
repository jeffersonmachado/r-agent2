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

const logger = require('../utils/logger');

const { getSequelize } = require('../db/sequelize');
const { Execution } = require('../db/models');

// ── defensive helpers ────────────────────────────────────────────────────────
function safeGet(obj, key) {
  if (obj == null) return undefined;
  try { return obj[key]; } catch (_) { return undefined; }
}

function safeKeys(value) {
  if (!value || typeof value !== 'object') return [];
  try { return Object.keys(value); } catch (_) { return []; }
}

function safeArrayCopy(arr) {
  if (!Array.isArray(arr)) return [];
  try { return [...arr]; } catch (_) { return []; }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persiste uma execução completa.
 * 
 * @param {Object} execution - Contexto da execução
 * @returns {Promise<void>}
 */
async function persistExecution(execution) {
  const executionId = execution.executionId;
  const executionMode = execution?.payload?.executionMode || null;
  const isDryRun = executionMode === 'dry-run' || execution?.options?.dryRun === true || execution?.payload?.dryRun === true;

  // Regra: em dry-run não grava nada no banco.
  if (isDryRun) {
    logger.debug('[executionPersistence] Dry-run: persistência ignorada', { executionId, executionMode });
    return;
  }

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
      sources: safeArrayCopy(execution.ragContext.sources).map((s) => {
        let documentId;
        try { documentId = s.documentId || s; } catch (_) { documentId = null; }
        let chunksCount = 0;
        try { chunksCount = s.chunksCount || 0; } catch (_) { /* noop */ }
        return { documentId, chunksCount };
      }),
    } : null,
  };
  
  try {
    const sequelize = getSequelize();
    if (!sequelize) {
      // Em testes/unit sem DB, não persiste.
      logger.debug('[executionPersistence] DB indisponível, persistência ignorada (modo teste)', { executionId });
      return;
    }

    const ExecutionModel = typeof Execution === 'function' ? Execution() : Execution;

    // Upsert por execution_id
    const now = new Date();
    const existing = await ExecutionModel.findByPk(executionId);
    if (existing) {
      await existing.update({
        status: persistedData.status,
        data: persistedData,
        updated_at: now,
      });
    } else {
      await ExecutionModel.create({
        execution_id: executionId,
        status: persistedData.status,
        data: persistedData,
        created_at: now,
        updated_at: now,
      });
    }

    logger.info('[executionPersistence] Execução persistida (PostgreSQL)', {
      executionId,
      status: execution.status,
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
async function retrieveExecution(executionId) {
  const sequelize = getSequelize();
  if (!sequelize) return null;

  try {
    const ExecutionModel = typeof Execution === 'function' ? Execution() : Execution;
    const row = await ExecutionModel.findByPk(executionId);
    if (!row) return null;

    const persistedData = row.data || null;
    if (persistedData) {
      logger.info('[executionPersistence] Execução recuperada (PostgreSQL)', {
        executionId,
        status: persistedData.status,
      });
    }
    return persistedData;
  } catch (error) {
    logger.error('[executionPersistence] Erro ao recuperar execução (PostgreSQL)', {
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
async function hasFinalDecision(executionId) {
  const persisted = await retrieveExecution(executionId);
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
async function reuseDecision(executionId, currentExecution) {
  const persisted = await retrieveExecution(executionId);
  if (!persisted) {
    return null;
  }
  
  // Se execução anterior tem decisão final, reutiliza
  if (await hasFinalDecision(executionId)) {
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
      const persistedStages = safeGet(persisted, 'stages');
      safeKeys(persistedStages).forEach((stage) => {
        let stageValue;
        try { stageValue = persistedStages[stage]; } catch (_) { stageValue = false; }
        if (stageValue) {
          currentExecution.stages[stage] = true;
        }
      });
    } else if (persisted.status === 'approved') {
      // Se aprovou, todas as etapas foram concluídas
      const currentStages = safeGet(currentExecution, 'stages');
      safeKeys(currentStages).forEach((stage) => {
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

