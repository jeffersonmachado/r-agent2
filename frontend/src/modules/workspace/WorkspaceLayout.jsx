import React from 'react';
import './workspace.css';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceTimeline } from './WorkspaceTimeline';
import { WorkspaceInsights } from './WorkspaceInsights';
import { WorkspaceActions } from './WorkspaceActions';

const tabs = ['Resumo', 'Timeline', 'Conversas', 'Tickets', 'Tarefas', 'Agenda', 'Projetos', 'Documentos', 'QA/RPA', 'Insights IA', 'Ações'];

export function WorkspaceLayout({
  entities,
  selectedEntity,
  selectedEntityId,
  loadingEntities,
  query,
  activeTab,
  timeline,
  insights,
  actions,
  loadingTimeline,
  loadingInsights,
  loadingActions,
  onQueryChange,
  onSelectEntity,
  onTabChange,
  onCreateDemo,
  onLoadMoreTimeline,
  onCreateSuggestedAction,
}) {
  const showTimeline = ['Resumo', 'Timeline', 'Conversas', 'Tickets', 'Tarefas', 'Agenda', 'Projetos', 'Documentos', 'QA/RPA'].includes(activeTab);
  const showInsights = ['Resumo', 'Insights IA'].includes(activeTab);
  const showActions = ['Resumo', 'Ações'].includes(activeTab);

  return (
    <div className="workspace-page">
      <div className="workspace-shell">
        <WorkspaceSidebar
          entities={entities}
          selectedId={selectedEntityId}
          loading={loadingEntities}
          query={query}
          onQueryChange={onQueryChange}
          onSelect={onSelectEntity}
          onCreateDemo={onCreateDemo}
        />

        <main className="workspace-panel workspace-main">
          <WorkspaceHeader entity={selectedEntity} />

          <nav className="workspace-tabs" aria-label="Workspace tabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={`workspace-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => onTabChange(tab)}
              >
                {tab}
              </button>
            ))}
          </nav>

          {!selectedEntity ? (
            <div className="workspace-empty">
              <div>
                <h2 className="text-2xl font-semibold">O sistema inteiro, visto pelo cliente.</h2>
                <p className="mt-2">Selecione ou crie uma entidade para abrir a visão 360.</p>
              </div>
            </div>
          ) : (
            <div className="workspace-grid">
              {showTimeline ? (
                <WorkspaceTimeline timeline={timeline} loading={loadingTimeline} onLoadMore={onLoadMoreTimeline} />
              ) : (
                <WorkspaceInsights insights={insights} loading={loadingInsights} />
              )}
              <div className="grid gap-4 min-h-0">
                {showInsights ? <WorkspaceInsights insights={insights} loading={loadingInsights} /> : null}
                {showActions ? <WorkspaceActions actions={actions} loading={loadingActions} onCreateSuggested={onCreateSuggestedAction} /> : null}
                {!showInsights && !showActions ? <WorkspaceActions actions={actions} loading={loadingActions} onCreateSuggested={onCreateSuggestedAction} /> : null}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
