import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../styles/Button';

function StepStatusBadge({ value }) {
  const normalized = String(value || '').toLowerCase();
  const labels = {
    passed: 'aprovado',
    success: 'aprovado',
    failed: 'falhou',
    failure: 'falhou',
    error: 'erro',
    timeout: 'timeout',
  };
  const palette = {
    passed: 'border border-status-success/20 bg-status-success/10 text-status-success',
    success: 'border border-status-success/20 bg-status-success/10 text-status-success',
    failed: 'border border-status-error/20 bg-status-error/10 text-status-error',
    failure: 'border border-status-error/20 bg-status-error/10 text-status-error',
    error: 'border border-status-error/20 bg-status-error/10 text-status-error',
    timeout: 'border border-status-warning/20 bg-status-warning/10 text-status-warning',
  };
  const fallback = 'border border-border-default bg-text-secondary/10 text-text-secondary';
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${palette[normalized] || fallback}`}>
      {labels[normalized] || 'n/d'}
    </span>
  );
}

/**
 * Player de replay reutilizável e consistente.
 *
 * Consome passos normalizados (ver `replayNormalizer.js`) e oferece navegação
 * passo a passo, reprodução automática, filtro de erros, screenshots antes/depois
 * e entradas digitadas. Visual alinhado aos tokens semânticos da plataforma.
 *
 * @param {{ steps?: Array, typedEntries?: Array, assertions?: string[],
 *   title?: string, emptyMessage?: string }} props
 */
export function ReplayPlayer({
  steps = [],
  typedEntries = [],
  assertions = [],
  title = null,
  emptyMessage = 'Sem passos reproduzíveis para este replay.',
  evidence = null,
  onStepChange = null,
  focusStepAt = null,
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);
  const [onlyErrors, setOnlyErrors] = useState(false);

  const visibleSteps = useMemo(
    () => (onlyErrors ? steps.filter((step) => step.isError) : steps),
    [steps, onlyErrors],
  );
  const total = visibleSteps.length;
  const active = visibleSteps[currentIndex] || null;

  useEffect(() => {
    if (currentIndex >= total) setCurrentIndex(Math.max(0, total - 1));
  }, [total, currentIndex]);

  const onStepChangeRef = useRef(onStepChange);
  useEffect(() => {
    onStepChangeRef.current = onStepChange;
  });

  useEffect(() => {
    if (onStepChangeRef.current && active) onStepChangeRef.current(currentIndex, active);
  }, [currentIndex, active]);

  useEffect(() => {
    if (!focusStepAt) return;
    const index = steps.findIndex((step) => step.at === focusStepAt);
    if (index >= 0) {
      setOnlyErrors(false);
      setCurrentIndex(index);
    }
  }, [focusStepAt, steps]);

  useEffect(() => {
    if (!isPlaying || total === 0) return undefined;
    const id = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= total - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, speed);
    return () => clearInterval(id);
  }, [isPlaying, total, speed]);

  const goFirst = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };
  const goPrevious = () => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };
  const goNext = () => {
    setCurrentIndex((prev) => Math.min(total - 1, prev + 1));
  };
  const goLast = () => {
    setIsPlaying(false);
    setCurrentIndex(total - 1);
  };
  const togglePlay = () => {
    if (currentIndex >= total - 1) setCurrentIndex(0);
    setIsPlaying((prev) => !prev);
  };
  const jumpToError = () => {
    setIsPlaying(false);
    setOnlyErrors(false);
    const index = steps.findIndex((step) => step.isError);
    if (index >= 0) setCurrentIndex(index);
  };

  const hasScreenshot = Boolean(
    active?.screenshotBefore || active?.screenshotAfter || active?.screenshot,
  );

  return (
    <div className="space-y-3">
      {title ? <div className="text-sm font-semibold text-text-primary">{title}</div> : null}

      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default bg-bg-primary p-4 text-sm text-text-secondary">
          {emptyMessage}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border-default bg-bg-primary p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button variant="default" size="sm" onClick={goFirst} disabled={currentIndex <= 0}>⏮️ Primeiro</Button>
                <Button variant="default" size="sm" onClick={goPrevious} disabled={currentIndex <= 0}>⏪ Anterior</Button>
              </div>
              <div className="mx-4 flex-1">
                <div className="mb-1 text-center text-xs text-text-secondary">
                  Passo {total === 0 ? 0 : currentIndex + 1} de {total}
                </div>
                <div className="h-2 w-full rounded-full bg-bg-secondary">
                  <div
                    className="h-2 rounded-full bg-accent-primary transition-all"
                    style={{ width: `${total === 0 ? 0 : ((currentIndex + 1) / total) * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="default" size="sm" onClick={goNext} disabled={currentIndex >= total - 1}>Próximo ⏩</Button>
                <Button variant="default" size="sm" onClick={goLast} disabled={currentIndex >= total - 1}>Último ⏭️</Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border-default pt-2">
              <div className="flex items-center gap-2">
                <Button variant={isPlaying ? 'danger' : 'default'} size="sm" onClick={togglePlay}>
                  {isPlaying ? '⏸️ Pausar' : '▶️ Reproduzir'}
                </Button>
                <span className="text-xs text-text-tertiary">{isPlaying ? 'Reproduzindo...' : 'Pausado'}</span>
                <Button variant="default" size="sm" onClick={jumpToError}>⛳ Ir para erro</Button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-text-secondary">
                  <input
                    type="checkbox"
                    checked={onlyErrors}
                    onChange={(event) => setOnlyErrors(event.target.checked)}
                  />
                  Mostrar apenas falhas
                </label>
                <label className="text-xs text-text-secondary">Velocidade:</label>
                <select
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
                  disabled={isPlaying}
                  className="rounded border border-border-default bg-bg-secondary px-2 py-1 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value={5000}>🐌 Muito Lento (5s)</option>
                  <option value={2000}>🐢 Lento (2s)</option>
                  <option value={1000}>🚶 Normal (1s)</option>
                  <option value={500}>🏃 Rápido (0.5s)</option>
                  <option value={200}>⚡ Muito Rápido (0.2s)</option>
                  <option value={100}>🚀 Máxima (0.1s)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium text-text-primary">{active.title}</div>
              <StepStatusBadge value={active.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
              {active.at ? (
                <span>{new Date(active.at).toLocaleString('pt-BR')}</span>
              ) : (
                <span>Sem timestamp</span>
              )}
              {active.category ? (
                <span className="rounded-full border border-border-default bg-text-secondary/10 px-2 py-0.5">{active.category}</span>
              ) : null}
              {active.actor ? <span>ator: {active.actor}</span> : null}
            </div>
            {active.description ? (
              <div className="mt-2 break-words text-sm text-text-secondary">{active.description}</div>
            ) : null}

            {active.trainingDescription || active.trainingHint || active.expectedVisual ? (
              <div className="mt-3 space-y-1 rounded-md border border-accent-primary/30 bg-accent-primary/10 p-3">
                <div className="text-xs font-semibold text-accent-primary">🎓 Material de treinamento</div>
                {active.trainingDescription ? (
                  <div className="text-xs leading-relaxed text-text-primary">{active.trainingDescription}</div>
                ) : null}
                {active.trainingHint ? (
                  <div className="text-xs leading-relaxed text-status-warning">💡 {active.trainingHint}</div>
                ) : null}
                {active.expectedVisual ? (
                  <div className="text-xs leading-relaxed text-text-secondary">👁️ {active.expectedVisual}</div>
                ) : null}
              </div>
            ) : null}

            {hasScreenshot ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {active.screenshotBefore || active.screenshot ? (
                  <figure>
                    <img
                      src={active.screenshotBefore || active.screenshot}
                      alt={active.screenshotBefore ? "Antes" : "Tela"}
                      className="w-full rounded border border-border-default"
                    />
                    <figcaption className="mt-1 text-xs text-text-secondary">
                      {active.screenshotBefore ? "Antes" : "Tela"}
                    </figcaption>
                  </figure>
                ) : null}
                {active.screenshotAfter ? (
                  <figure>
                    <img
                      src={active.screenshotAfter}
                      alt="Depois"
                      className="w-full rounded border border-border-default"
                    />
                    <figcaption className="mt-1 text-xs text-text-secondary">Depois</figcaption>
                  </figure>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}

      {assertions.length > 0 ? (
        <div className="rounded-lg border border-border-default bg-bg-primary p-3">
          <div className="text-xs font-semibold uppercase text-text-secondary">Assertivas</div>
          <ul className="mt-2 space-y-1 text-sm text-text-primary">
            {assertions.map((assertion, index) => (
              <li key={`${index}-${assertion}`} className="flex gap-2">
                <span className="text-status-success">✓</span>
                <span>{assertion}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {typedEntries.length > 0 ? (
        <div className="rounded-lg border border-border-default bg-bg-primary p-3">
          <div className="text-xs font-semibold uppercase text-text-secondary">Entradas digitadas</div>
          <ul className="mt-2 space-y-1 text-sm text-text-primary">
            {typedEntries.map((entry) => (
              <li key={entry.id} className="flex gap-2">
                <span className="text-text-secondary">{entry.field}:</span>
                <span className="break-all">{entry.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {evidence ? (
        <div className="space-y-3">
          {evidence.timeline?.length > 0 ? (
            <div className="rounded-lg border border-border-default bg-bg-primary p-3">
              <div className="text-xs font-semibold uppercase text-text-secondary">Timeline operacional</div>
              <div className="mt-2 space-y-2">
                {evidence.timeline.map((item) => {
                  const status = String(item.status || 'N/A').toUpperCase();
                  const go = ['GO', 'CAPTURED', 'SUCCESS'].includes(status);
                  return (
                    <div key={item.id || item.label} className="rounded border border-border-default bg-bg-secondary p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-semibold text-text-primary">{item.label || item.type}</div>
                        <span className={`rounded px-2 py-0.5 font-semibold ${go ? 'bg-status-success/10 text-status-success' : 'bg-status-error/10 text-status-error'}`}>
                          {status}
                        </span>
                      </div>
                      {item.state != null ? (
                        <div className="mt-1 text-text-secondary">Estado: <span className="font-mono">{typeof item.state === 'string' ? item.state : JSON.stringify(item.state)}</span></div>
                      ) : null}
                      {item.action ? <div className="mt-1 text-text-secondary">Ação: <span className="font-mono">{item.action}</span></div> : null}
                      {item.from || item.to ? (
                        <div className="mt-1 text-text-secondary">{item.from || 'n/a'} → {item.to || 'n/a'}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {evidence.sideEffects && (evidence.sideEffects.required.length > 0 || evidence.sideEffects.observed.length > 0) ? (
            <div className="rounded-lg border border-border-default bg-bg-primary p-3">
              <div className="text-xs font-semibold uppercase text-text-secondary">Side effects</div>
              <div className="mt-2 text-xs text-text-secondary">Obrigatórios: {evidence.sideEffects.required.join(', ') || 'n/a'}</div>
              <div className="mt-1 text-xs text-text-secondary">Observados: {evidence.sideEffects.observed.join(', ') || 'n/a'}</div>
              {evidence.sideEffects.missing.length > 0 ? (
                <div className="mt-1 text-xs text-status-error">Ausentes: {evidence.sideEffects.missing.join(', ')}</div>
              ) : (
                <div className="mt-1 text-xs text-status-success">Todos os side effects obrigatórios foram comprovados.</div>
              )}
            </div>
          ) : null}

          {evidence.mutationDiff.length > 0 ? (
            <div className="rounded-lg border border-border-default bg-bg-primary p-3">
              <div className="text-xs font-semibold uppercase text-text-secondary">Mutações ({evidence.mutationDiff.length})</div>
              <div className="mt-2 max-h-56 space-y-1 overflow-auto">
                {evidence.mutationDiff.map((entry) => (
                  <div key={entry.path} className="rounded border border-border-default bg-bg-secondary px-2 py-1">
                    <div className="font-mono text-text-primary">{entry.path}</div>
                    <div className="text-text-tertiary">antes: {JSON.stringify(entry.before)}</div>
                    <div className="text-text-tertiary">depois: {JSON.stringify(entry.after)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {evidence.snapshots && (evidence.snapshots.before || evidence.snapshots.after) ? (
            <div className="rounded-lg border border-border-default bg-bg-primary p-3">
              <div className="text-xs font-semibold uppercase text-text-secondary">Snapshots</div>
              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                <div className="rounded border border-border-default bg-bg-secondary p-2">
                  <div className="text-xs font-semibold text-text-secondary">Antes</div>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-text-tertiary">{JSON.stringify(evidence.snapshots.before, null, 2)}</pre>
                </div>
                <div className="rounded border border-border-default bg-bg-secondary p-2">
                  <div className="text-xs font-semibold text-text-secondary">Depois</div>
                  <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-text-tertiary">{JSON.stringify(evidence.snapshots.after, null, 2)}</pre>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default ReplayPlayer;
