const SUPPORT_MODE_LABELS = {
  bot: 'Sem intervenção humana',
  human: 'Humano',
  paused: 'Pausado',
};

const SUPPORT_REASON_LABELS = {
  inactivity: 'Inatividade',
  outside_window: 'Fora da janela de atendimento',
  manual: 'Ação manual',
  user_request: 'Solicitação do cliente',
  transfer: 'Transferência',
};

const SUPPORT_EVENT_LABELS = {
  'handover.take_over': 'Atendimento assumido',
  'handover.return_to_bot': 'Atendimento liberado',
  'handover.pause': 'Atendimento pausado',
  'handover.resume': 'Atendimento retomado',
  'ticket.assigned': 'Ticket atribuído',
  'ticket.unassigned': 'Ticket sem responsável',
  'ticket.closed': 'Ticket fechado',
  'ticket.reopened': 'Ticket reaberto',
  'ticket.created': 'Ticket criado',
  'ticket.updated': 'Ticket atualizado',
};

const SUPPORT_AUDIT_LABELS = {
  create: 'Criação',
  update: 'Atualização',
  delete: 'Exclusão',
  assign: 'Atribuição',
  unassign: 'Desatribuição',
  close: 'Fechamento',
  reopen: 'Reabertura',
  handover: 'Mudança de modo',
};

const SUPPORT_EVIDENCE_REASON_LABELS = {
  no_relevant_evidence_from_timeline: 'sem evidência relevante no histórico',
  insufficient_confidence: 'confiança insuficiente para sugerir evidência',
  no_evidence_for_entity: 'nenhuma evidência vinculada à entidade atual',
  fallback_exhausted: 'tentativas de busca esgotadas sem resultado forte',
};

function toTitleCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/[._-]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

export function formatSupportTechnicalLabel(value, fallback = 'n/a') {
  if (value == null || value === '') return fallback;
  return toTitleCase(value);
}

export function formatSupportActor(actor) {
  if (!actor) return null;
  return String(actor).toLowerCase() === 'system' ? 'Sistema' : actor;
}

export function formatSupportMode(mode) {
  const key = String(mode || '').trim().toLowerCase();
  return SUPPORT_MODE_LABELS[key] || toTitleCase(key) || 'Não informado';
}

export function formatSupportReason(reason) {
  const key = String(reason || '').trim().toLowerCase();
  return SUPPORT_REASON_LABELS[key] || toTitleCase(key) || null;
}

export function formatSupportEvidenceReason(reason) {
  const key = String(reason || '').trim().toLowerCase();
  if (!key) return null;
  return SUPPORT_EVIDENCE_REASON_LABELS[key] || formatSupportTechnicalLabel(key);
}

export function formatSupportEventType(type) {
  const key = String(type || '').trim().toLowerCase();
  return SUPPORT_EVENT_LABELS[key] || toTitleCase(key) || 'Evento';
}

export function formatSupportAuditAction(action) {
  const key = String(action || '').trim().toLowerCase();
  return SUPPORT_AUDIT_LABELS[key] || toTitleCase(key) || 'Ação';
}

function parseSupportObject(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function buildSupportEventSummary(eventRecord) {
  const payload = parseSupportObject(eventRecord?.payload) || eventRecord?.payload || {};
  const actor = payload?.actorUsername || payload?.actorName || payload?.actorId || eventRecord?.actorUsername || null;
  const mode = payload?.mode || eventRecord?.mode || null;
  const reason = payload?.reason || eventRecord?.reason || null;
  const queue = payload?.queue || eventRecord?.queue || null;
  const parts = [];

  if (mode) parts.push(`Modo: ${formatSupportMode(mode)}`);
  if (reason) parts.push(`Motivo: ${formatSupportReason(reason) || reason}`);
  if (actor) parts.push(`Responsável: ${formatSupportActor(actor)}`);
  if (queue) parts.push(`Fila: ${queue}`);

  return {
    summary: parts.join(' • '),
    technical: parseSupportObject(eventRecord?.payload),
  };
}

export function buildSupportAuditSummary(logRecord) {
  const detailsObject = parseSupportObject(logRecord?.details) || logRecord?.details || {};
  const actor = logRecord?.username || logRecord?.actorUsername || detailsObject?.actorUsername || detailsObject?.actorId || null;
  const reason = detailsObject?.reason || logRecord?.reason || null;
  const mode = detailsObject?.mode || logRecord?.mode || null;
  const parts = [];

  if (actor) parts.push(`Responsável: ${formatSupportActor(actor)}`);
  if (mode) parts.push(`Modo: ${formatSupportMode(mode)}`);
  if (reason) parts.push(`Motivo: ${formatSupportReason(reason) || reason}`);

  return {
    summary: parts.join(' • '),
    technical: parseSupportObject(logRecord?.details),
  };
}
