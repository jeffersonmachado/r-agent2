'use strict';

/**
 * Business Outcome Contracts — camada canônica de contrato de resultado.
 *
 * Cada intent de negócio declara:
 *  - requiredAction: ação que PRECISA ser executada
 *  - requiredOutcome: estado de negócio que PRECISA ser atingido
 *  - requiredEvidence: evidência obrigatória (ex.: appointmentId, leadId)
 *  - postCondition: validador do resultado (opcional)
 *
 * Se a ação obrigatória for negada (permission, capability, tool, etc.)
 * o plano NUNCA pode ser considerado concluído com sucesso — o Action
 * Planner rejeita o plano inteiro (`required_action_denied`), o que torna
 * desnecessária uma lista de "failureIfDenied" por contrato.
 *
 * INVARIANTE 4 (NO EXPLICIT BUSINESS OUTCOME → NO BUSINESS SUCCESS):
 *  - intents de MUTATION que invocam tools com `sideEffects: true` exigem
 *    um Outcome Contract declarado (enforced pelo Action Planner com erro
 *    `outcome_contract_required`);
 *  - intents READ_ONLY/INFORMATIONAL não declaram contrato e nunca executam
 *    tools com sideEffects (o planner nega esses steps explicitamente);
 *  - a evidência do contrato vem EXCLUSIVAMENTE do step que executou a
 *    `requiredAction` — nunca de um merge flat dos outputs de todos os steps.
 *
 * Complementa o Validation Engine (que valida consistência técnica).
 * Este módulo valida resultado de NEGÓCIO.
 */

const OUTCOME_CONTRACTS = Object.freeze({
  'schedule.create': {
    description: 'Agendamento criado',
    requiredAction: 'createAppointment',
    requiredOutcome: 'appointment_created',
    requiredEvidence: ['appointment.id'],
  },
  'schedule.reschedule': {
    description: 'Agendamento remarcado',
    requiredAction: 'rescheduleAppointment',
    requiredOutcome: 'appointment_rescheduled',
    requiredEvidence: ['appointment.id'],
  },
  'schedule.cancel': {
    description: 'Agendamento cancelado',
    requiredAction: 'cancelAppointment',
    requiredOutcome: 'appointment_cancelled',
    requiredEvidence: ['appointment.id'],
  },
  'crm.createLead': {
    description: 'Lead criado',
    requiredAction: 'createLead',
    requiredOutcome: 'lead_created',
    requiredEvidence: [['lead.id', 'id']],
  },
  'crm.updateLead': {
    description: 'Lead atualizado',
    requiredAction: 'updateLead',
    requiredOutcome: 'lead_updated',
    requiredEvidence: [['lead.id', 'id']],
  },
  'crm.createOpportunity': {
    description: 'Oportunidade criada',
    requiredAction: 'createOpportunity',
    requiredOutcome: 'opportunity_created',
    requiredEvidence: [['opportunity.id', 'id']],
  },
  'campaign.start': {
    description: 'Campanha iniciada',
    requiredAction: 'createCampaign',
    requiredOutcome: 'campaign_started',
    requiredEvidence: [['campaign.id', 'id']],
  },
  'ticket.create': {
    description: 'Ticket criado',
    requiredAction: 'createTicket',
    requiredOutcome: 'ticket_created',
    requiredEvidence: [['ticket.id', 'id']],
  },
  'handover.transfer': {
    description: 'Transferência para humano',
    requiredAction: 'transferConversation',
    requiredOutcome: 'conversation_transferred',
    requiredEvidence: [],
  },
});

/**
 * Mapeamento intent → outcome contract.
 * Um intent pode não ter contrato (ex.: consultar_status, que é informativo).
 */
const INTENT_OUTCOME_MAP = Object.freeze({
  agendar: 'schedule.create',
  remarcar_agendamento: 'schedule.reschedule',
  cancelar_agendamento: 'schedule.cancel',
  criar_lead: 'crm.createLead',
  qualificar_lead: 'crm.updateLead',
  enviar_proposta: 'crm.createOpportunity',
  iniciar_campanha: 'campaign.start',
  abrir_ticket: 'ticket.create',
  transferir_humano: 'handover.transfer',
});

