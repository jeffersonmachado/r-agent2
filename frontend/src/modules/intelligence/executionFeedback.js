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
};

const EXECUTED_LABELS = {
  create_task: 'Tarefa criada no Workspace para execução operacional.',
  send_message: 'Mensagem enviada para a fila do canal — entrega em andamento.',
  schedule: 'Follow-up agendado no Workspace.',
};

const FAILED_LABELS = {
  create_task: 'A ação operacional não pôde ser executada automaticamente; crie a tarefa manualmente.',
  send_message: 'A mensagem não pôde ser enviada automaticamente; responda pela Inbox.',
  schedule: 'O follow-up não pôde ser agendado automaticamente; agende manualmente.',
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
