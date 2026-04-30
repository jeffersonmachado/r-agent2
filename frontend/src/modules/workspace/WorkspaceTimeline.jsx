import React from 'react';

const icons = {
  message: '💬',
  ticket: '🎫',
  task: '✅',
  schedule: '🗓️',
  project: '📁',
  document: '📄',
  evidence: '🧪',
  conversation: '🗨️',
  lead: '✨',
  payment: '💳',
};

const tones = {
  message: 'message',
  ticket: 'ticket',
  task: 'task',
  schedule: 'schedule',
  project: 'project',
  document: 'document',
  evidence: 'evidence',
  conversation: 'conversation',
  lead: 'lead',
  payment: 'payment',
};

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function WorkspaceTimeline({ timeline, loading, onLoadMore }) {
  const items = timeline?.items || [];
  return (
    <section className="workspace-card workspace-scroll">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Timeline operacional</h2>
          <p className="workspace-muted text-sm">Mensagens, tickets, tarefas, agenda, projetos, documentos, pagamentos e evidências QA/RPA.</p>
        </div>
        {timeline?.total ? <span className="workspace-pill">{timeline.total} eventos</span> : null}
      </div>

      {loading ? <div className="workspace-skeleton-stack"><div className="workspace-skeleton h-20"></div><div className="workspace-skeleton h-20"></div><div className="workspace-skeleton h-20"></div></div> : null}
      {!loading && items.length === 0 ? <div className="workspace-empty-state"><strong>Nenhum evento relacionado.</strong><p className="workspace-muted text-sm mt-2">Quando a entidade tiver histórico operacional, a timeline será exibida aqui.</p></div> : null}

      {items.map((event) => (
        <article key={`${event.type}-${event.refId}-${event.createdAt}`} className={`workspace-timeline-item ${tones[event.type] || 'default'}`}>
          <div className={`workspace-timeline-dot ${tones[event.type] || 'default'}`}>{icons[event.type] || '•'}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2 workspace-timeline-topline">
              <span className="workspace-pill subtle">{event.type}</span>
              <span className="workspace-muted text-xs">Origem {event.source}</span>
              <span className="workspace-muted text-xs">{formatDate(event.createdAt)}</span>
              {typeof event.confidence === 'number' ? <span className="workspace-pill subtle">Confiança {Math.round(event.confidence * 100)}%</span> : null}
            </div>
            <p className="mt-2 workspace-event-summary">{event.summary}</p>
            {event.detailUrl ? (
              <a className="workspace-muted text-sm underline mt-2 inline-block" href={event.detailUrl}>Abrir detalhe</a>
            ) : null}
          </div>
        </article>
      ))}

      {timeline?.hasMore ? (
        <button className="workspace-action-button" type="button" onClick={onLoadMore}>Carregar mais</button>
      ) : null}
    </section>
  );
}
