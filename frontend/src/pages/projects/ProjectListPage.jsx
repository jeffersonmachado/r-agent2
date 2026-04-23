import React, { useEffect, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, listProjectActivities, listProjectItems } from '../../api/projects';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
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
        showToast('Erro ao carregar lista do projeto', 'error');
      }
    }
    load();
  }, [projectId, showToast]);

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Lista do Projeto'}</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <button type="button" className="support-button" onClick={() => navigate(`/projects/${projectId}`)}>Board</button>
          <button type="button" className="support-button" onClick={() => navigate(`/projects/${projectId}/dashboard`)}>Dashboard</button>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '2fr 1fr' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border-default">
                <th className="py-3 pr-4">Titulo</th>
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
                  <td className="py-3 pr-4">{item.item_type}</td>
                  <td className="py-3 pr-4">{item.status}</td>
                  <td className="py-3 pr-4">{item.priority}</td>
                  <td className="py-3 pr-4">{item.due_date ? new Date(item.due_date).toLocaleString('pt-BR') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-lg font-semibold text-text-primary mb-3">Historico recente</div>
          <div className="space-y-3">
            {activities.slice(0, 12).map((activity) => (
              <div key={activity.id} className="rounded-xl border border-border-default bg-bg-secondary p-3">
                <div className="text-sm text-text-primary">{activity.event_type}</div>
                <div className="text-xs text-text-secondary">{activity.created_at ? new Date(activity.created_at).toLocaleString('pt-BR') : '-'}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </CrudPageBase>
  );
}

export default ProjectListPage;
