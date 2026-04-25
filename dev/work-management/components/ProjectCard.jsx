import React from 'react';
import PriorityBadge from './PriorityBadge.jsx';
import StatusBadge from './StatusBadge.jsx';

export function ProjectCard({ project, onOpen }) {
  return (
    <article className="wm-project-card">
      <div className="wm-split-row wm-gap-sm">
        <div>
          <div className="wm-overline">{project.portfolio} / {project.program}</div>
          <h3>{project.name}</h3>
          <p>{project.description}</p>
        </div>
        <PriorityBadge priority={project.priority} />
      </div>

      <div className="wm-project-meta">
        <StatusBadge status={project.status} />
        <span>Owner: {project.owner}</span>
        <span>Health: {project.healthScore}</span>
        <span>Due: {new Date(project.dueDate).toLocaleDateString('pt-BR')}</span>
      </div>

      <div className="wm-progress-block">
        <div className="wm-split-row">
          <span>Progress</span>
          <strong>{project.progress}%</strong>
        </div>
        <div className="wm-progress-bar">
          <span style={{ width: `${project.progress}%` }} />
        </div>
      </div>

      <button type="button" className="wm-button wm-button-primary" onClick={() => onOpen?.(project.id)}>
        Abrir projeto
      </button>
    </article>
  );
}

export default ProjectCard;