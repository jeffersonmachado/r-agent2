import React from 'react';
import GlobalFiltersBar from './GlobalFiltersBar.jsx';

export function WorkManagementPage({
  title,
  description,
  project = null,
  navItems = [],
  activeNavId,
  onNavigate,
  filters,
  projects,
  workspaces,
  onFilterChange,
  onResetFilters,
  children,
  loading,
  error,
  sources = null,
}) {
  return (
    <div className="wm-shell">
      <section className="wm-hero">
        <div>
          <div className="wm-overline">Results Autonomous Platform</div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {project ? (
          <div className="wm-project-summary-card">
            <span>Projeto</span>
            <strong>{project.name}</strong>
            <p>{project.owner}</p>
          </div>
        ) : (
          <div className="wm-project-summary-card">
            <span>Modo</span>
            <strong>Work Management</strong>
            <p>Generalista + operacional + validacao + IA</p>
          </div>
        )}
      </section>

      <nav className="wm-nav-strip" aria-label="Work Management navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`wm-nav-pill ${activeNavId === item.id ? 'is-active' : ''}`}
            onClick={() => onNavigate?.(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <GlobalFiltersBar
        filters={filters}
        projects={projects}
        workspaces={workspaces}
        onChange={onFilterChange}
        onReset={onResetFilters}
      />

      {sources && Object.keys(sources).length ? (
        <div className="wm-source-legend">
          <span className="wm-overline">Fontes de dados</span>
          {Object.entries(sources).map(([domain, source]) => (
            <span key={domain} className={`wm-source-pill ${source === 'live' ? 'is-live' : 'is-mock'}`}>
              {domain}: {source}
            </span>
          ))}
        </div>
      ) : null}

      {loading ? <div className="wm-panel"><div className="wm-empty-state">Carregando modulo...</div></div> : null}
      {error ? <div className="wm-panel"><div className="wm-empty-state is-error">{error}</div></div> : null}
      {!loading && !error ? children : null}
    </div>
  );
}

export default WorkManagementPage;