import React from 'react';

export function WorkspaceInsights({ insights, loading }) {
  const generated = insights?.items || [];
  const persisted = insights?.persisted || [];
  const items = [...generated, ...persisted];

  return (
    <section className="workspace-card workspace-scroll">
      <h2 className="text-xl font-semibold">Insights IA</h2>
      <p className="workspace-muted text-sm mb-4">Riscos, oportunidades, atraso, churn, upsell e sinais QA/RPA.</p>
      {loading ? <p className="workspace-muted">Gerando insights...</p> : null}
      {!loading && items.length === 0 ? <p className="workspace-muted">Sem insights críticos no momento.</p> : null}
      {items.map((insight, index) => (
        <article key={`${insight.type}-${index}`} className="mb-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="workspace-pill">{insight.type}</span>
            <span className="workspace-muted text-xs">{Math.round((insight.confidence || 0) * 100)}% · {insight.source}</span>
          </div>
          <p className="mt-2">{insight.description}</p>
        </article>
      ))}
    </section>
  );
}
