import React from 'react';
import './workspace.css';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceTimeline } from './WorkspaceTimeline';
import { WorkspaceInsights } from './WorkspaceInsights';
import { WorkspaceActions } from './WorkspaceActions';
import { WorkspaceQaRpaPanel } from './WorkspaceQaRpaPanel';
import { WorkspaceRightRail } from './WorkspaceRightRail';

const tabs = ['Resumo', 'Timeline', 'Conversas', 'Tickets', 'Tarefas', 'Agenda', 'Projetos', 'Documentos', 'Pagamentos', 'QA/RPA', 'Insights IA', 'Ações'];

export function WorkspaceLayout({
  entities,
  selectedEntity,
  selectedSummary,
  selectedEntityId,
  entitySummaries,
  loadingEntities,
  query,
  sidebarFilter,
  activeTab,
  timeline,
  insights,
  actions,
  autocorrections,
  loadingTimeline,
  loadingInsights,
  loadingActions,
  loadingAutoCorrections,
  onQueryChange,
  onSidebarFilterChange,
  onSelectEntity,
  onTabChange,
  onCreateDemo,
  onLoadMoreTimeline,
  onCreateSuggestedAction,
  onCreateTask,
  onCreateFollowUp,
}) {
  const showTimeline = ['Resumo', 'Timeline', 'Conversas', 'Tickets', 'Tarefas', 'Agenda', 'Projetos', 'Documentos', 'Pagamentos'].includes(activeTab);
  const showInsights = ['Resumo', 'Insights IA'].includes(activeTab);
  const showActions = ['Resumo', 'Ações'].includes(activeTab);
  const showQaPanel = activeTab === 'QA/RPA';

  return (
    <div className="workspace-page">
      <div className="workspace-shell">
        <WorkspaceSidebar
          entities={entities}
          entitySummaries={entitySummaries}
          selectedId={selectedEntityId}
          loading={loadingEntities}
          query={query}
          activeFilter={sidebarFilter}
          onQueryChange={onQueryChange}
          onFilterChange={onSidebarFilterChange}
          onSelect={onSelectEntity}
          onCreateDemo={onCreateDemo}
        />

        <main className="workspace-panel workspace-main">
          <WorkspaceHeader entity={selectedEntity} summary={selectedSummary} onCreateTask={onCreateTask} onCreateFollowUp={onCreateFollowUp} />

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
              <div className="workspace-center-column">
              {showQaPanel ? (
                <WorkspaceQaRpaPanel autocorrections={autocorrections} loading={loadingAutoCorrections} timeline={timeline} />
              ) : showTimeline ? (
                <WorkspaceTimeline timeline={timeline} loading={loadingTimeline} onLoadMore={onLoadMoreTimeline} />
              ) : (
                <WorkspaceInsights insights={insights} loading={loadingInsights} />
              )}
              </div>
              <WorkspaceRightRail
                summary={selectedSummary}
                insights={insights}
                actions={actions}
                autocorrections={autocorrections}
                loadingInsights={loadingInsights}
                loadingActions={loadingActions}
                loadingAutoCorrections={loadingAutoCorrections}
              />
              <div className="workspace-detail-stack">
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
