import React from 'react';
import AiSuggestionsPanel from './AiSuggestionsPanel.jsx';
import ActivityTimeline from './ActivityTimeline.jsx';
import ProjectCard from './ProjectCard.jsx';
import StatusBadge from './StatusBadge.jsx';

function KpiCard({ label, value, help }) {
  return (
    <article className="wm-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{help}</small>
    </article>
  );
}

export function OverviewDashboard({ totals, projects, activity, aiSuggestions, alerts, onOpenProject }) {
  return (
    <div className="wm-stack-lg">
      <section className="wm-kpi-grid">
        <KpiCard label="Total de projetos" value={totals.totalProjects} help="escopo atual" />
        <KpiCard label="Itens abertos" value={totals.openItems} help="work items em andamento" />
        <KpiCard label="Itens em risco" value={totals.atRisk} help="bloqueios ou criticidade" />
        <KpiCard label="Execucoes hoje" value={totals.executionsToday} help="operacao observada" />
        <KpiCard label="Taxa de sucesso" value={`${totals.successRate}%`} help="execucao validada" />
        <KpiCard label="Falhas criticas" value={totals.criticalFailures} help="precisam de acao" />
      </section>

      <section className="wm-grid-2">
        <div className="wm-panel">
          <div className="wm-panel-header">
            <h2>Projetos ativos</h2>
            <span>{projects.length} visiveis</span>
          </div>
          <div className="wm-card-grid">
            {projects.slice(0, 3).map((project) => (
              <ProjectCard key={project.id} project={project} onOpen={onOpenProject} />
            ))}
          </div>
        </div>

        <div className="wm-panel">
          <div className="wm-panel-header">
            <h2>Alertas</h2>
            <span>{alerts.length}</span>
          </div>
          <div className="wm-stack-md">
            {alerts.length ? alerts.map((alert) => (
              <article key={alert.id} className="wm-alert-card">
                <div className="wm-split-row">
                  <strong>{alert.title}</strong>
                  <StatusBadge status={alert.status} />
                </div>
                <p>{alert.detail}</p>
              </article>
            )) : <div className="wm-empty-state">Nenhum alerta relevante.</div>}
          </div>
        </div>
      </section>

      <section className="wm-grid-2">
        <div className="wm-panel">
          <div className="wm-panel-header">
            <h2>Atividade recente</h2>
            <span>timeline operacional</span>
          </div>
          <ActivityTimeline items={activity.slice(0, 6)} />
        </div>

        <AiSuggestionsPanel suggestions={aiSuggestions.slice(0, 4)} compact />
      </section>
    </div>
  );
}

export default OverviewDashboard;