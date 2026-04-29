import React, { useEffect, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, getProjectDashboard, listProjects } from '../../api/projects';
import { ProjectKpis } from '../../components/projects/ProjectKpis';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

export function ProjectDashboardPage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const projectId = getProjectIdFromPath(currentPath);
  const [project, setProject] = useState(null);
  const [dashboard, setDashboard] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const [projectResponse, dashboardResponse] = await Promise.all([
          getProject(projectId),
          getProjectDashboard(projectId),
        ]);
        setProject(projectResponse?.project || null);
        setDashboard(dashboardResponse?.dashboard || null);
      } catch (error) {
        // Se ID for numérico (tipo "1"), provavelmente é um ID inválido - redireciona para o primeiro projeto
        // O sistema usa UUIDs, não IDs numéricos
        const isNumericId = /^\d+$/.test(String(projectId || ''));
        if (isNumericId || error?.status === 404) {
          try {
            const projectsResponse = await listProjects();
            const firstProject = Array.isArray(projectsResponse?.projects) && projectsResponse.projects[0];
            if (firstProject) {
              navigate(`/projects/${firstProject.id}/dashboard`);
              showToast('Redirecionando para o primeiro projeto disponível...', 'info');
              return;
            }
          } catch (fallbackError) {
            // Falhou ao carregar lista de projetos também
          }
        }
        showToast('Erro ao carregar painel do projeto', 'error');
      }
    }
    load();
  }, [projectId, showToast, navigate]);

  const flow = Array.isArray(dashboard?.flow) ? dashboard.flow : [];
  const byTypeEntries = Object.entries(dashboard?.byType || {});

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Painel do Projeto'}</h1>
      </div>

      <ProjectKpis dashboard={dashboard} />

      <div className="grid gap-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg">
          <div className="text-lg font-semibold text-text-primary mb-4">Fluxo por coluna</div>
          <div className="space-y-3">
            {flow.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between rounded-xl bg-bg-secondary border border-border-default p-3">
                <div className="text-text-primary">{entry.name}</div>
                <div className="text-text-secondary">{entry.count}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg">
          <div className="text-lg font-semibold text-text-primary mb-4">Distribuição por tipo</div>
          <div className="space-y-3">
            {byTypeEntries.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between rounded-xl bg-bg-secondary border border-border-default p-3">
                <div className="text-text-primary">{type}</div>
                <div className="text-text-secondary">{count}</div>
              </div>
            ))}
            {byTypeEntries.length === 0 ? <div className="text-sm text-text-secondary">Sem dados ainda.</div> : null}
          </div>
        </div>
      </div>
    </CrudPageBase>
  );
}

export default ProjectDashboardPage;
