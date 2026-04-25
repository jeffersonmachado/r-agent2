import React from 'react';
import ProjectCard from '../components/ProjectCard.jsx';
import PriorityBadge from '../components/PriorityBadge.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

export function ProjectsPage({ model, onOpenProject }) {
  if (model.selectedProject) {
    return (
      <section className="wm-panel">
        <div className="wm-panel-header">
          <h2>Work Items</h2>
          <span>{model.workItems.length} itens do projeto</span>
        </div>
        <div className="wm-table-wrap">
          <table className="wm-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Prioridade</th>
                <th>Responsavel</th>
                <th>Prazo</th>
              </tr>
            </thead>
            <tbody>
              {model.workItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                  </td>
                  <td>{item.type}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td><PriorityBadge priority={item.priority} /></td>
                  <td>{item.assignee}</td>
                  <td>{new Date(item.dueDate).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <div className="wm-stack-lg">
      <section className="wm-panel">
        <div className="wm-panel-header">
          <h2>Projects</h2>
          <div className="wm-inline-meta">
            <button type="button" className={`wm-button ${model.projectView === 'cards' ? 'wm-button-primary' : 'wm-button-secondary'}`} onClick={() => model.setProjectView('cards')}>
              Cards
            </button>
            <button type="button" className={`wm-button ${model.projectView === 'table' ? 'wm-button-primary' : 'wm-button-secondary'}`} onClick={() => model.setProjectView('table')}>
              Table
            </button>
          </div>
        </div>

        {model.projectView === 'cards' ? (
          <div className="wm-card-grid">
            {model.projects.map((project) => <ProjectCard key={project.id} project={project} onOpen={onOpenProject} />)}
          </div>
        ) : (
          <div className="wm-table-wrap">
            <table className="wm-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Status</th>
                  <th>Progresso</th>
                  <th>Owner</th>
                  <th>Prazo</th>
                  <th>Health score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {model.projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.name}</strong>
                      <p>{project.portfolio} / {project.program}</p>
                    </td>
                    <td><StatusBadge status={project.status} /></td>
                    <td>{project.progress}%</td>
                    <td>{project.owner}</td>
                    <td>{new Date(project.dueDate).toLocaleDateString('pt-BR')}</td>
                    <td>{project.healthScore}</td>
                    <td>
                      <button type="button" className="wm-button wm-button-secondary" onClick={() => onOpenProject(project.id)}>
                        Abrir projeto
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ProjectsPage;