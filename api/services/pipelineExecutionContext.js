/**
 * Execution Context Centralizado do Pipeline
 * 
 * Este módulo gerencia o estado único de cada execução do pipeline,
 * garantindo idempotência e controle determinístico.
 * 
 * REGRAS CRÍTICAS:
 * - Cada execução possui um executionId único
 * - O estado é a fonte da verdade
 * - Nenhuma etapa pode executar se já estiver concluída
 * - Apenas o Orchestrator pode atualizar o estado
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * @typedef {Object} PipelineStages
 * @property {boolean} filesInferred - Arquivos processados
 * @property {boolean} payloadValid - Payload validado
 * @property {boolean} contractValid - Contrato validado
 * @property {boolean} contextBuilt - Contexto montado
 * @property {boolean} ragContextBuilt - Contexto RAG construído (obrigatório quando useRag=true)
 * @property {boolean} aiExecuted - IA executada
 * @property {boolean} flowGenerated - Fluxo gerado
 * @property {boolean} seedGenerated - Seed gerado
 * @property {boolean} rpaGenerated - RPA gerado
 * @property {boolean} rpaExecuted - RPA executado
 */

/**
 * @typedef {Object} PipelineExecution
 * @property {string} executionId - ID único da execução
 * @property {"idle" | "running" | "abstained" | "approved" | "failed"} status - Status da execução
 * @property {PipelineStages} stages - Estados das etapas
 * @property {Object} payload - Payload original
 * @property {Object} options - Opções da execução
 * @property {number} createdAt - Timestamp de criação
 * @property {number} updatedAt - Timestamp da última atualização
 * @property {Object} [abstentionReason] - Motivo formal da abstenção (se status=abstained)
 * @property {Object} [decisionAuthority] - Autoridade que tomou a decisão
 * @property {Object} [evidenceContext] - Contexto de evidência usado na decisão
 */

/**
 * Cria um novo Execution Context.
 * 
 * @param {Object} payload - Payload da execução
 * @param {Object} options - Opções da execução
 * @returns {PipelineExecution}
 */
function createExecutionContext(payload, options = {}) {
  const executionId = generateExecutionId();
  const now = Date.now();
  
  const execution = {
    executionId,
    status: 'idle',
    stages: {
      filesInferred: false,
      payloadValid: false,
      contractValid: false,
      contextBuilt: false,
      ragContextBuilt: false,
      aiExecuted: false,
      flowGenerated: false,
      seedGenerated: false,
      rpaGenerated: false,
      rpaExecuted: false,
    },
    payload,
    options,
    createdAt: now,
    updatedAt: now,
    // Autoridade de decisão inicial (sistema é autoridade padrão)
    decisionAuthority: {
      type: 'system',
      approvedBy: 'pipelineExecutionContext',
    },
  };

  logger.info('[PipelineContext] Contexto criado', {
    executionId,
    payloadName: payload?.name,
    executionMode: payload?.executionMode || 'dry-run',
  });

  return execution;
}

/**
 * Gera um ID único para a execução.
 * 
 * @returns {string}
 */
function generateExecutionId() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `exec-${timestamp}-${random}`;
}

/**
 * Atualiza o status de uma etapa no contexto.
 * 
 * @param {PipelineExecution} execution - Contexto da execução
 * @param {string} stage - Nome da etapa
 * @param {boolean} value - Valor da etapa
 */
function updateStage(execution, stage, value) {
  if (!execution.stages.hasOwnProperty(stage)) {
    logger.warn('[PipelineContext] Etapa desconhecida', { stage, executionId: execution.executionId });
    return;
  }

  // Verifica se a etapa já está concluída
  if (execution.stages[stage] === true && value === true) {
    logger.debug('[PipelineContext] Etapa já concluída, ignorando atualização', {
      stage,
      executionId: execution.executionId,
    });
    return;
  }

  const previousValue = execution.stages[stage];
  execution.stages[stage] = value;
  execution.updatedAt = Date.now();

  logger.info('[PipelineContext] Etapa atualizada', {
    executionId: execution.executionId,
    stage,
    previousValue,
    newValue: value,
  });
}

/**
 * Atualiza o status geral da execução.
 * 
 * @param {PipelineExecution} execution - Contexto da execução
 * @param {"idle" | "running" | "abstained" | "approved" | "failed"} status - Novo status
 * @param {Object} [metadata] - Metadados adicionais (abstentionReason, decisionAuthority, etc)
 */
function updateStatus(execution, status, metadata = {}) {
  const previousStatus = execution.status;
  execution.status = status;
  execution.updatedAt = Date.now();

  // Armazena metadados de abstenção se aplicável
  if (status === 'abstained' && metadata.abstentionReason) {
    execution.abstentionReason = metadata.abstentionReason;
  }

  // Armazena autoridade de decisão se fornecida
  if (metadata.decisionAuthority) {
    execution.decisionAuthority = metadata.decisionAuthority;
  }

  // Armazena contexto de evidência se fornecido
  if (metadata.evidenceContext) {
    execution.evidenceContext = metadata.evidenceContext;
  }

  logger.info('[PipelineContext] Status atualizado', {
    executionId: execution.executionId,
    previousStatus,
    newStatus: status,
    ...(status === 'abstained' && metadata.abstentionReason ? { reason: metadata.abstentionReason.code } : {}),
  });
}

/**
 * Verifica se uma etapa já foi concluída.
 * 
 * @param {PipelineExecution} execution - Contexto da execução
 * @param {string} stage - Nome da etapa
 * @returns {boolean}
 */
function isStageCompleted(execution, stage) {
  return execution.stages[stage] === true;
}

/**
 * Obtém a próxima etapa pendente.
 * 
 * @param {PipelineExecution} execution - Contexto da execução
 * @returns {string|null} Nome da próxima etapa ou null se todas estiverem concluídas
 */
function getNextPendingStage(execution) {
  const stageOrder = [
    'filesInferred',
    'payloadValid',
    'contractValid',
    'contextBuilt',
    'ragContextBuilt',
    'aiExecuted',
    'flowGenerated',
    'seedGenerated',
    'rpaGenerated',
    'rpaExecuted',
  ];

  for (const stage of stageOrder) {
    if (!execution.stages[stage]) {
      return stage;
    }
  }

  return null;
}

/**
 * Converte o contexto para formato de progresso (compatível com onProgress).
 * 
 * @param {PipelineExecution} execution - Contexto da execução
 * @returns {Object}
 */
function toProgressFormat(execution) {
  return {
    executionId: execution.executionId,
    ...execution.stages,
    approved: execution.status === 'approved',
  };
}

module.exports = {
  createExecutionContext,
  updateStage,
  updateStatus,
  isStageCompleted,
  getNextPendingStage,
  toProgressFormat,
};

