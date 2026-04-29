import React from 'react';

const icons = {
  message: 'M',
  ticket: 'T',
  task: 'A',
  schedule: 'G',
  project: 'P',
  document: 'D',
  evidence: 'Q',
  conversation: 'C',
  lead: 'L',
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
          <h2 className="text-xl font-semibold">Timeline unificada</h2>
          <p className="workspace-muted text-sm">Mensagens, tickets, tarefas, agenda, projetos, documentos e evidências.</p>
        </div>
        {timeline?.total ? <span className="workspace-pill">{timeline.total} eventos</span> : null}
      </div>

      {loading ? <p className="workspace-muted">Montando timeline...</p> : null}
      {!loading && items.length === 0 ? <p className="workspace-muted">Nenhum evento relacionado encontrado.</p> : null}

      {items.map((event) => (
        <article key={`${event.type}-${event.refId}-${event.createdAt}`} className="workspace-timeline-item">
          <div className="workspace-timeline-dot">{icons[event.type] || '•'}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="workspace-pill">{event.type}</span>
              <span className="workspace-muted text-xs">{event.source}</span>
              <span className="workspace-muted text-xs">{formatDate(event.createdAt)}</span>
            </div>
            <p className="mt-2">{event.summary}</p>
            {event.detailUrl ? (
              <a className="workspace-muted text-sm underline mt-2 inline-block" href={event.detailUrl}>Abrir detalhe/replay</a>
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
