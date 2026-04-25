import React, { useState, useEffect, useCallback } from 'react';
import { Dialog } from '../Dialog';
import { Button } from '../../styles/Button';
import StatusBadge from './StatusBadge';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('pt-BR');
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export function ReplayDetailsModal({ details, onClose }) {
  const [stepByStep, setStepByStep] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1000);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);

  const steps = details?.steps || [];
  const totalSteps = steps.length;
  const screenshotSteps = steps.filter((step) => step?.screenshot || step?.screenshotDataUrl);

  // Atalho F11
  useEffect(() => {
    if (!details) return;
    const handler = (e) => {
      if (e.key === 'F11') { e.preventDefault(); setIsFullscreen((v) => !v); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [details]);

  // Auto-play
  useEffect(() => {
    if (!isPlaying || !stepByStep || totalSteps === 0) return;
    const interval = setInterval(() => {
      setCurrentStep((prev) => {
        if (prev >= totalSteps - 1) { setIsPlaying(false); return prev; }
        return prev + 1;
      });
    }, playbackSpeed);
    return () => clearInterval(interval);
  }, [isPlaying, stepByStep, totalSteps, playbackSpeed]);

  // Scroll automático
  useEffect(() => {
    if (!stepByStep) return;
    const el = document.getElementById(`qa-step-${currentStep}`);
    const container = document.getElementById('qa-log-container');
    if (el && container) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [currentStep, stepByStep]);

  const goToFirst = useCallback(() => { setCurrentStep(0); setIsPlaying(false); }, []);
  const goToPrev = useCallback(() => { setCurrentStep((p) => Math.max(0, p - 1)); setIsPlaying(false); }, []);
  const goToNext = useCallback(() => {
    setCurrentStep((p) => {
      if (p >= totalSteps - 1) { setIsPlaying(false); return p; }
      return p + 1;
    });
  }, [totalSteps]);
  const goToLast = useCallback(() => { setCurrentStep(totalSteps - 1); setIsPlaying(false); }, [totalSteps]);

  if (!details) return null;

  const activeStep = steps[currentStep] || null;
  const activeStepScreenshotSrc = activeStep?.screenshotDataUrl
    || (/^(data:image\/|https?:\/\/)/i.test(String(activeStep?.screenshot || '')) ? activeStep.screenshot : null);
  const screenshotTimelineSteps = steps
    .map((step, idx) => {
      const imageSrc = step?.screenshotDataUrl
        || (/^(data:image\/|https?:\/\/)/i.test(String(step?.screenshot || '')) ? step.screenshot : null);
      if (!imageSrc) return null;
      return {
        idx,
        step,
        imageSrc,
      };
    })
    .filter(Boolean);
  const durationMs = details.durationMs
    || (details.startedAt && details.finishedAt
      ? new Date(details.finishedAt).getTime() - new Date(details.startedAt).getTime()
      : null);

  return (
    <Dialog
      isOpen={!!details}
      onClose={onClose}
      title={
        <div className="flex items-center justify-between w-full pr-8">
          <span>📋 Replay: {details.itemName || details.id}</span>
          <button
            onClick={(e) => { e.stopPropagation(); setIsFullscreen((v) => !v); }}
            className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
            title={isFullscreen ? 'Sair da tela cheia (F11)' : 'Tela cheia (F11)'}
          >
            {isFullscreen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
          </button>
        </div>
      }
      size={isFullscreen ? 'full' : 'xl'}
      draggable={!isFullscreen}
      resizable={!isFullscreen}
      dynamicSize={isFullscreen ? { width: window.innerWidth - 32, isCollapsed: false } : null}
    >
      <div className="flex gap-2 flex-1 min-h-0" style={{ height: isFullscreen ? 'calc(100vh - 6rem)' : 'calc(80vh - 8rem)', minHeight: isFullscreen ? 'calc(100vh - 6rem)' : '500px' }}>

        {/* Painel principal */}
        <div className={`flex-1 flex flex-col min-w-0 transition-all duration-200 ${logCollapsed ? '' : 'mr-2'}`}>
          <div className="space-y-4 overflow-y-auto flex-1">

            {/* Informações do replay */}
            <div className="bg-bg-secondary rounded-lg border border-border-default">
              <div className="flex items-center justify-between p-4 border-b border-border-default">
                <button
                  onClick={() => setInfoCollapsed((v) => !v)}
                  className="flex items-center gap-2 text-sm font-semibold text-text-primary hover:text-accent-primary transition-colors"
                >
                  <span className={`collapse-btn-vertical ${infoCollapsed ? 'collapsed' : ''}`}></span>
                  <span>📋 Informações do Replay</span>
                </button>
                {totalSteps > 0 && (
                  <div className="flex items-center gap-2">
                    {!infoCollapsed && (
                      <span className="text-xs text-text-tertiary">{totalSteps} passo{totalSteps !== 1 ? 's' : ''}</span>
                    )}
                    <Button
                      onClick={() => { setStepByStep((v) => !v); if (!stepByStep) { setCurrentStep(0); setIsPlaying(false); } }}
                      variant="default"
                      size="sm"
                      className="text-xs"
                    >
                      {stepByStep ? '📋 Ver Lista Completa' : '▶️ Play'}
                    </Button>
                  </div>
                )}
              </div>

              {!infoCollapsed && (
                <div className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                    {details.id && (
                      <div>
                        <span className="text-text-tertiary block mb-1">ID do Replay:</span>
                        <p className="text-text-primary font-mono text-xs break-all">{details.id}</p>
                      </div>
                    )}
                    {details.scenarioId && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Cenário:</span>
                        <p className="text-text-primary font-mono text-xs break-all">{details.scenarioId}</p>
                      </div>
                    )}
                    {details.journeyName && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Jornada:</span>
                        <p className="text-text-primary text-xs">{details.journeyName}</p>
                      </div>
                    )}
                    {details.stepName && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Passo:</span>
                        <p className="text-text-primary text-xs">{details.stepName}</p>
                      </div>
                    )}
                    {details.channel && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Canal:</span>
                        <p className="text-text-primary text-xs">{details.channel}</p>
                      </div>
                    )}
                    {details.startedAt && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Início:</span>
                        <p className="text-text-primary text-xs">{formatDate(details.startedAt)}</p>
                      </div>
                    )}
                    {details.finishedAt && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Fim:</span>
                        <p className="text-text-primary text-xs">{formatDate(details.finishedAt)}</p>
                      </div>
                    )}
                    {durationMs !== null && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Duração:</span>
                        <p className="text-text-primary text-xs">{formatDuration(durationMs)}</p>
                      </div>
                    )}
                    {details.status && (
                      <div>
                        <span className="text-text-tertiary block mb-1">Status:</span>
                        <StatusBadge status={details.status} />
                      </div>
                    )}
                  </div>

                  {/* Entradas digitadas */}
                  {details.typedEntries && details.typedEntries.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-default">
                      <span className="text-text-tertiary text-xs block mb-2">Campos preenchidos:</span>
                      <div className="space-y-1">
                        {details.typedEntries.map((entry) => (
                          <div key={entry.id} className="flex gap-2 text-xs">
                            <span className="text-text-secondary font-semibold">{entry.field}:</span>
                            <span className="text-text-primary font-mono">{entry.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modo Step-by-Step */}
            {stepByStep && totalSteps > 0 && activeStep && (
              <div className="space-y-4">
                <div className="bg-bg-primary rounded-lg border border-border-default p-3 space-y-3">
                  {/* Navegação */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button onClick={goToFirst} disabled={currentStep === 0} variant="default" size="sm" className="text-xs">⏮️ Primeiro</Button>
                      <Button onClick={goToPrev} disabled={currentStep === 0} variant="default" size="sm" className="text-xs">⏪ Anterior</Button>
                    </div>
                    <div className="flex-1 mx-4">
                      <div className="text-center text-xs text-text-secondary mb-1">Passo {currentStep + 1} de {totalSteps}</div>
                      <div className="w-full bg-bg-secondary rounded-full h-2">
                        <div className="bg-accent-primary h-2 rounded-full transition-all" style={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={goToNext} disabled={currentStep >= totalSteps - 1} variant="default" size="sm" className="text-xs">Próximo ⏩</Button>
                      <Button onClick={goToLast} disabled={currentStep >= totalSteps - 1} variant="default" size="sm" className="text-xs">Último ⏭️</Button>
                    </div>
                  </div>

                  {/* Reprodução */}
                  <div className="flex items-center justify-between pt-2 border-t border-border-default">
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() => setIsPlaying((v) => !v)}
                        variant={isPlaying ? 'danger' : 'default'}
                        size="sm"
                        className="text-xs"
                      >
                        {isPlaying ? '⏸️ Pausar' : '▶️ Reproduzir'}
                      </Button>
                      <span className="text-xs text-text-tertiary">{isPlaying ? 'Reproduzindo...' : 'Pausado'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-text-secondary">Velocidade:</label>
                      <select
                        value={playbackSpeed}
                        onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                        className="px-2 py-1 text-xs bg-bg-secondary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                        disabled={isPlaying}
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

                {/* Card do passo atual */}
                <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-text-primary">#{activeStep.index ?? currentStep + 1} {activeStep.title}</span>
                    <StatusBadge status={activeStep.status} />
                  </div>
                  <div className="text-xs text-text-tertiary">{formatDate(activeStep.at)}</div>
                  {activeStepScreenshotSrc && (
                    <div className="mt-3 rounded border border-border-default bg-bg-primary p-2">
                      <img
                        src={activeStepScreenshotSrc}
                        alt={`Screenshot do passo ${activeStep.index ?? currentStep + 1}`}
                        className="max-w-full h-auto rounded border border-border-default"
                      />
                    </div>
                  )}
                  {activeStep.screenshot && (
                    <div className="mt-2 text-xs text-text-secondary">
                      <span>📸 Screenshot:</span> <span className="font-mono break-all">{activeStep.screenshot}</span>
                    </div>
                  )}
                </div>

                {screenshotTimelineSteps.length > 0 && (
                  <div className="bg-bg-secondary rounded-lg p-4 border border-border-default">
                    <h4 className="text-xs font-semibold text-text-primary mb-2">
                      Sequencia de telas capturadas ({screenshotTimelineSteps.length})
                    </h4>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {screenshotTimelineSteps.map(({ idx, step, imageSrc }, shotIdx) => {
                        const isActive = idx === currentStep;
                        return (
                          <button
                            key={`${step.id || idx}-shot`}
                            type="button"
                            className={`shrink-0 border rounded p-1 transition-colors ${
                              isActive
                                ? 'border-accent-primary bg-accent-primary/10'
                                : 'border-border-default bg-bg-primary hover:border-accent-primary/50'
                            }`}
                            onClick={() => {
                              setCurrentStep(idx);
                              setIsPlaying(false);
                            }}
                            title={`Ir para passo ${step.index ?? idx + 1}`}
                          >
                            <img
                              src={imageSrc}
                              alt={`Tela ${shotIdx + 1} do replay`}
                              className="w-40 h-24 object-cover rounded"
                            />
                            <div className="mt-1 text-[10px] text-text-secondary text-left">
                              Passo {step.index ?? idx + 1}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {!stepByStep && screenshotSteps.length > 0 && (
              <div className="mt-4">
                <h4 className="text-xs font-semibold text-text-primary mb-2">
                  {screenshotSteps.length} tela(s) capturada(s) durante a execução
                </h4>
                <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                  {screenshotSteps.map((step, idx) => {
                    const imageSrc = step.screenshotDataUrl
                      || (/^(data:image\/|https?:\/\/)/i.test(String(step.screenshot || '')) ? step.screenshot : null);

                    return (
                      <div key={step.id || idx} className="border border-border-default rounded p-2">
                        {imageSrc ? (
                          <img
                            src={imageSrc}
                            alt={`Screenshot ${idx + 1}`}
                            className="max-w-full h-auto rounded"
                          />
                        ) : (
                          <div className="text-xs text-text-secondary break-all">
                            {step.screenshot || 'Screenshot indisponível'}
                          </div>
                        )}
                        {step.at && (
                          <div className="text-xs text-text-tertiary mt-1">{formatDate(step.at)}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Modo Lista completa */}
            {!stepByStep && totalSteps === 0 && (
              <div className="text-center py-8 text-text-tertiary text-sm">
                Sem passos de replay registrados.
              </div>
            )}
          </div>
        </div>

        {/* Painel direito — Log de Passos */}
        <div
          className={`${logCollapsed ? 'w-12' : 'w-80'} min-w-[48px] flex flex-col transition-all duration-200 flow-editor-right-panel border-l border-border-default`}
        >
          <div className="section-header border-b border-border-default">
            <button
              className={`collapse-btn-horizontal collapse-btn-right ${logCollapsed ? 'collapsed' : ''}`}
              onClick={() => setLogCollapsed((v) => !v)}
              title={logCollapsed ? 'Expandir log de passos' : 'Recolher log de passos'}
            />
            {!logCollapsed && (
              <span className="text-xs font-semibold text-text-primary px-2">📋 Log de Passos</span>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {logCollapsed ? (
              <div
                className="flex-1 p-2 section-container flex items-center justify-center vertical cursor-pointer hover:bg-bg-secondary transition-colors"
                onClick={() => setLogCollapsed(false)}
                title="Clique para expandir Log de Passos"
              >
                <span className="resizable-panel-collapsed-text">Log de Passos</span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-3 space-y-2" id="qa-log-container">
                <div className="text-xs text-text-tertiary mb-2">{totalSteps} passo(s) registrado(s)</div>
                {steps.map((step, idx) => {
                  const isCurrent = stepByStep && currentStep === idx;
                  return (
                    <div
                      key={step.id || idx}
                      id={`qa-step-${idx}`}
                      className={`p-2 rounded border text-xs cursor-pointer transition-colors ${
                        isCurrent
                          ? 'bg-accent-primary/30 border-accent-primary border-2 shadow-md'
                          : step.status === 'failure' || step.status === 'error'
                          ? 'bg-status-error/5 border-status-error/20 hover:bg-status-error/10'
                          : 'bg-status-success/5 border-status-success/20 hover:bg-status-success/10'
                      }`}
                      onClick={() => { setStepByStep(true); setCurrentStep(idx); }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1 mb-1">
                            <span className="text-xs">🔧</span>
                            <div className="font-mono text-text-primary font-semibold truncate">
                              #{step.index ?? idx + 1} {step.title}
                            </div>
                          </div>
                          {step.at && (
                            <div className="text-text-tertiary mt-1 text-xs">{formatDate(step.at)}</div>
                          )}
                        </div>
                        <div className="flex-shrink-0 ml-2">
                          {step.status === 'failure' || step.status === 'error'
                            ? <span className="text-status-error text-sm">✗</span>
                            : <span className="text-status-success text-sm">✓</span>}
                        </div>
                      </div>
                      {isCurrent && (
                        <div className="mt-2 pt-2 border-t border-accent-primary/30">
                          <div className="text-xs font-semibold text-accent-primary">⬅ Passo Atual</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export default ReplayDetailsModal;
