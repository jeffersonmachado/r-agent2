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

const RISK_BADGES = {
  attention: { label: 'Atenção', tone: 'warning' },
  critical: { label: 'Crítico', tone: 'critical' },
};

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function WorkspaceSidebar({ entities = [], selectedId, loading, query, activeFilter, classification = 'PRODUCTION', onQueryChange, onFilterChange, onSelect, onCreateDemo }) {
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
            const summary = entity.summary || {};
            const riskBadge = RISK_BADGES[summary.riskLevel] || null;
            const tone = riskBadge?.tone || 'healthy';
            return (
          <button
            key={entity.id}
            type="button"
            className={`workspace-entity-card ${entity.id === selectedId ? 'active' : ''}`}
            onClick={() => onSelect(entity.id)}
          >
            <div className="flex items-center justify-between gap-3">
              <strong>{entity.name}</strong>
              <span className={`workspace-status-dot ${tone}`}></span>
            </div>
            <div className="workspace-muted text-sm mt-2">{entity.phone || entity.email || 'sem contato principal'}</div>
            <div className="workspace-entity-meta mt-3">
              <span className="workspace-pill subtle">{entity.type || 'contact'}</span>
              {riskBadge ? <span className={`workspace-pill ${riskBadge.tone}`}>{riskBadge.label}</span> : null}
              {summary.riskLevel === 'critical' ? <span className="workspace-pill critical">{labels.failurePill}</span> : null}
              {summary.openTickets > 0 ? <span className="workspace-pill subtle">{countLabel(summary.openTickets, 'ticket aberto', 'tickets abertos')}</span> : null}
              {summary.pendingPayments > 0 ? <span className="workspace-pill subtle">{countLabel(summary.pendingPayments, 'pagamento pendente', 'pagamentos pendentes')}</span> : null}
              {summary.pendingActions > 0 ? <span className="workspace-pill subtle">{countLabel(summary.pendingActions, 'ação pendente', 'ações pendentes')}</span> : null}
            </div>
            <div className="workspace-muted text-xs mt-3">Última atividade: {formatLastActivity(summary.lastInteractionAt || entity.updated_at)}</div>
          </button>
            );
          })()
        ))}
      </div>
    </aside>
  );
}
