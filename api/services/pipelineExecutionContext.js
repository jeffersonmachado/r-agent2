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

function safeErrorMessage(err, fallback = '') {
  if (!err) return fallback;
  let message;
  try {
    message = err?.message;
  } catch (_) {
    message = null;
  }
  if (message !== null && message !== undefined) {
    try { return String(message); } catch (_) {}
  }
  try { return String(err); } catch (_) { return fallback; }
}
const { emitEvent } = require('./websocketService');

const STAGE_LABELS_PT = Object.freeze({
  providerValidated: 'Provider de IA validado',
  ragValidated: 'Serviço RAG validado',
  webScraping: 'Web scraping',
  descriptionSuggested: 'Descrição sugerida',
  questionsGenerated: 'Perguntas geradas',
  filesInferred: 'Arquivos processados',
  payloadValid: 'Payload válido',
  contractValid: 'Contrato válido',
  contextBuilt: 'Contexto montado',
  ragContextBuilt: 'Contexto RAG construído',
  aiExecuted: 'IA executada',
  flowGenerated: 'Fluxo gerado',
  seedGenerated: 'Seed gerado',
  rpaGenerated: 'RPA gerado',
  rpaExecuted: 'RPA executado',
  faqGenerated: 'FAQ gerado (tenant)',
  initialFlowGenerated: 'Fluxo inicial gerado (tenant)',
  approved: 'Aprovado',
  failed: 'Falhou',
});

// -------------------------------------------------------------------
// Execução em memória (opção A):
// - Unifica endpoints "paralelos" (generate-faq, generate-initial-flow, generate-and-validate)
// - Permite que o status `approved` só seja emitido quando TODAS as etapas requeridas
//   (incluindo as extras do modo tenant) tiverem concluído.
// -------------------------------------------------------------------
const executionRegistry = new Map(); // Map<executionId, PipelineExecution>

const BASE_STAGE_KEYS = Object.freeze([
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
]);

// Etapas "extras" do fluxo tenant (podem disparar OpenAI fora do generate-and-validate):
// - `faqGenerated`: /system/generate-faq
// - `initialFlowGenerated`: /system/generate-initial-flow (chama intents.service)
const TENANT_EXTRA_STAGE_KEYS = Object.freeze([
  'faqGenerated',
  'initialFlowGenerated',
]);

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
  const executionId = (() => {
    // Permite que o frontend forneça um executionId para viabilizar polling
    // do status do pipeline enquanto a requisição longa está em andamento.
    const candidate = payload?.executionId;
    if (typeof candidate === 'string') {
      const id = candidate.trim();
      // Regras simples de segurança: prefixo + charset limitado + tamanho máximo
      if (id && id.length <= 96 && /^exec-[a-zA-Z0-9-]+$/.test(id)) {
        return id;
      }
    }
    return generateExecutionId();
  })();
  const now = Date.now();
  
  const execution = {
    executionId,
    status: 'idle',
    stages: {
      // Etapas pré-pipeline (executadas por endpoints auxiliares), mas exibidas no pipeline visível.
      // Elas não entram em BASE_STAGE_KEYS por padrão para não bloquear fluxos antigos.
      providerValidated: false,
      ragValidated: false,
      webScraping: false,
      descriptionSuggested: false,
      questionsGenerated: false,

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
      // Extras do modo tenant (opção A): por padrão ficam pendentes, mas só bloqueiam
      // o `approved` quando forem marcadas como "requeridas" via `requireStages`.
      faqGenerated: false,
      initialFlowGenerated: false,
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
    requiredStages: Array.isArray(options?.requiredStages) && options.requiredStages.length
      ? Array.from(new Set(options.requiredStages))
      : BASE_STAGE_KEYS.slice(),
    // Congela metadata quando entrar em status terminal (failed/approved/abstained)
    _terminal: null, // { status, metadata }
  };

  logger.info('[PipelineContext] Contexto criado', {
    executionId,
    payloadName: payload?.name,
    executionMode: payload?.executionMode || 'dry-run',
  });

  return execution;
}

function getExecutionContext(executionId) {
  const id = typeof executionId === 'string' ? executionId.trim() : '';
  if (!id) return null;
  return executionRegistry.get(id) || null;
}

function registerExecutionContext(execution) {
  if (!execution || typeof execution !== 'object') return;
  const id = typeof execution.executionId === 'string' ? execution.executionId.trim() : '';
  if (!id) return;
  executionRegistry.set(id, execution);
}

/**
 * Garante que exista um contexto para um executionId.
 * - Se já existir, reaproveita e faz merge best-effort de requiredStages.
 * - Se não existir, cria e registra.
 */
function ensureExecutionContext(payload, options = {}) {
  const candidate = payload?.executionId;
  const execId = typeof candidate === 'string' ? candidate.trim() : '';
  const existing = execId ? getExecutionContext(execId) : null;
  if (existing) {
    // Best-effort: mantém payload mais recente (útil para logs/diagnóstico)
    if (payload && typeof payload === 'object') {
      existing.payload = payload;
    }
    if (options && typeof options === 'object') {
      existing.options = { ...(existing.options || {}), ...options };
    }
    if (Array.isArray(options?.requiredStages) && options.requiredStages.length) {
      requireStages(existing, options.requiredStages);
    }
    return existing;
  }
  const created = createExecutionContext(payload, options);
  registerExecutionContext(created);
  return created;
}

