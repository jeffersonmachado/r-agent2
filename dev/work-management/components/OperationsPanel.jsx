import React from 'react';
import ActivityTimeline from './ActivityTimeline.jsx';
import ExecutionTable from './ExecutionTable.jsx';
import StatusBadge from './StatusBadge.jsx';
import WaveCard from './WaveCard.jsx';

function Kpi({ label, value, helper }) {
  return (
    <article className="wm-kpi-card is-compact">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function OperationsPanel({ healthDomains = [], waves = [], executions = [], itemsById = {}, activity = [], alerts = [], onOpenExecution }) {
  const passed = executions.filter((execution) => execution.status === 'passed').length;
  const successRate = executions.length ? Math.round((passed / executions.length) * 100) : 0;
  const latency = executions.length ? Math.round(executions.reduce((sum, execution) => sum + execution.duration, 0) / executions.length / 1000) : 0;
  const failures = executions.filter((execution) => execution.status === 'failed').length;

  return (
    <div className="wm-stack-lg">
      <section className="wm-kpi-grid">
        <Kpi label="Execucoes" value={executions.length} helper="janela filtrada" />
        <Kpi label="Taxa de sucesso" value={`${successRate}%`} helper="pass rate" />
        <Kpi label="Latencia media" value={`${latency}s`} helper="duracao media" />
        <Kpi label="Falhas" value={failures} helper="critical + warning" />
      </section>

      <section className="wm-grid-2 is-wide-left">
        <div className="wm-panel">
          <div className="wm-panel-header">
            <h2>Health por dominio</h2>
            <span>Autonomous Operations Panel</span>
          </div>
          <div className="wm-domain-grid">
            {healthDomains.map((domain) => (
              <article key={domain.id} className="wm-domain-card">
                <div className="wm-split-row">
                  <strong>{domain.name}</strong>
                  <StatusBadge status={domain.status} />
                </div>
                <div className="wm-inline-meta">
                  <span>{domain.latencyMs} ms</span>
                  <span>{domain.availability}% uptime</span>
                  <span>{domain.incidents} incidents</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="wm-panel">
          <div className="wm-panel-header">
            <h2>Alertas</h2>
            <span>{alerts.length}</span>
          </div>
          <div className="wm-stack-sm">
            {alerts.length ? alerts.map((alert) => (
              <article key={alert.id} className="wm-alert-card">
                <div className="wm-split-row">
                  <strong>{alert.title}</strong>
                  <StatusBadge status={alert.status} />
                </div>
                <p>{alert.detail}</p>
              </article>
            )) : <div className="wm-empty-state">Sem sinais de degradacao relevantes.</div>}
          </div>
        </div>
      </section>

      <section className="wm-grid-2">
        <div className="wm-panel">
          <div className="wm-panel-header">
            <h2>Waves</h2>
            <span>{waves.length}</span>
          </div>
          <div className="wm-card-grid">
            {waves.map((wave) => <WaveCard key={wave.id} wave={wave} />)}
          </div>
        </div>

        <div className="wm-panel">
          <div className="wm-panel-header">
            <h2>Activity timeline</h2>
            <span>execucao, falha e replay</span>
          </div>
          <ActivityTimeline items={activity.slice(0, 6)} />
        </div>
      </section>

      <section className="wm-panel">
        <div className="wm-panel-header">
          <h2>Execucoes observadas</h2>
          <span>{executions.length}</span>
        </div>
        <ExecutionTable executions={executions} itemsById={itemsById} onOpenExecution={onOpenExecution} />
      </section>
    </div>
  );
}

export default OperationsPanel;