import React from 'react';
import { Button } from '../styles/Button';
import { AutoInitialGraphCanvas } from './AutoInitialGraphCanvas';

export function InitialFlowPreviewContent({
  initialFlow,
  isDryRunId,
  warningCount,
  hasWarnings,
  showObjectiveEditor,
  initialFlowObjectiveDraft,
  onObjectiveDraftChange,
  onCopyObjective,
  onCloseObjectiveEditor,
  flowId,
  editorUrl,
  isPersistingInitialFlow,
  onPersistFlow,
  contentHeight,
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-info/10 border border-status-info/30 text-status-info">
          IA
        </span>
        {isDryRunId && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-warning/10 border border-status-warning/30 text-status-warning">
            dry-run
          </span>
        )}
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary border border-border-default text-text-tertiary">
          nos: <strong className="text-text-secondary">{Array.isArray(initialFlow?.nodes) ? initialFlow.nodes.length : 0}</strong>
        </span>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-bg-secondary border border-border-default text-text-tertiary">
          arestas: <strong className="text-text-secondary">{Array.isArray(initialFlow?.edges) ? initialFlow.edges.length : 0}</strong>
        </span>
        {hasWarnings && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-status-warning/10 border border-status-warning/30 text-status-warning">
            avisos: <strong>{warningCount}</strong>
          </span>
        )}
      </div>

      {showObjectiveEditor && (
        <div className="rounded-lg border border-border-default bg-bg-secondary p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-text-tertiary uppercase tracking-wider font-medium">
              Objetivo do fluxo (o que ele vai atender)
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="xs"
                onClick={onCopyObjective}
                disabled={!String(initialFlowObjectiveDraft || '').trim()}
                title="Copiar objetivo"
              >
                Copiar
              </Button>
              <Button
                variant="ghost"
                size="xs"
                onClick={onCloseObjectiveEditor}
                title="Fechar"
              >
                Fechar
              </Button>
            </div>
          </div>
          <textarea
            value={initialFlowObjectiveDraft}
            onChange={(e) => onObjectiveDraftChange(e.target.value)}
            placeholder="Descreva o objetivo/escopo do atendimento deste fluxo..."
            className="w-full p-3 border border-border-default rounded-md bg-bg-primary text-text-primary placeholder-text-tertiary resize-none focus:outline-none focus:ring-2 focus:ring-accent-default focus:border-transparent"
            rows={5}
          />
          <div className="text-xs text-text-tertiary">
            Dica: escreva em 2-5 frases (servicos atendidos, publico-alvo, regras e o que nao deve atender).
          </div>
        </div>
      )}

      {hasWarnings ? (
        <div className="p-3 rounded-md bg-status-warning/10 border border-status-warning/20 text-status-warning text-sm">
          <strong>Avisos de validacao:</strong> {warningCount} item(ns).
        </div>
      ) : null}

      {flowId ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-bg-secondary px-3 py-2">
          <div className="text-sm text-text-secondary">
            Fluxo persistido. Abrindo editor embutido no modal.
          </div>
          {editorUrl ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                try {
                  window.open(editorUrl, '_blank', 'noopener,noreferrer');
                } catch {
                  // best-effort
                }
              }}
              title="Abrir o editor em uma nova aba"
            >
              Abrir em nova aba
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 bg-status-warning/10 border border-status-warning/30 rounded-lg p-3 text-sm">
          <div className="text-text-secondary">
            Este fluxo inicial nao esta persistido (normal em <strong>dry-run</strong>). Para abrir no editor completo, e preciso <strong>persistir</strong> o fluxo.
          </div>
          <Button
            variant="default"
            size="sm"
            type="button"
            disabled={isPersistingInitialFlow}
            onClick={onPersistFlow}
            title="Persistir o fluxo e abrir no editor"
          >
            {isPersistingInitialFlow ? 'Persistindo...' : 'Persistir e abrir'}
          </Button>
        </div>
      )}

      <div
        className="w-full overflow-hidden rounded-lg border border-border-default bg-bg-primary"
        style={{ height: contentHeight }}
      >
        {flowId ? (
          <iframe
            title="Editor de Fluxos"
            src={editorUrl}
            className="w-full h-full"
            style={{ border: 0 }}
          />
        ) : (
          <AutoInitialGraphCanvas
            flow={initialFlow}
            height="100%"
          />
        )}
      </div>
    </div>
  );
}
