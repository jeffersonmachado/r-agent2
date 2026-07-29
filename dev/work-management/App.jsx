import React, { useMemo } from 'react';
import './styles.css';
import { useWorkManagement } from './hooks/useWorkManagement.js';
import ExecutionDrawer from './components/ExecutionDrawer.jsx';
import ReplayDrawer from './components/ReplayDrawer.jsx';
import WorkManagementPage from './components/WorkManagementPage.jsx';
import { WORK_MANAGEMENT_SECTIONS } from './types/models.js';
import AiSuggestionsPage from './pages/AiSuggestionsPage.jsx';
import BoardPage from './pages/BoardPage.jsx';
import DeliverablesPage from './pages/DeliverablesPage.jsx';
import DocumentsPage from './pages/DocumentsPage.jsx';
import MetricsPage from './pages/MetricsPage.jsx';
import OperationsPage from './pages/OperationsPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import QaValidationPage from './pages/QaValidationPage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import TimelinePage from './pages/TimelinePage.jsx';

const BASE_PATH = '/dev/work-management';

function parseCurrentPath(currentPath) {
  const relative = String(currentPath || '').startsWith(BASE_PATH)
    ? String(currentPath || '').slice(BASE_PATH.length)
    : '';
  const segments = relative.split('/').filter(Boolean);

  if (segments[0] === 'projects' && segments[1]) {
    const projectId = segments[1];
    const routeSegment = segments[2] || 'overview';
    const sectionId = routeSegment === 'items' ? 'projects' : routeSegment;
    return { projectId, sectionId };
  }

  return { projectId: null, sectionId: segments[0] || 'overview' };
}

function buildModulePath(sectionId) {
  if (!sectionId || sectionId === 'overview') return BASE_PATH;
  return `${BASE_PATH}/${sectionId}`;
}

function buildProjectPath(projectId, sectionId) {
  if (!projectId) return BASE_PATH;
  if (!sectionId || sectionId === 'overview') return `${BASE_PATH}/projects/${projectId}`;
  const routeSegment = sectionId === 'projects' ? 'items' : sectionId;
  return `${BASE_PATH}/projects/${projectId}/${routeSegment}`;
}

export default function WorkManagementApp({ currentPath, navigate }) {
  const routeState = useMemo(() => parseCurrentPath(currentPath), [currentPath]);
  const model = useWorkManagement({ projectId: routeState.projectId });
  const selectedProject = model.selectedProject;
  const activeSection = WORK_MANAGEMENT_SECTIONS.some((section) => section.id === routeState.sectionId)
    ? routeState.sectionId
    : 'overview';

  const navItems = useMemo(() => {
    return WORK_MANAGEMENT_SECTIONS.map((section) => {
      const isProjectItems = selectedProject && section.id === 'projects';
      return {
        ...section,
        label: isProjectItems ? 'Work Items' : section.label,
      };
    });
  }, [selectedProject]);

  function handleNavigate(sectionId) {
    if (selectedProject) {
      navigate?.(buildProjectPath(selectedProject.id, sectionId));
      return;
    }
    navigate?.(buildModulePath(sectionId));
  }

  function openProject(projectId) {
    navigate?.(buildProjectPath(projectId, 'overview'));
  }

  function openReplay(replayIdOrExecutionId) {
    const directReplay = model.replays.find((entry) => entry.id === replayIdOrExecutionId);
    if (directReplay) {
      model.openReplay(directReplay.id);
      return;
    }
    const linkedReplay = model.replays.find((entry) => entry.executionId === replayIdOrExecutionId);
    if (linkedReplay) {
      model.openReplay(linkedReplay.id);
    }
  }

  const commonProps = {
    model,
    onOpenProject: openProject,
  };

  let page = <OverviewPage {...commonProps} />;
  if (activeSection === 'projects') page = <ProjectsPage {...commonProps} />;
  if (activeSection === 'board') page = <BoardPage {...commonProps} />;
  if (activeSection === 'timeline') page = <TimelinePage {...commonProps} />;
  if (activeSection === 'deliverables') page = <DeliverablesPage {...commonProps} />;
  if (activeSection === 'operations') page = <OperationsPage {...commonProps} />;
  if (activeSection === 'qa-validation') page = <QaValidationPage {...commonProps} />;
  if (activeSection === 'documents') page = <DocumentsPage {...commonProps} />;
  if (activeSection === 'team') page = <TeamPage {...commonProps} />;
  if (activeSection === 'metrics') page = <MetricsPage {...commonProps} />;
  if (activeSection === 'ai-suggestions') page = <AiSuggestionsPage {...commonProps} />;

  const description = selectedProject
    ? `${selectedProject.description} Use as abas para alternar entre gestao generalista, operacao, validacao e IA no contexto do projeto.`
    : 'Modulo generalista para projetos, operacoes, iniciativas, QA, rollout e automacoes, com visao operacional autonoma embutida.';

  return (
    <>
      <WorkManagementPage
        title={selectedProject ? selectedProject.name : 'Work Management'}
        description={description}
        project={selectedProject}
        navItems={navItems}
        activeNavId={activeSection}
        onNavigate={handleNavigate}
        filters={model.filters}
        projects={model.projects}
        workspaces={model.workspaces}
        onFilterChange={model.setFilterValue}
        onResetFilters={model.resetFilters}
        loading={model.loading}
        error={model.error}
        sources={model.sources}
      >
        {selectedProject ? (
          <div className="wm-panel is-flat">
            <div className="wm-panel-header">
              <h2>Project context</h2>
              <button type="button" className="wm-button wm-button-secondary" onClick={() => navigate?.(buildModulePath('projects'))}>
                Voltar para projetos
              </button>
            </div>
            <div className="wm-inline-meta">
              <span>{selectedProject.portfolio}</span>
              <span>{selectedProject.program}</span>
              <span>{selectedProject.owner}</span>
              <span>{selectedProject.healthScore} health</span>
            </div>
          </div>
        ) : null}

        {page}
      </WorkManagementPage>

      <ExecutionDrawer
        execution={model.selectedExecution}
        workItem={model.selectedExecution ? model.itemsById[model.selectedExecution.workItemId] : null}
        evidence={model.selectedExecutionEvidence}
        onClose={model.closeExecution}
        onOpenReplay={openReplay}
      />

      <ReplayDrawer
        replay={model.selectedReplay}
        workItem={model.selectedReplay ? model.itemsById[model.selectedReplay.workItemId] : null}
        onClose={model.closeReplay}
      />
    </>
  );
}