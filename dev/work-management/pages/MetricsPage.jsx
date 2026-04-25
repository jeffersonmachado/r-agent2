import React from 'react';

function MetricCard({ label, value, helper }) {
  return (
    <article className="wm-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{helper}</small>
    </article>
  );
}

export function MetricsPage({ model }) {
  const metrics = model.metrics;

  return (
    <div className="wm-stack-lg">
      <section className="wm-kpi-grid">
        <MetricCard label="Lead time" value={`${metrics.leadTime}d`} helper="media do modulo" />
        <MetricCard label="Cycle time" value={`${metrics.cycleTime}d`} helper="execucao ao done" />
        <MetricCard label="Throughput" value={metrics.throughput} helper="itens concluidos" />
        <MetricCard label="Completion rate" value={`${metrics.completionRate}%`} helper="taxa de entrega" />
        <MetricCard label="Reopen rate" value={`${metrics.reopenRate}%`} helper="retorno por bloqueio" />
        <MetricCard label="Validation pass rate" value={`${metrics.validationPassRate}%`} helper="cenarios aprovados" />
        <MetricCard label="Operational health" value={`${metrics.operationalHealth}%`} helper="uptime agregado" />
        <MetricCard label="Incident recurrence" value={metrics.incidentRecurrence} helper="repeticao de falhas" />
        <MetricCard label="SLA de entrega" value={`${metrics.slaEntrega}%`} helper="janela de entrega" />
      </section>

      <section className="wm-panel">
        <div className="wm-panel-header">
          <h2>Metric notes</h2>
          <span>pronto para backend real</span>
        </div>
        <div className="wm-stack-sm">
          <p>Lead time e cycle time estao modelados como metricas de fluxo.</p>
          <p>Validation pass rate e incident recurrence conectam QA e observabilidade operacional.</p>
          <p>Operational health e SLA de entrega podem ser recalculados por tenant, ambiente ou portfolio no backend real.</p>
        </div>
      </section>
    </div>
  );
}

export default MetricsPage;