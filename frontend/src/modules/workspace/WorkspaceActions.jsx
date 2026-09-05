import React from 'react';

const RISK_LABELS = { low: 'Risco baixo', medium: 'Risco médio', high: 'Risco alto' };
const RISK_TONES = { low: 'healthy', medium: 'warning', high: 'critical' };

export function confidencePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return numeric <= 1 ? Math.round(numeric * 100) : Math.round(numeric);
}

export function SuggestionMeta({ suggestion }) {
  const confidence = confidencePercent(suggestion?.confidence);
  const riskLabel = RISK_LABELS[suggestion?.risk];
  const riskTone = RISK_TONES[suggestion?.risk] || 'subtle';
  return (
    <>
      {riskLabel ? <span className={`workspace-pill ${riskTone}`}>{riskLabel}</span> : null}
      {confidence !== null ? <span className="workspace-pill subtle">{confidence}% confiança</span> : null}
    </>
  );
}

export function SuggestionExpectedOutcome({ suggestion }) {
  if (!suggestion?.expectedOutcome) return null;
  return <p className="workspace-muted text-sm mt-1">Resultado esperado: {suggestion.expectedOutcome}</p>;
}

export function WorkspaceActions({ actions, loading, onCreateSuggested, onExecuteSuggestion }) {
  const items = actions?.items || [];
  const suggestion = actions?.suggestion;
  const executeDisabled = suggestion?.action?.kind === 'send_message' && !suggestion?.action?.conversationId;

  return (
    <section className="workspace-card workspace-scroll">
      <h2 className="text-xl font-semibold">Ações inteligentes</h2>
      <p className="workspace-muted text-sm mb-4">Tarefas, follow-ups, notificações e automações sugeridas.</p>

      {suggestion ? (
        <div className="workspace-highlight-card mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="workspace-pill">{suggestion.type}</span>
            <SuggestionMeta suggestion={suggestion} />
          </div>
          <h3 className="text-lg font-semibold mt-2">{suggestion.label}</h3>
          <p className="workspace-muted text-sm mt-1">{suggestion.reason}</p>
          <SuggestionExpectedOutcome suggestion={suggestion} />
          <div className="flex gap-2 mt-3 flex-wrap">
            <button
              className="workspace-action-button"
              type="button"
              disabled={executeDisabled}
              title={executeDisabled ? 'Sem conversa vinculada' : undefined}
              onClick={() => onExecuteSuggestion(suggestion)}
            >
              {suggestion.action?.label || 'Executar ação sugerida'}
            </button>
            <button className="workspace-secondary-button" type="button" onClick={() => onCreateSuggested(suggestion)}>
              Criar ação sugerida
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <div className="workspace-skeleton-stack"><div className="workspace-skeleton h-16"></div><div className="workspace-skeleton h-16"></div></div> : null}
      {!loading && items.length === 0 ? <p className="workspace-muted">Nenhuma ação persistida ainda.</p> : null}
      {items.map((action) => (
        <article key={action.id} className="workspace-mini-card">
          <div className="flex items-center justify-between gap-3">
            <span className="workspace-pill">{action.type}</span>
            <span className="workspace-muted text-xs">{action.status}</span>
          </div>
          <p className="mt-2">{action.payload?.title || action.payload?.label || 'Ação do Workspace'}</p>
        </article>
      ))}
    </section>
  );
}