/**
 * Marca uma lista de etapas como "requeridas" para aprovação.
 * Também garante que existam em `execution.stages` (inicializa como false).
 */
function requireStages(execution, stages) {
  if (!execution || typeof execution !== 'object') return;
  const arr = Array.isArray(stages) ? stages : [];
  const normalized = arr.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
  if (normalized.length === 0) return;

  const required = new Set(Array.isArray(execution.requiredStages) ? execution.requiredStages : []);
  for (const s of normalized) {
    required.add(s);
    if (!execution.stages || typeof execution.stages !== 'object') execution.stages = {};
    if (!Object.prototype.hasOwnProperty.call(execution.stages, s)) {
      // se a etapa passou a ser requerida, ela começa pendente
      execution.stages[s] = false;
    }
  }
  execution.requiredStages = Array.from(required);
}

/**
 * Tenta aprovar a execução se TODAS as etapas requeridas estiverem concluídas.
 * Retorna true quando aprova.
 */
function tryApprove(execution, metadata = {}) {
  if (!execution || typeof execution !== 'object') return false;
  if (execution.status === 'approved' || execution.status === 'failed') return execution.status === 'approved';

  const required = Array.isArray(execution.requiredStages) && execution.requiredStages.length
    ? execution.requiredStages
    : BASE_STAGE_KEYS;

  const allDone = required.every((k) => execution.stages && execution.stages[k] === true);
  if (!allDone) return false;

  updateStatus(execution, 'approved', {
    ...metadata,
    message: metadata?.message || 'Pipeline aprovado (todas as etapas concluídas)',
    source: metadata?.source || 'tryApprove',
  });
  return true;
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

  // ---------------------------------------------------------------
  // Regra: status terminal interrompe a evolução do pipeline.
  // Depois de `failed`/`approved`/`abstained`, nenhuma etapa deve mudar.
  // Isso evita que endpoints paralelos (FAQ/fluxo inicial/etc.) "completem"
  // estágios após uma falha terminal e deixem o snapshot inconsistente.
  // ---------------------------------------------------------------
  const TERMINAL = new Set(['approved', 'failed', 'abstained']);
  if (TERMINAL.has(execution.status)) {
    // Ainda emitimos snapshot best-effort para observabilidade, mas sem mutar estado.
    try {
      const label = STAGE_LABELS_PT[stage] || stage;
      emitEvent('pipeline.status', {
        executionId: execution.executionId,
        status: execution.status,
        stages: execution.stages,
        metadata: {
          stage,
          attemptedValue: value,
          ignored: true,
          message: `Atualização ignorada (pipeline já finalizado: ${execution.status}): ${label}`,
          source: 'updateStage.terminal-guard',
        },
      }, {
        tenantId: execution.options?.tenantId,
      });
    } catch (err) {
      // best-effort
    }
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

  // -------------------------------------------------------------------
  // Event-driven pipeline: stage changes -> websocket (source of truth)
  //
  // Por que:
  // - O frontend (PipelineMachine) atualiza visualmente APENAS via `pipeline.status`.
  // - Antes, só emitíamos em `updateStatus`, então etapas (ex.: filesInferred) não
  //   apareciam como concluídas até o pipeline finalizar (approved/failed).
  // -------------------------------------------------------------------
  try {
    const label = STAGE_LABELS_PT[stage] || stage;
    emitEvent('pipeline.status', {
      executionId: execution.executionId,
      status: execution.status,
      stages: execution.stages,
      metadata: {
        stage,
        previousValue,
        newValue: value,
        message: value === true ? `Etapa concluída: ${label}` : `Etapa atualizada: ${label}`,
        source: 'updateStage',
      },
    }, {
      tenantId: execution.options?.tenantId,
    });
  } catch (err) {
    // Best-effort: nunca falhar a transição por WS.
    logger.debug('[PipelineContext] Falha ao emitir pipeline.status em updateStage (best-effort)', {
      executionId: execution.executionId,
      stage,
      error: safeErrorMessage(err),
    });
  }

  // Se uma etapa mudou, podemos ter destravado a aprovação.
  if (value === true) {
    tryApprove(execution, { source: 'updateStage' });
  }
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
  const TERMINAL = new Set(['approved', 'failed', 'abstained']);
  const nowIso = new Date().toISOString();

  // Se já estamos em status terminal e o caller está tentando apenas "atualizar mensagem",
  // não permitimos sobrescrever a metadata terminal (isso causava UI incoerente:
  // status=failed com message="Fluxo inicial gerado.").
  // Em vez disso, re-emite o snapshot com a metadata terminal congelada.
  if (TERMINAL.has(previousStatus) && status === previousStatus && execution?._terminal?.status === previousStatus) {
    try {
      emitEvent('pipeline.status', {
        executionId: execution.executionId,
        status: previousStatus,
        stages: execution.stages,
        metadata: execution._terminal.metadata || {},
      }, {
        tenantId: execution.options?.tenantId,
      });
    } catch (err) {
      logger.debug('[PipelineContext] Falha ao re-emitir pipeline.status terminal (best-effort)', {
        executionId: execution.executionId,
        status: previousStatus,
        error: safeErrorMessage(err),
      });
    }
    return;
  }

  // Normaliza metadados (principalmente para falhas) para o frontend conseguir exibir
  // "onde parou" e "por quê" de forma consistente.
  const normalizedMetadata = (() => {
    const m = (metadata && typeof metadata === 'object') ? { ...metadata } : {};

    // Sempre inclui timestamp para observabilidade
    if (!m.timestamp) m.timestamp = nowIso;

    // Se não houver currentStage explícito, tenta usar o que está no execution
    if (!m.currentStage && execution?.currentStage) {
      m.currentStage = execution.currentStage;
    }

    // Normaliza reason (falha)
    if (status === 'failed') {
      // Sempre força erro em status failed (mesmo se caller tentou "completed"/"warning")
      m.stageStatus = 'error';

      if (m.reason && typeof m.reason === 'string') {
        m.reason = { code: m.reason };
      } else if (!m.reason) {
        // Se ninguém forneceu um motivo, padroniza como UNKNOWN
        m.reason = { code: 'UNKNOWN' };
      }

      if (!m.message) {
        const stageLabel = STAGE_LABELS_PT[m.currentStage] || m.currentStage || null;
        m.message = stageLabel ? `Pipeline falhou na etapa: ${stageLabel}` : 'Pipeline falhou';
      }
    }

    // Normaliza abstenção (não é erro técnico, mas é terminal)
    if (status === 'abstained') {
      if (!m.stageStatus) m.stageStatus = 'abstained';
      if (!m.message) {
        const code = m?.abstentionReason?.code || 'INSUFFICIENT_EVIDENCE';
        m.message = `Pipeline absteve (${code})`;
      }
    }

    // Para approved, também mantemos timestamp
    if (status === 'approved') {
      if (!m.stageStatus) m.stageStatus = 'completed';
    }

    return m;
  })();

  // Nunca permitir regressão de status terminal (ex.: approved -> running).
  // Ainda assim, emitimos um snapshot com o status terminal para não "quebrar" a UI.
  if (TERMINAL.has(previousStatus) && status !== previousStatus) {
    execution.updatedAt = Date.now();
    logger.debug('[PipelineContext] Ignorando mudança de status após decisão final', {
      executionId: execution.executionId,
      previousStatus,
      attemptedStatus: status,
      source: metadata?.source || null,
    });
    try {
      emitEvent('pipeline.status', {
        executionId: execution.executionId,
        status: previousStatus,
        stages: execution.stages,
        metadata: normalizedMetadata,
      }, {
        tenantId: execution.options?.tenantId,
      });
    } catch (err) {
      logger.debug('[PipelineContext] Falha ao emitir pipeline.status em regressão (best-effort)', {
        executionId: execution.executionId,
        status: previousStatus,
        error: safeErrorMessage(err),
      });
    }
    return;
  }

  execution.status = status;
  execution.updatedAt = Date.now();

  // Congela metadata ao entrar em status terminal (1ª vez).
  if (TERMINAL.has(status) && previousStatus !== status) {
    execution._terminal = { status, metadata: normalizedMetadata };
  }

  // Armazena metadados de abstenção se aplicável
  if (status === 'abstained' && normalizedMetadata.abstentionReason) {
    execution.abstentionReason = normalizedMetadata.abstentionReason;
  }

  // Armazena autoridade de decisão se fornecida
  if (normalizedMetadata.decisionAuthority) {
    execution.decisionAuthority = normalizedMetadata.decisionAuthority;
  }

  // Armazena contexto de evidência se fornecido
  if (normalizedMetadata.evidenceContext) {
    execution.evidenceContext = normalizedMetadata.evidenceContext;
  }

  logger.info('[PipelineContext] Status atualizado', {
    executionId: execution.executionId,
    previousStatus,
    newStatus: status,
    ...(status === 'abstained' && metadata.abstentionReason ? { reason: metadata.abstentionReason.code } : {}),
  });

  // -------------------------------------------------------------------
  // Event-driven pipeline: status changes -> websocket (source of truth)
  // -------------------------------------------------------------------
  try {
    emitEvent('pipeline.status', {
      executionId: execution.executionId,
      status,
      stages: execution.stages,
      metadata: normalizedMetadata,
    }, {
      tenantId: execution.options?.tenantId,
    });
  } catch (err) {
    // Best-effort: nunca falhar a transição por WS.
    logger.debug('[PipelineContext] Falha ao emitir pipeline.status (best-effort)', {
      executionId: execution.executionId,
      status,
      error: safeErrorMessage(err),
    });
  }
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
  ensureExecutionContext,
  getExecutionContext,
  requireStages,
  tryApprove,
  updateStage,
  updateStatus,
  isStageCompleted,
  getNextPendingStage,
  toProgressFormat,
};

