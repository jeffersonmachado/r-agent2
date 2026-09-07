// Feedback operacional da execução de ações de recomendação (Decision Intelligence).
//
// Fonte única para traduzir `metadata.application.executedAction` (ou o
// `execution` retornado pelo apply) em mensagem + tom para UI/toast.
// Cobre create_task, send_message, schedule e fallbacks (skipped/failed),
// mantendo linguagem de outcome (sem vazar mecanismo interno).

const SKIPPED_REASON_LABELS = {
  missing_conversation_id: 'Sem conversa vinculada — a ação não foi executada.',
  missing_message_text: 'Sem texto de mensagem definido — a ação não foi executada.',
  conversation_not_found: 'Conversa não encontrada — a ação não foi executada.',
  unsupported_action_kind: 'Este tipo de ação ainda não é executável automaticamente.',
  not_enough_open_conversations: 'Poucas conversas abertas no momento — nada a redistribuir.',
  no_eligible_agents: 'Nenhum atendente elegível disponível para receber conversas.',
  already_balanced: 'A fila já está equilibrada entre os atendentes.',
};

const EXECUTED_LABELS = {
  create_task: 'Tarefa criada no Workspace para execução operacional.',
  send_message: 'Mensagem enviada para a fila do canal — entrega em andamento.',
  schedule: 'Follow-up agendado no Workspace.',
  rebalance_queue: 'Conversas abertas redistribuídas entre a equipe.',
};

const FAILED_LABELS = {
  create_task: 'A ação operacional não pôde ser executada automaticamente; crie a tarefa manualmente.',
  send_message: 'A mensagem não pôde ser enviada automaticamente; responda pela Inbox.',
  schedule: 'O follow-up não pôde ser agendado automaticamente; agende manualmente.',
  rebalance_queue: 'A redistribuição não pôde ser executada; atribua as conversas manualmente pela Inbox.',
};

function formatDueDate(dueDate) {
  if (!dueDate) return null;
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * @param {object|null} executedAction metadata.application.executedAction
 * @returns {{ tone: 'success'|'warning'|'muted', message: string }|null}
 */
export function describeExecutedAction(executedAction) {
  if (!executedAction || typeof executedAction !== 'object') return null;
  const kind = typeof executedAction.kind === 'string' ? executedAction.kind : null;
  if (!kind) return null;

  if (executedAction.status === 'executed') {
    let message = EXECUTED_LABELS[kind] || 'Ação executada com sucesso.';
    if (kind === 'schedule') {
      const when = formatDueDate(executedAction.dueDate);
      if (when) message = `Follow-up agendado para ${when}.`;
    }
    if (kind === 'rebalance_queue') {
      const assigned = Number(executedAction.assigned) || 0;
      const rebalanced = Number(executedAction.rebalanced) || 0;
      const total = assigned + rebalanced;
      const agents = Number(executedAction.agents) || 0;
      if (total > 0 && agents > 0) {
        message = `${total} ${total === 1 ? 'conversa redistribuída' : 'conversas redistribuídas'} entre ${agents} ${agents === 1 ? 'atendente' : 'atendentes'}.`;
      }
    }
    return { tone: 'success', message };
  }

  if (executedAction.status === 'skipped') {
    const message = SKIPPED_REASON_LABELS[executedAction.reason]
      || 'Ação não executada — dados insuficientes na recomendação.';
    return { tone: 'muted', message };
  }

  if (executedAction.status === 'failed') {
    const message = FAILED_LABELS[kind]
      || 'A ação automática falhou; execute manualmente.';
    return { tone: 'warning', message };
  }

  return null;
}

const TONE_CLASSES = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  muted: 'text-text-secondary',
};

export function executedActionToneClass(tone) {
  return TONE_CLASSES[tone] || TONE_CLASSES.muted;
}

// Sinais comportamentais medidos na avaliação de outcome (actionSignals).
// Linguagem de efeito observado, sem expor mecanismo interno.

const SIGNAL_LABELS = {
  replied: 'Cliente respondeu após o envio.',
  awaiting_reply: 'Aguardando resposta do cliente.',
  no_reply: 'Cliente não respondeu na janela de 24h.',
  done: 'Tarefa criada foi concluída.',
  open: 'Tarefa criada ainda está aberta.',
  cancelled: 'Tarefa criada foi cancelada.',
  handled: 'Equipe respondeu nas conversas redistribuídas.',
  awaiting_handling: 'Aguardando resposta da equipe nas conversas redistribuídas.',
  no_handling: 'Sem resposta da equipe na janela de 24h após a redistribuição.',
  unavailable: 'Sinal da ação indisponível no momento.',
};

const SIGNAL_TONES = {
  replied: 'success',
  done: 'success',
  handled: 'success',
  no_reply: 'warning',
  cancelled: 'warning',
  no_handling: 'warning',
  awaiting_reply: 'muted',
  open: 'muted',
  awaiting_handling: 'muted',
  unavailable: 'muted',
};

/**
 * @param {object|null} signal item de outcome.actionSignals
 * @returns {{ tone: string, message: string }|null}
 */
export function describeActionSignal(signal) {
  if (!signal || typeof signal !== 'object' || !signal.outcome) return null;
  const message = SIGNAL_LABELS[signal.outcome];
  if (!message) return null;
  return { tone: SIGNAL_TONES[signal.outcome] || 'muted', message };
}

// Razões de outcome (códigos do RecommendationEngine) em linguagem operacional.
const OUTCOME_REASON_LABELS = {
  no_baseline_metrics: 'Sem métricas de baseline para medir o resultado.',
  action_signal_positive: 'Efeito positivo observado na ação executada.',
  awaiting_action_signal: 'Aguardando o efeito da ação para medir o resultado.',
  no_customer_reply: 'Sem resposta do cliente na janela de 24h.',
  no_agent_response: 'Sem resposta da equipe na janela de 24h.',
  action_cancelled: 'Ação cancelada antes de produzir efeito.',
};

export function describeOutcomeReason(reason) {
  if (!reason) return null;
  return OUTCOME_REASON_LABELS[reason] || reason;
}
