import React, { useEffect, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, listProjectActivities, listProjects } from '../../api/projects';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function getActivityIcon(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('create') || a.includes('criou') || a.includes('created') || a.includes('added')) return '✨';
  if (a.includes('update') || a.includes('atualizou') || a.includes('updated') || a.includes('edit')) return '📝';
  if (a.includes('delete') || a.includes('deletou') || a.includes('removed') || a.includes('remove')) return '🗑️';
  if (a.includes('move') || a.includes('moveu') || a.includes('moved')) return '➡️';
  if (a.includes('complete') || a.includes('concluiu') || a.includes('completed') || a.includes('done')) return '✅';
  if (a.includes('comment') || a.includes('comentou') || a.includes('commented')) return '💬';
  if (a.includes('assign') || a.includes('atribuiu')) return '👤';
  if (a.includes('status') || a.includes('transition')) return '🔄';
  if (a.includes('attach') || a.includes('upload')) return '📎';
  return '📌';
}

function formatAction(action) {
  const a = String(action || '').toLowerCase();
  if (a.includes('item_created') || (a.includes('create') && a.includes('item'))) return 'Criou um item';
  if (a.includes('item_updated') || (a.includes('update') && a.includes('item'))) return 'Atualizou um item';
  if (a.includes('item_deleted') || (a.includes('delete') && a.includes('item'))) return 'Removeu um item';
  if (a.includes('item_moved') || (a.includes('move') && a.includes('item'))) return 'Moveu um item';
  if (a.includes('item_completed') || a.includes('item_done')) return 'Concluiu um item';
  if (a.includes('create') || a.includes('created') || a.includes('added')) return 'Item criado';
  if (a.includes('update') || a.includes('updated') || a.includes('edit')) return 'Item atualizado';
  if (a.includes('delete') || a.includes('deleted') || a.includes('removed')) return 'Item removido';
  if (a.includes('move') || a.includes('moved')) return 'Item movido';
  if (a.includes('complete') || a.includes('completed') || a.includes('done')) return 'Item concluído';
  if (a.includes('comment') || a.includes('commented')) return 'Comentou no item';
  if (a.includes('assign') || a.includes('assigned')) return 'Atribuiu responsável';
  if (a.includes('status') || a.includes('transition')) return 'Alterou o status';
  if (a.includes('attach') || a.includes('upload')) return 'Anexou arquivo';
  if (action) return action;
  return 'Atividade registrada';
}

export function ProjectActivitiesPage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const projectId = getProjectIdFromPath(currentPath);
  const [project, setProject] = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    async function load() {
      if (!projectId) return;
      setLoading(true);
      try {
        const [projectResponse, activitiesResponse] = await Promise.all([
          getProject(projectId),
          listProjectActivities(projectId),
        ]);
        setProject(projectResponse?.project || null);
        setActivities(Array.isArray(activitiesResponse?.activities) ? activitiesResponse.activities : []);
      } catch (error) {
        // Fallback automático para ID numérico inválido
        const isNumericId = /^\d+$/.test(String(projectId || ''));
        if (isNumericId || error?.status === 404) {
          try {
            const projectsResponse = await listProjects();
            const firstProject = Array.isArray(projectsResponse?.projects) && projectsResponse.projects[0];
            if (firstProject) {
              navigate(`/projects/${firstProject.id}/activities`);
              showToast('Redirecionando para o primeiro projeto disponível...', 'info');
              return;
            }
          } catch (fallbackError) {
            // Falhou ao carregar lista de projetos também
          }
        }
        showToast('Erro ao carregar atividades do projeto', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, showToast, navigate]);

  const filteredActivities = activities.filter((activity) => {
    if (!filter) return true;
    const text = `${activity.action || ''} ${activity.description || ''} ${activity.user_name || ''}`.toLowerCase();
    return text.includes(filter.toLowerCase());
  });

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Atividades do Projeto'}</h1>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg mb-6">
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="🔍 Filtrar atividades..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1 px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
          />
          <button
            type="button"
            className="px-4 py-2 rounded-lg border border-border-default bg-bg-secondary text-text-primary hover:bg-bg-elevated transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setFilter('')}
            disabled={!filter}
          >
            Limpar
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="text-text-secondary">Carregando atividades...</div>
        </div>
      ) : filteredActivities.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="text-text-secondary">Nenhuma atividade encontrada</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredActivities.map((activity, index) => (
            <div
              key={`${activity.id || index}`}
              className="bg-bg-elevated rounded-lg border border-border-default p-4 hover:border-border-active transition-colors"
            >
              <div className="flex gap-3">
                <div className="text-2xl">{getActivityIcon(activity.action)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap gap-2 items-start justify-between mb-1">
                    <div className="font-semibold text-text-primary">
                      {formatAction(activity.action)}
                    </div>
                    <div className="text-xs text-text-secondary">
                      {formatDate(activity.createdAt)}
                    </div>
                  </div>
                  {activity.description && (
                    <div className="text-sm text-text-secondary mb-1">
                      {activity.description}
                    </div>
                  )}
                  {activity.user_name && (
                    <div className="text-xs text-text-tertiary">
                      Por: <span className="font-medium">{activity.user_name}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </CrudPageBase>
  );
}
