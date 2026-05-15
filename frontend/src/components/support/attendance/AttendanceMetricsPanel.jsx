import React from 'react';

function MetricCard({ title, data }) {
  return (
    <section className="attendance-metric-card">
      <h3>{title}</h3>
      <div className="attendance-metric-list">
        {Object.entries(data || {}).map(([label, value]) => (
          <div className="attendance-metric-row" key={`${title}-${label}`}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AttendanceMetricsPanel({ metrics }) {
  return (
    <div className="attendance-metrics-panel">
      <MetricCard title="Caixa de entrada" data={metrics?.inbox} />
      <MetricCard title="Status" data={metrics?.status} />
      <MetricCard title="Categorias" data={metrics?.categories} />
    </div>
  );
}
