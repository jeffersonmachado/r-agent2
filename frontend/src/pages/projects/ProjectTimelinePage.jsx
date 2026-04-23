import React, { useEffect, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, getProjectTimeline } from '../../api/projects';

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

export function ProjectTimelinePage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const projectId = getProjectIdFromPath(currentPath);
  const [project, setProject] = useState(null);
  const [timeline, setTimeline] = useState({ milestones: [], scheduledItems: [] });

  useEffect(() => {
    async function load() {
      try {
        const [projectResponse, timelineResponse] = await Promise.all([
          getProject(projectId),
          getProjectTimeline(projectId),
        ]);
        setProject(projectResponse?.project || null);
        setTimeline(timelineResponse?.timeline || { milestones: [], scheduledItems: [] });
      } catch (error) {
        showToast('Erro ao carregar timeline do projeto', 'error');
      }
    }
    load();
  }, [projectId, showToast]);

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Timeline do Projeto'}</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <button type="button" className="support-button" onClick={() => navigate(`/projects/${projectId}`)}>Board</button>
          <button type="button" className="support-button" onClick={() => navigate(`/projects/${projectId}/dashboard`)}>Dashboard</button>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg">
          <div className="text-lg font-semibold text-text-primary mb-4">Milestones</div>
          <div className="space-y-3">
            {(timeline.milestones || []).map((milestone) => (
              <div key={milestone.id} className="rounded-xl border border-border-default bg-bg-secondary p-4">
                <div className="text-sm text-text-secondary mb-1">{milestone.status}</div>
                <div className="text-base font-semibold text-text-primary">{milestone.name}</div>
                <div className="text-sm text-text-secondary">{formatDate(milestone.due_date)}</div>
              </div>
            ))}
            {(timeline.milestones || []).length === 0 ? <div className="text-sm text-text-secondary">Nenhum milestone registrado.</div> : null}
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg">
          <div className="text-lg font-semibold text-text-primary mb-4">Itens programados</div>
          <div className="space-y-3">
            {(timeline.scheduledItems || []).map((item) => (
              <div key={item.id} className="rounded-xl border border-border-default bg-bg-secondary p-4">
                <div className="text-sm text-text-secondary mb-1">{item.item_type} • {item.status}</div>
                <div className="text-base font-semibold text-text-primary">{item.title}</div>
                <div className="text-sm text-text-secondary">Inicio: {formatDate(item.start_date)}</div>
                <div className="text-sm text-text-secondary">Prazo: {formatDate(item.due_date)}</div>
              </div>
            ))}
            {(timeline.scheduledItems || []).length === 0 ? <div className="text-sm text-text-secondary">Nenhum item com agenda definida.</div> : null}
          </div>
        </div>
      </div>
    </CrudPageBase>
  );
}

export default ProjectTimelinePage;
