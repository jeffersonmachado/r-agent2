import React from 'react';

function formatDateTime(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('pt-BR');
}

function statusTone(status) {
  return String(status || '').toLowerCase() === 'success'
    ? 'bg-status-success/15 text-status-success border-status-success/30'
    : 'bg-status-error/15 text-status-error border-status-error/30';
}

export function OutcomeList({
  title = 'Outcomes recentes',
  subtitle = '',
  items = [],
  loading = false,
  error = '',
}) {
  return (
    <section className="rounded-2xl border border-border-default bg-bg-elevated p-5">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        {subtitle ? <p className="mt-1 text-sm text-text-secondary">{subtitle}</p> : null}
      </div>

      {loading ? <div className="text-sm text-text-secondary">Carregando outcomes...</div> : null}
      {!loading && error ? <div className="text-sm text-status-error">{error}</div> : null}
      {!loading && !error && items.length === 0 ? (
        <div className="text-sm text-text-secondary">Nenhum outcome encontrado para os filtros atuais.</div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => (
            <article key={item.id} className="rounded-xl border border-border-subtle bg-bg-secondary/50 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">{item.outcome_type || item.outcomeType || 'outcome'}</div>
                  <div className="mt-1 text-xs text-text-secondary">
                    signal: {item.signal_id || '—'} · recommendation: {item.recommendation_id || '—'} · action: {item.action_type || item.action_id || '—'}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    playbook: {item.playbook_execution_id || '—'} · fonte: {item.source_type || '—'} / {item.source_id || '—'}
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    resultado: {item.result_context_json?.result?.kind || item.result_context_json?.result?.message || item.result_context_json?.error || '—'}
                  </div>
                </div>
                <div className="text-right">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${statusTone(item.status)}`}>
                    {item.status || 'unknown'}
                  </span>
                  <div className="mt-2 text-xs text-text-secondary">{formatDateTime(item.produced_at || item.producedAt)}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
