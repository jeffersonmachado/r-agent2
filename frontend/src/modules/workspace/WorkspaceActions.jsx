import React from 'react';

export function WorkspaceActions({ actions, loading, onCreateSuggested }) {
  const items = actions?.items || [];
  const suggestion = actions?.suggestion;

  return (
    <section className="workspace-card workspace-scroll">
      <h2 className="text-xl font-semibold">Ações inteligentes</h2>
      <p className="workspace-muted text-sm mb-4">Tarefas, follow-ups, notificações e automações sugeridas.</p>

      {suggestion ? (
        <div className="rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 mb-4">
          <span className="workspace-pill">{suggestion.type}</span>
          <h3 className="text-lg font-semibold mt-2">{suggestion.label}</h3>
          <p className="workspace-muted text-sm mt-1">{suggestion.reason}</p>
          <button className="workspace-action-button mt-3" type="button" onClick={() => onCreateSuggested(suggestion)}>
            Criar ação sugerida
          </button>
        </div>
      ) : null}

      {loading ? <p className="workspace-muted">Carregando ações...</p> : null}
      {!loading && items.length === 0 ? <p className="workspace-muted">Nenhuma ação persistida ainda.</p> : null}
      {items.map((action) => (
        <article key={action.id} className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="workspace-pill">{action.type}</span>
            <span className="workspace-muted text-xs">{action.status}</span>
          </div>
          <p className="mt-2">{action.payload?.title || action.payload?.label || 'Ação do Workspace'}</p>
        </article>
      ))}
    </section>
  );
}
