import React, { useEffect, useMemo, useState } from 'react';
import { CrudPageBase } from '../../modules/crud-base';
import { useRouter } from '../../hooks/useRouter';
import { useToast } from '../../components/Toast';
import { getProject, getProjectTimeline, listProjects } from '../../api/projects';

function getProjectIdFromPath(path) {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts[1] || null;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(value) {
  const date = toDate(value);
  if (!date) return '-';
  return date.toLocaleDateString('pt-BR');
}

function buildMonthGrid(baseDate) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
}

export function ProjectCalendarViewPage() {
  const { currentPath, navigate } = useRouter();
  const { ToastContainer, showToast } = useToast();
  const projectId = getProjectIdFromPath(currentPath);

  const [project, setProject] = useState(null);
  const [items, setItems] = useState([]);
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      if (!projectId) return;
      setLoading(true);
      try {
        const [projectResponse, timelineResponse] = await Promise.all([
          getProject(projectId),
          getProjectTimeline(projectId),
        ]);
        setProject(projectResponse?.project || null);
        const scheduledItems = Array.isArray(timelineResponse?.timeline?.scheduledItems)
          ? timelineResponse.timeline.scheduledItems
          : [];
        setItems(scheduledItems);
      } catch (error) {
        const isNumericId = /^\d+$/.test(String(projectId || ''));
        if (isNumericId || error?.status === 404) {
          try {
            const projectsResponse = await listProjects();
            const firstProject = Array.isArray(projectsResponse?.projects) && projectsResponse.projects[0];
            if (firstProject) {
              navigate(`/projects/${firstProject.id}/calendar`);
              showToast('Redirecionando para o primeiro projeto disponível...', 'info');
              return;
            }
          } catch (_) {
            // no-op
          }
        }
        showToast('Erro ao carregar calendário do projeto', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId, navigate, showToast]);

  const monthGrid = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);

  const itemsByDay = useMemo(() => {
    const grouped = {};
    items.forEach((item) => {
      const due = toDate(item.due_date);
      if (!due) return;
      const key = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(item);
    });
    return grouped;
  }, [items]);

  const currentYear = monthCursor.getFullYear();
  const currentMonth = monthCursor.getMonth();

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <h1>{project?.name || 'Calendário do Projeto'}</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12 text-text-secondary">Carregando calendário...</div>
      ) : (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-lg">
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className="text-xl font-semibold text-text-primary">Calendário de Entregas</h2>
            <div className="flex gap-2">
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-border-default text-sm font-medium text-text-primary bg-bg-secondary hover:bg-bg-elevated transition-colors cursor-pointer"
                onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              >
                Mês anterior
              </button>
              <button
                type="button"
                className="px-4 py-2 rounded-lg border border-border-default text-sm font-medium text-text-primary bg-bg-secondary hover:bg-bg-elevated transition-colors cursor-pointer"
                onClick={() => setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              >
                Próximo mês
              </button>
            </div>
          </div>

          <div className="text-sm text-text-secondary mb-4">
            {monthCursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </div>

          <div className="grid grid-cols-7 gap-2 text-xs text-text-secondary mb-2">
            {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'].map((day) => (
              <div key={day} className="px-2 py-1 font-semibold">{day}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {monthGrid.map((date) => {
              const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const dayItems = itemsByDay[dayKey] || [];
              const inCurrentMonth = date.getMonth() === currentMonth && date.getFullYear() === currentYear;

              return (
                <div
                  key={dayKey}
                  className={`min-h-[120px] rounded-lg border p-2 ${inCurrentMonth ? 'bg-bg-secondary border-border-default' : 'bg-bg-tertiary border-border-default/50 opacity-70'}`}
                >
                  <div className="text-xs font-semibold text-text-primary mb-1">{date.getDate()}</div>
                  <div className="space-y-1">
                    {dayItems.slice(0, 3).map((item) => (
                      <div key={item.id} className="text-[11px] px-1.5 py-1 rounded bg-bg-elevated border border-border-default text-text-primary truncate" title={`${item.title} • ${formatDate(item.due_date)}`}>
                        {item.title}
                      </div>
                    ))}
                    {dayItems.length > 3 ? (
                      <div className="text-[11px] text-text-secondary">+{dayItems.length - 3} mais</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </CrudPageBase>
  );
}

export default ProjectCalendarViewPage;