/**
 * Classificação da intent quanto a efeito colateral:
 *  - READ_ONLY:     apenas leitura (consultar_status)
 *  - INFORMATIONAL: leitura/agregação informativa (consultar_metricas)
 *  - MUTATION:      default — qualquer intent não classificada é tratada
 *                   como mutação e exige Outcome Contract para invocar
 *                   tools com `sideEffects: true` (fail closed).
 */
const INTENT_CLASSES = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  INFORMATIONAL: 'INFORMATIONAL',
  MUTATION: 'MUTATION',
});

const INTENT_CLASS_MAP = Object.freeze({
  consultar_status: INTENT_CLASSES.READ_ONLY,
  consultar_metricas: INTENT_CLASSES.INFORMATIONAL,
});

/**
 * @param {string} intent
 * @returns {string} READ_ONLY | INFORMATIONAL | MUTATION (default)
 */
function getIntentClass(intent) {
  return INTENT_CLASS_MAP[intent] || INTENT_CLASSES.MUTATION;
}

/**
 * Step typology — classificação explícita de cada passo do plano.
 *
 * TOOL:             execução real via Tool Registry
 * CONTEXT_ASSERTION: validação de dados do contexto (precisa predicate + actual data)
 * DOMAIN_QUERY:     consulta de domínio via capability/tool real
 * DECISION:         decisão baseada em dados disponíveis
 * WAIT_EVENT:       aguarda evento externo (Process Runtime)
 * HUMAN_TASK:       tarefa humana (cria estado de espera real)
 * PROCESS:          subprocesso
 * NOOP:             passo vazio (placeholder, não conta como sucesso)
 */
const STEP_TYPES = Object.freeze({
  TOOL: 'TOOL',
  CONTEXT_ASSERTION: 'CONTEXT_ASSERTION',
  DOMAIN_QUERY: 'DOMAIN_QUERY',
  DECISION: 'DECISION',
  WAIT_EVENT: 'WAIT_EVENT',
  HUMAN_TASK: 'HUMAN_TASK',
  PROCESS: 'PROCESS',
  NOOP: 'NOOP',
});

/**
 * Tipagem explícita de cada step nos templates de plano.
 * toolId !== null → TOOL. toolId === null → tipagem explícita obrigatória.
 */
const STEP_TYPE_MAP = Object.freeze({
  find_customer: STEP_TYPES.DOMAIN_QUERY,
  check_availability: STEP_TYPES.CONTEXT_ASSERTION,
  find_current_appointment: STEP_TYPES.DOMAIN_QUERY,
  collect_status: STEP_TYPES.CONTEXT_ASSERTION,
  collect_metrics: STEP_TYPES.CONTEXT_ASSERTION,
  notify_professional: STEP_TYPES.CONTEXT_ASSERTION,
});

/**
 * @param {string} intent
 * @returns {object|null} outcome contract ou null se intent não tem contrato
 */
function getOutcomeContract(intent) {
  const contractKey = INTENT_OUTCOME_MAP[intent];
  if (!contractKey) return null;
  return OUTCOME_CONTRACTS[contractKey] || null;
}

/**
 * @param {string} stepId — id do passo no template
 * @param {string|null} toolId — toolId do passo (se houver)
 * @returns {string} tipo do passo (TOOL, CONTEXT_ASSERTION, etc.)
 */
function stepType(stepId, toolId = null) {
  // Se tem toolId, é TOOL ou DOMAIN_QUERY — não CONTEXT_ASSERTION.
  if (toolId) {
    // Se o STEP_TYPE_MAP indica DOMAIN_QUERY, preserva.
    const mapped = STEP_TYPE_MAP[stepId];
    if (mapped === STEP_TYPES.DOMAIN_QUERY) return STEP_TYPES.DOMAIN_QUERY;
    return STEP_TYPES.TOOL;
  }
  // Sem toolId: usa STEP_TYPE_MAP; default TOOL (que falhará sem toolId).
  return STEP_TYPE_MAP[stepId] || STEP_TYPES.TOOL;
}

