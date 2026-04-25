import React, { useMemo } from 'react';
import StatusBadge from './StatusBadge.jsx';

function daysBetween(start, end) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(diff / (24 * 60 * 60 * 1000)));
}

export function TimelineView({ projects = [] }) {
  const range = useMemo(() => {
    if (!projects.length) return { start: new Date('2026-04-01'), end: new Date('2026-05-31') };
    const dates = projects.flatMap((project) => [new Date(project.startDate), new Date(project.dueDate)]);
    return {
      start: new Date(Math.min(...dates.map((date) => date.getTime()))),
      end: new Date(Math.max(...dates.map((date) => date.getTime()))),
    };
  }, [projects]);

  const totalDays = daysBetween(range.start, range.end);

  if (!projects.length) {
    return <div className="wm-empty-state">Nenhum projeto disponivel para timeline.</div>;
  }

  return (
    <div className="wm-panel">
      <div className="wm-stack-md">
        {projects.map((project) => {
          const offset = daysBetween(range.start, project.startDate);
          const duration = daysBetween(project.startDate, project.dueDate);
          return (
            <article key={project.id} className="wm-timeline-project">
              <div className="wm-split-row wm-gap-sm">
                <div>
                  <strong>{project.name}</strong>
                  <p>{project.owner}</p>
                </div>
                <StatusBadge status={project.status} />
              </div>
              <div className="wm-timeline-bar">
                <span
                  style={{
                    left: `${(offset / totalDays) * 100}%`,
                    width: `${Math.max((duration / totalDays) * 100, 10)}%`,
                  }}
                />
              </div>
              <div className="wm-inline-meta">
                <span>{new Date(project.startDate).toLocaleDateString('pt-BR')}</span>
                <span>{new Date(project.dueDate).toLocaleDateString('pt-BR')}</span>
                <span>Health {project.healthScore}</span>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

export default TimelineView;