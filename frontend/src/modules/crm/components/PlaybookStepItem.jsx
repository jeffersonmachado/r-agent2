import React from 'react';

function statusLabel(status) {
  const value = String(status || 'pending').toLowerCase();
  if (value === 'completed') return 'Concluído';
  if (value === 'running') return 'Executando';
  if (value === 'failed') return 'Falhou';
  return 'Pendente';
}

export function PlaybookStepItem({ step, onExecute = null, disabled = false }) {
  const status = String(step?.status || 'pending').toLowerCase();
  return (
    <div className="rounded-lg border border-border-default p-3 bg-bg-elevated">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-text-primary">{step?.title || step?.id || 'Step'}</div>
        <span className="text-xs text-text-secondary">{statusLabel(status)}</span>
      </div>
      {step?.description ? (
        <div className="mt-1 text-xs text-text-secondary">{step.description}</div>
      ) : null}
      {step?.error ? (
        <div className="mt-1 text-xs text-status-error">{step.error}</div>
      ) : null}
      {onExecute ? (
        <div className="mt-2">
          <button
            type="button"
            className="btn-default px-2 py-1 text-xs"
            onClick={onExecute}
            disabled={disabled || status === 'completed' || status === 'running'}
          >
            Executar passo
          </button>
        </div>
      ) : null}
    </div>
  );
}
