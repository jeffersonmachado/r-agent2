import React from 'react';
import { PlaybookStepItem } from './PlaybookStepItem';

function progressSummary(execution) {
  const steps = Array.isArray(execution?.steps) ? execution.steps : [];
  const done = steps.filter((step) => String(step?.status || '').toLowerCase() === 'completed').length;
  return `${done}/${steps.length}`;
}

export function PlaybookExecutionModal({
  open = false,
  playbook = null,
  execution = null,
  loading = false,
  error = '',
  onClose = null,
  onExecuteStep = null,
  onExecuteNext = null,
}) {
  if (!open) return null;

  const steps = Array.isArray(execution?.steps) ? execution.steps : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border-default bg-bg-primary shadow-lg">
        <div className="flex items-center justify-between border-b border-border-default px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">{playbook?.name || 'Execução de playbook'}</div>
            <div className="text-xs text-text-secondary">Progresso: {progressSummary(execution)}</div>
          </div>
          <button type="button" className="btn-default px-2 py-1 text-xs" onClick={onClose}>Fechar</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-3 space-y-3">
          {error ? <div className="text-xs text-status-error">{error}</div> : null}
          {execution?.status ? (
            <div className="text-xs text-text-secondary">Status da execução: <strong>{execution.status}</strong></div>
          ) : null}

          {steps.length === 0 ? (
            <div className="text-xs text-text-tertiary">Nenhum passo disponível para este playbook.</div>
          ) : (
            steps.map((step) => (
              <PlaybookStepItem
                key={step.id}
                step={step}
                disabled={loading || String(execution?.status || '') !== 'in_progress'}
                onExecute={onExecuteStep ? () => onExecuteStep(step) : null}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-default px-4 py-3">
          <button
            type="button"
            className="btn-default px-3 py-1.5 text-xs"
            onClick={onExecuteNext}
            disabled={loading || String(execution?.status || '') !== 'in_progress'}
          >
            Executar próximo
          </button>
        </div>
      </div>
    </div>
  );
}
