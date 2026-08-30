import React from 'react';
import { getOperationalLabels, getSidebarFilters } from './workspaceDevSurface';

function formatLastActivity(value) {
  if (!value) return 'sem atividade recente';
  try {
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function WorkspaceSidebar({ entities = [], entitySummaries = {}, selectedId, loading, query, activeFilter, classification = 'PRODUCTION', onQueryChange, onFilterChange, onSelect, onCreateDemo }) {
  const filters = getSidebarFilters(classification);
  const labels = getOperationalLabels(classification);

  return (
    <aside className="workspace-panel workspace-sidebar">
      <div className="mb-4">
        <p className="workspace-kicker text-xs uppercase tracking-[0.24em]">RAP Workspace</p>
        <h2 className="text-3xl mt-1">Clientes 360</h2>
        <p className="workspace-muted text-sm mt-2">{labels.sidebarDescription}</p>
      </div>

      <input
        className="workspace-search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Buscar cliente, telefone ou email"
      />

      <div className="workspace-filter-row mt-3">
        {filters.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`workspace-filter-chip ${activeFilter === filter.id ? 'active' : ''}`}
            onClick={() => onFilterChange(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <button className="workspace-action-button mt-3" type="button" onClick={onCreateDemo}>
        Criar entidade rápida
      </button>

      <div className="workspace-entity-list mt-4 pr-1">
        {loading ? <p className="workspace-muted">Carregando entidades...</p> : null}
        {!loading && entities.length === 0 ? (
          <p className="workspace-muted">Nenhuma entidade ainda. Crie uma para iniciar o Workspace.</p>
        ) : null}
        {entities.map((entity) => (
          (() => {
            const summary = entitySummaries[entity.id] || {};
            return (
          <button
            key={entity.id}
            type="button"
            className={`workspace-entity-card ${entity.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(entity.id)}
          >
            <div className="flex items-center justify-between gap-3">
              <strong>{entity.name}</strong>
              <span className={`workspace-status-dot ${summary.healthTone || 'healthy'}`}></span>
            </div>
            <div className="workspace-muted text-sm mt-2">{entity.phone || entity.email || 'sem contato principal'}</div>
            <div className="workspace-entity-meta mt-3">
              <span className="workspace-pill subtle">{entity.type || 'contact'}</span>
              <span className={`workspace-pill ${summary.healthTone || 'healthy'}`}>{summary.healthLabel || 'Saudável'}</span>
              {summary.hasQaFailure ? <span className="workspace-pill critical">{labels.failurePill}</span> : null}
              {summary.riskLevel && summary.riskLevel !== 'Estável' ? <span className="workspace-pill warning">{summary.riskLevel}</span> : null}
            </div>
            <div className="workspace-muted text-xs mt-3">Última atividade: {formatLastActivity(summary.lastActivityAt || entity.updated_at)}</div>
          </button>
            );
          })()
        ))}
      </div>
    </aside>
  );
}
