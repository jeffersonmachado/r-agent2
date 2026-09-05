import React from 'react';
import './workspace.css';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceTimeline } from './WorkspaceTimeline';
import { WorkspaceInsights } from './WorkspaceInsights';
import { WorkspaceActions } from './WorkspaceActions';
import { WorkspaceRightRail } from './WorkspaceRightRail';
import {
  DEV_SURFACE_TAB,
  WorkspaceQaRpaPanel,
  buildDevSurfacePanelProps,
  getWorkspaceTabs,
  isDevSurfaceVisible,
} from './workspaceDevSurface';

export function WorkspaceLayout({
  entities,
  selectedEntity,
  selectedSummary,
  selectedEntityId,
  loadingEntities,
  query,
  sidebarFilter,
  activeTab,
  timeline,
  insights,
  actions,
  incidents,
  loadingTimeline,
  loadingInsights,
  loadingActions,
  loadingIncidents,
  classification = 'PRODUCTION',
  onQueryChange,
  onSidebarFilterChange,
  onSelectEntity,
  onTabChange,
  onCreateDemo,
  onLoadMoreTimeline,
  onCreateSuggestedAction,
  onExecuteSuggestion,
  onCreateTask,
  onCreateFollowUp,
  onRegisterPayment,
  onSchedule,
}) {
  const tabs = getWorkspaceTabs(classification);
  const devSurfaceVisible = isDevSurfaceVisible(classification);
  const showTimeline = ['Resumo', 'Timeline', 'Conversas', 'Tickets', 'Tarefas', 'Agenda', 'Projetos', 'Documentos', 'Pagamentos'].includes(activeTab);
  const showInsights = ['Resumo', 'Insights IA'].includes(activeTab);
  const showActions = ['Resumo', 'Ações'].includes(activeTab);
  const showQaPanel = devSurfaceVisible && activeTab === DEV_SURFACE_TAB;

  return (
    <div className="workspace-page">
      <div className="workspace-shell">
        <WorkspaceSidebar
          entities={entities}
          selectedId={selectedEntityId}
          loading={loadingEntities}
          query={query}
          activeFilter={sidebarFilter}
          classification={classification}
          onQueryChange={onQueryChange}
          onFilterChange={onSidebarFilterChange}
          onSelect={onSelectEntity}
          onCreateDemo={onCreateDemo}
        />

        <main className="workspace-panel workspace-main">
          <WorkspaceHeader entity={selectedEntity} summary={selectedSummary} onCreateTask={onCreateTask} onCreateFollowUp={onCreateFollowUp} onRegisterPayment={onRegisterPayment} onSchedule={onSchedule} />

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
                  <WorkspaceQaRpaPanel {...buildDevSurfacePanelProps({ incidents, loading: loadingIncidents, timeline })} />
                ) : showTimeline ? (
                  <WorkspaceTimeline timeline={timeline} loading={loadingTimeline} classification={classification} onLoadMore={onLoadMoreTimeline} />
                ) : (
                  <WorkspaceInsights insights={insights} loading={loadingInsights} />
                )}
              </div>

              <div className="workspace-detail-stack">
                {showInsights ? <WorkspaceInsights insights={insights} loading={loadingInsights} /> : null}
                {showActions ? <WorkspaceActions actions={actions} loading={loadingActions} onCreateSuggested={onCreateSuggestedAction} onExecuteSuggestion={onExecuteSuggestion} /> : null}
                {!showInsights && !showActions ? <WorkspaceActions actions={actions} loading={loadingActions} onCreateSuggested={onCreateSuggestedAction} onExecuteSuggestion={onExecuteSuggestion} /> : null}
                <WorkspaceRightRail
                  summary={selectedSummary}
                  insights={insights}
                  actions={actions}
                  incidents={incidents}
                  loadingInsights={loadingInsights}
                  loadingActions={loadingActions}
                  loadingIncidents={loadingIncidents}
                  classification={classification}
                  onExecuteSuggestion={onExecuteSuggestion}
                />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
