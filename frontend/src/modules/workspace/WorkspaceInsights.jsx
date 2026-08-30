import React from 'react';

export function WorkspaceInsights({ insights, loading }) {
  const generated = insights?.items || [];
  const persisted = insights?.persisted || [];
  const items = [...generated, ...persisted];

  return (
    <section className="workspace-card workspace-scroll">
      <h2 className="text-xl font-semibold">Insights IA</h2>
      <p className="workspace-muted text-sm mb-4">Riscos, oportunidades, atraso, churn, upsell e sinais de instabilidade operacional.</p>
      {loading ? <div className="workspace-skeleton-stack"><div className="workspace-skeleton h-16"></div><div className="workspace-skeleton h-16"></div></div> : null}
      {!loading && items.length === 0 ? <p className="workspace-muted">Sem insights críticos no momento.</p> : null}
      {items.map((insight, index) => (
        <article key={`${insight.type}-${index}`} className="workspace-mini-card">
          <div className="flex items-center justify-between gap-3">
            <span className={`workspace-pill ${insight.severity === 'critical' ? 'critical' : insight.type === 'delay' ? 'warning' : 'subtle'}`}>{insight.type}</span>
            <span className="workspace-muted text-xs">{Math.round((insight.confidence || 0) * 100)}% · {insight.source}</span>
          </div>
          <p className="mt-2">{insight.description}</p>
        </article>
      ))}
    </section>
  );
}
