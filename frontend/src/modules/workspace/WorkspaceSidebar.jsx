import React from 'react';

export function WorkspaceSidebar({ entities = [], selectedId, loading, query, onQueryChange, onSelect, onCreateDemo }) {
  return (
    <aside className="workspace-panel workspace-sidebar">
      <div className="mb-4">
        <p className="workspace-kicker text-xs uppercase tracking-[0.24em]">RAP Workspace</p>
        <h2 className="text-3xl mt-1">Clientes 360</h2>
        <p className="workspace-muted text-sm mt-2">Entidades unificadas por contato, conversa, ticket, QA e operacao.</p>
      </div>

      <input
        className="workspace-search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Buscar cliente, telefone ou email"
      />

      <button className="workspace-action-button mt-3" type="button" onClick={onCreateDemo}>
        Criar entidade rapida
      </button>

      <div className="workspace-entity-list mt-4 pr-1">
        {loading ? <p className="workspace-muted">Carregando entidades...</p> : null}
        {!loading && entities.length === 0 ? (
          <p className="workspace-muted">Nenhuma entidade ainda. Crie uma para iniciar o Workspace.</p>
        ) : null}
        {entities.map((entity) => (
          <button
            key={entity.id}
            type="button"
            className={`workspace-entity-card ${entity.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(entity.id)}
          >
            <div className="flex items-center justify-between gap-3">
              <strong>{entity.name}</strong>
              <span className="workspace-pill">{entity.type || 'contact'}</span>
            </div>
            <div className="workspace-muted text-sm mt-2">{entity.phone || entity.email || 'sem contato principal'}</div>
          </button>
        ))}
      </div>
    </aside>
  );
}
