import React, { useEffect, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, listProjectActivities, listProjectItems, listProjects } from '../../api/projects';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

function traduzirTipo(value) {
  const map = { task: 'Tarefa', milestone: 'Marco', bug: 'Bug', feature: 'Funcionalidade', epic: 'Épico', story: 'História', subtask: 'Sub-tarefa', chore: 'Manutenção', improvement: 'Melhoria' };
  const key = String(value || '').toLowerCase();
  return map[key] || String(value || 'Item');
}

function traduzirPrioridade(value) {
  const map = { critical: 'Crítica', high: 'Alta', medium: 'Média', low: 'Baixa', none: 'Sem prioridade' };
  const key = String(value || '').toLowerCase();
  return map[key] || String(value || 'Média');
}

function traduzirStatus(value) {
  const map = { done: 'Concluído', completed: 'Concluído', in_progress: 'Em andamento', doing: 'Em andamento', todo: 'Planejado', planned: 'Planejado', blocked: 'Bloqueado', review: 'Em revisão', waiting: 'Aguardando', cancelled: 'Cancelado' };
  const key = String(value || '').toLowerCase().replace(/ /g, '_');
  return map[key] || String(value || '-');
}

export function ProjectListPage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const projectId = getProjectIdFromPath(currentPath);
  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const [projectResponse, itemsResponse, activityResponse] = await Promise.all([
          getProject(projectId),
          listProjectItems(projectId),
          listProjectActivities(projectId),
        ]);
        setProject(projectResponse?.project || null);
        setItems(Array.isArray(itemsResponse?.items) ? itemsResponse.items : []);
        setActivities(Array.isArray(activityResponse?.activities) ? activityResponse.activities : []);
      } catch (error) {
        // Se ID for numérico (tipo "1"), provavelmente é um ID inválido - redireciona para o primeiro projeto
        // O sistema usa UUIDs, não IDs numéricos
        const isNumericId = /^\d+$/.test(String(projectId || ''));
        if (isNumericId || error?.status === 404) {
          try {
            const projectsResponse = await listProjects();
            const firstProject = Array.isArray(projectsResponse?.projects) && projectsResponse.projects[0];
            if (firstProject) {
              navigate(`/projects/${firstProject.id}/list`);
              showToast('Redirecionando para o primeiro projeto disponível...', 'info');
              return;
            }
          } catch (fallbackError) {
            // Falhou ao carregar lista de projetos também
          }
        }
        showToast('Erro ao carregar lista do projeto', 'error');
      }
    }
    load();
  }, [projectId, showToast, navigate]);

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Lista do Projeto'}</h1>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border-default">
                <th className="py-3 pr-4">Título</th>
                <th className="py-3 pr-4">Tipo</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Prioridade</th>
                <th className="py-3 pr-4">Prazo</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border-default text-text-primary">
                  <td className="py-3 pr-4">{item.title}</td>
                  <td className="py-3 pr-4">{traduzirTipo(item.item_type)}</td>
                  <td className="py-3 pr-4">{traduzirStatus(item.status)}</td>
                  <td className="py-3 pr-4">{traduzirPrioridade(item.priority)}</td>
                  <td className="py-3 pr-4">{item.due_date ? new Date(item.due_date).toLocaleString('pt-BR') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-lg font-semibold text-text-primary mb-3">Histórico recente</div>
          <div className="space-y-3">
            {activities.slice(0, 12).map((activity) => (
              <div key={activity.id} className="rounded-xl border border-border-default bg-bg-secondary p-3">
                <div className="text-sm text-text-primary">{activity.description || activity.action || activity.event_type || 'Atividade registrada'}</div>
                <div className="text-xs text-text-secondary">{(activity.created_at || activity.createdAt) ? new Date(activity.created_at || activity.createdAt).toLocaleString('pt-BR') : '-'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CrudPageBase>
  );
}

export default ProjectListPage;
