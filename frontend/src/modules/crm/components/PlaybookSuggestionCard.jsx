import React from 'react';

function signalLabel(item) {
  return item?.signal?.type || item?.recommendation?.source_signal_type || item?.playbook?.triggerSignal || 'signal';
}

export function PlaybookSuggestionCard({
  title = 'Playbooks sugeridos',
  subtitle = '',
  enabled = true,
  suggestions = [],
  loading = false,
  error = '',
  onExecute = null,
  emptyMessage = 'Nenhum playbook sugerido para o contexto atual.',
}) {
  const items = Array.isArray(suggestions) ? suggestions : [];

  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
      <div className="text-sm font-semibold text-text-primary">{title}</div>
      <div className="mt-1 text-xs text-text-tertiary">
        {subtitle || 'Playbooks orientados por sinais e recomendações operacionais.'}
      </div>

      {!enabled ? (
        <div className="mt-3 text-xs text-text-tertiary">Recurso desabilitado para este contexto.</div>
      ) : loading ? (
        <div className="mt-3 text-xs text-text-tertiary">Carregando playbooks sugeridos...</div>
      ) : error ? (
        <div className="mt-3 text-xs text-status-error">Falha ao carregar playbooks sugeridos.</div>
      ) : items.length === 0 ? (
        <div className="mt-3 text-xs text-text-tertiary">{emptyMessage}</div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {items.slice(0, 8).map((item, index) => (
            <div key={item?.id || item?.playbook?.id || `${index}`} className="rounded-lg border border-border-default p-3 bg-bg-primary">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-text-primary">{item?.playbook?.name || item?.playbook?.id || 'Playbook'}</div>
                  <div className="text-xs text-text-secondary">Sinal: {signalLabel(item)}</div>
                </div>
                {onExecute ? (
                  <button type="button" className="btn-default px-2 py-1 text-xs" onClick={() => onExecute(item)}>
                    Executar Playbook
                  </button>
                ) : null}
              </div>
              {item?.playbook?.description ? (
                <div className="mt-1 text-xs text-text-tertiary">{item.playbook.description}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