/**
 * Extrai evidência do output de um step considerando paths aninhados.
 * Ex.: step.output = { appointment: { id: 'apt-1', ... } }
 *      path = 'appointment.id' → 'apt-1'
 */
function extractEvidence(stepOutput, path) {
  if (!stepOutput || typeof stepOutput !== 'object') return null;
  const parts = path.split('.');
  let current = stepOutput;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return null;
    current = current[part];
  }
  return current !== undefined ? current : null;
}

/**
 * Valida se o outcome de negócio foi atingido.
 *
 * @param {object} args
 * @param {string} args.intent
 * @param {object} args.execution — resultado da execução
 * @param {Array}  args.execution.steps — passos executados
 * @param {Array}  args.execution.toolsExecuted — ids das tools executadas
 * @param {string} args.execution.status
 * @returns {object} { valid: boolean, outcome: string, evidence: object, failures: string[] }
 */
function validateBusinessOutcome({ intent, execution = {} } = {}) {
  const contract = getOutcomeContract(intent);
  if (!contract) {
    // Intent sem contrato explícito: aceita execução completa como suficiente.
    if (execution.status === 'completed') {
      return { valid: true, outcome: 'completed', evidence: {}, failures: [] };
    }
    return { valid: false, outcome: execution.status || 'unknown', evidence: {}, failures: ['execution_not_completed'] };
  }

  const failures = [];

  // 1. Ação obrigatória foi executada?
  const requiredAction = contract.requiredAction;
  const toolsExecuted = execution.toolsExecuted || [];
  if (requiredAction && !toolsExecuted.includes(requiredAction)) {
    failures.push(`required_action_not_executed: ${requiredAction}`);
  }

  // 2. Evidências obrigatórias presentes?
  // INVARIANTE 4: a evidência vem EXCLUSIVAMENTE do(s) step(s) que executaram
  // a requiredAction do contrato (match por step.toolId). Um step qualquer com
  // campos homônimos NÃO satisfaz o contrato.
  const evidence = {};
  const actionSteps = (execution.steps || [])
    .filter((s) => s.status === 'executed' && s.output && s.toolId === requiredAction);
  const stepOutputs = actionSteps.reduce((acc, step) => {
    if (step.output && typeof step.output === 'object') {
      Object.assign(acc, step.output);
    }
    return acc;
  }, {});

  for (const evidenceKey of contract.requiredEvidence) {
    // Suporte a paths compostos e alternativos.
    // String simples: extrai com extractEvidence.
    // Array: primeiro path que retornar valor não-nulo.
    const paths = Array.isArray(evidenceKey) ? evidenceKey : [evidenceKey];
    let value = null;
    for (const p of paths) {
      value = stepOutputs[p] || extractEvidence(stepOutputs, p) || null;
      if (value !== null && value !== undefined) break;
    }

    if (value === null || value === undefined) {
      failures.push(`required_evidence_missing: ${paths.join('|')}`);
    } else {
      evidence[paths[0]] = value;
    }
  }

  // 3. Status da execução
  if (execution.status !== 'completed') {
    failures.push(`execution_status_not_completed: ${execution.status}`);
  }

  return {
    valid: failures.length === 0,
    outcome: failures.length === 0 ? contract.requiredOutcome : 'outcome_not_achieved',
    evidence,
    failures,
  };
}

module.exports = {
  OUTCOME_CONTRACTS,
  INTENT_OUTCOME_MAP,
  INTENT_CLASSES,
  INTENT_CLASS_MAP,
  STEP_TYPES,
  STEP_TYPE_MAP,
  getOutcomeContract,
  getIntentClass,
  stepType,
  validateBusinessOutcome,
};
