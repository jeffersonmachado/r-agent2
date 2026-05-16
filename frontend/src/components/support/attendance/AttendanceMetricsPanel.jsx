import React, { useState } from 'react';

function MetricCard({ title, data }) {
  return (
    <section className="attendance-metric-card">
      <h3>{title}</h3>
      <div className="attendance-metric-list">
        {Object.entries(data || {}).map(([label, value]) => (
          <div
            className={`attendance-metric-row${Number(value) === 0 ? ' attendance-metric-row--zero' : ''}`}
            key={`${title}-${label}`}
          >
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

export function AttendanceMetricsPanel({ metrics }) {
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 900
  );

  return (
    <div className="attendance-metrics-panel">
      <button
        type="button"
        className="attendance-metrics-toggle"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expandir métricas' : 'Recolher métricas'}
      >
        Métricas {collapsed ? '+' : '−'}
      </button>
      {!collapsed ? (
        <>
          <MetricCard title="Caixa de entrada" data={metrics?.inbox} />
          <MetricCard title="Status" data={metrics?.status} />
          <MetricCard title="Categorias" data={metrics?.categories} />
        </>
      ) : null}
    </div>
  );
}
