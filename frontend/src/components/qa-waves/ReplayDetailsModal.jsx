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

const ACTOR_CONFIG = {
  customer:  { label: 'Cliente',  icon: '👤', color: 'text-blue-400',   bg: 'bg-blue-400/10 border-blue-400/30' },
  system:    { label: 'Sistema',  icon: '⚙️', color: 'text-text-tertiary',   bg: 'bg-text-tertiary/10 border-text-tertiary/30' },
  ai:        { label: 'IA',       icon: '🧠', color: 'text-purple-400', bg: 'bg-purple-400/10 border-purple-400/30' },
  bot:       { label: 'Bot',      icon: '🤖', color: 'text-teal-400',   bg: 'bg-teal-400/10 border-teal-400/30' },
  agent:     { label: 'Humano',   icon: '👨‍💼', color: 'text-amber-400',  bg: 'bg-amber-400/10 border-amber-400/30' },
  api:       { label: 'API',      icon: '🔌', color: 'text-green-400',  bg: 'bg-green-400/10 border-green-400/30' },
  rpa:       { label: 'RPA',      icon: '🕹️', color: 'text-rose-400',   bg: 'bg-rose-400/10 border-rose-400/30' },
};

const CATEGORY_ICON = {
  CLIENT_ACTION: '💬',
  SYSTEM_EVENT:  '⚡',
  AI_DECISION:   '🧠',
  BOT_ACTION:    '🤖',
  HUMAN_ACTION:  '👨‍💼',
  API_CALL:      '🔌',
  RPA_ACTION:    '🕹️',
  VALIDATION:    '✅',
  ERROR:         '🚨',
};

function getStepActorConfig(step) {
  const actor = step?.actor || step?.stepActor;
  return ACTOR_CONFIG[actor] || { label: actor || 'Sistema', icon: '⚙️', color: 'text-text-tertiary', bg: 'bg-text-tertiary/10 border-text-tertiary/30' };
}

function getStepIcon(step) {
  const category = step?.category || step?.stepCategory;
  if (CATEGORY_ICON[category]) return CATEGORY_ICON[category];
  const type = step?.stepType || step?.type;
  if (type === 'send_message') return '💬';
  if (type === 'validate_intent') return '🧠';
  if (type === 'validate_response') return '📝';
  if (type === 'validate_sla') return '⏱️';
  if (type === 'validate_backend') return '✅';
  if (type === 'validate_flow_transition') return '🔀';
  return '🔧';
}

/** Separa steps por seção de replay conforme ator/category */
function groupStepsBySection(steps) {
  return {
    waveSteps:    steps.filter((s) => !s.category || ['CLIENT_ACTION','SYSTEM_EVENT','AI_DECISION','BOT_ACTION','HUMAN_ACTION','VALIDATION'].includes(s.category)),
    rpaActions:   steps.filter((s) => s.category === 'RPA_ACTION'),
    aiDecisions:  steps.filter((s) => s.category === 'AI_DECISION'),
    humanActions: steps.filter((s) => s.category === 'HUMAN_ACTION'),
    errors:       steps.filter((s) => s.category === 'ERROR' || s.status === 'failed' || s.status === 'error' || s.status === 'failure'),
  };
}

/** Valida resultado de step: retorna lista de alertas */
function detectStepResultIssues(step) {
  const issues = [];
  const resp = step?.evidence?.apiResponse;
  if (resp && typeof resp === 'string' && /^\s*<(!DOCTYPE|html)/i.test(resp)) {
    issues.push({ type: 'html_response', message: 'API retornou HTML em vez de JSON — possível erro de rota ou proxy.' });
  }
  if (Array.isArray(step?.evidence?.consoleErrors) && step.evidence.consoleErrors.length > 0) {
    issues.push({ type: 'console_errors', message: `${step.evidence.consoleErrors.length} erro(s) crítico(s) de console detectado(s).` });
  }
  return issues;
}

export function ReplayDetailsModal({ details, onClose }) {
  const [stepByStep, setStepByStep] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1000);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [showOnlyFailures, setShowOnlyFailures] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showActorTimeline, setShowActorTimeline] = useState(false);
  const [trainingMode, setTrainingMode] = useState(false);

  const training = details?.training || null;
  const hasTraining = !!(training?.enabled && (training?.trainingSteps || details?.steps?.some(s => s?.trainingDescription)));

  const steps = details?.steps || [];
  const totalSteps = steps.length;
  const timeline = details?.timeline || details?.logs || [];
  const errorsList = details?.errors || [];
  const pageErrors = timeline.filter((item) => item.level === 'warning' || item.level === 'error');
  const visibleSteps = showOnlyFailures
    ? steps.filter((step) => {
      const status = String(step?.status || '').toLowerCase();
      return status === 'failed' || status === 'timeout' || !!step?.error;
    })
    : steps;
  const screenshotSteps = steps.filter((step) => step?.screenshot || step?.screenshotDataUrl);
  const stepGroups = groupStepsBySection(steps);

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
  const jumpToError = useCallback(() => {
    // Busca erro em steps, timeline e pageErrors (nessa ordem)
    const stepsIdx = steps.findIndex((step) => {
      const status = String(step?.status || '').toLowerCase();
      return status === 'failed' || status === 'timeout' || status === 'error' || status === 'failure' || !!step?.error;
    });
    if (stepsIdx >= 0) {
      setCurrentStep(stepsIdx);
      setStepByStep(true);
      setIsPlaying(false);
      return;
    }
    // Se não achou em steps, verifica se há pageErrors/timeline com erros
    if (pageErrors.length > 0) {
      setShowTimeline(true);
      setStepByStep(false);
      setIsPlaying(false);
    }
  }, [steps, pageErrors]);

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
                    {hasTraining && (
                      <Button
                        onClick={() => { setTrainingMode((v) => !v); if (!trainingMode && !stepByStep) { setStepByStep(true); setCurrentStep(0); setIsPlaying(false); } }}
                        variant={trainingMode ? 'primary' : 'outline'}
                        size="sm"
                        className="text-xs"
                        title="Modo Treinamento: mostra descrições narrativas e dicas visuais para cada passo"
                      >
                        {trainingMode ? '🎓 Treinando' : '🎓 Treinar'}
                      </Button>
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

            {/* Actor Timeline — jornada real do cliente no replay */}
            {totalSteps > 0 && (
              <div className="bg-bg-secondary rounded-lg border border-border-default">
                <div className="flex items-center justify-between p-4 border-b border-border-default">
                  <span className="text-sm font-semibold text-text-primary">🎭 Timeline por Ator</span>
                  <Button
                    onClick={() => setShowActorTimeline((v) => !v)}
                    variant="default"
                    size="sm"
                    className="text-xs"
                  >
                    {showActorTimeline ? '▲ Recolher' : '▼ Expandir'}
                  </Button>
                </div>
                {showActorTimeline && (
                  <div className="p-4 space-y-3">
                    {/* Faixa horizontal de atores */}
                    <div className="flex items-center gap-2 flex-wrap text-xs mb-2">
                      {Object.entries(ACTOR_CONFIG).map(([key, cfg]) => {
                        const hasActor = steps.some((s) => (s.actor || s.stepActor) === key);
                        if (!hasActor) return null;
                        return (
                          <span key={key} className={`px-2 py-0.5 rounded border font-semibold ${cfg.bg} ${cfg.color}`}>
                            {cfg.icon} {cfg.label}
                          </span>
                        );
                      })}
                    </div>

                    {/* Linha do tempo */}
                    <div className="relative space-y-1">
                      {steps.map((step, idx) => {
                        const actorCfg = getStepActorConfig(step);
                        const stepIcon = getStepIcon(step);
                        const status = String(step?.status || '').toLowerCase();
                        const isError = status === 'failed' || status === 'error' || status === 'failure' || status === 'timeout' || !!step?.error;
                        const issues = detectStepResultIssues(step);
                        return (
                          <div
                            key={step.id || idx}
                            className={`flex items-start gap-3 p-2 rounded border text-xs cursor-pointer transition-colors ${
                              isError
                                ? 'bg-status-error/5 border-status-error/20 hover:bg-status-error/10'
                                : 'bg-bg-primary border-border-default hover:bg-bg-tertiary'
                            }`}
                            onClick={() => { setStepByStep(true); setCurrentStep(idx); }}
                          >
                            {/* Ator badge */}
                            <span className={`shrink-0 px-2 py-0.5 rounded border font-semibold ${actorCfg.bg} ${actorCfg.color} min-w-[72px] text-center`}>
                              {actorCfg.icon} {actorCfg.label}
                            </span>
                            {/* Conector */}
                            <span className="shrink-0 text-text-tertiary mt-0.5">→</span>
                            {/* Descrição do step */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1 flex-wrap">
                                <span>{stepIcon}</span>
                                <span className="font-semibold text-text-primary truncate">
                                  {step.name || step.title || step.type || `Step ${idx + 1}`}
                                </span>
                                {step.category && (
                                  <span className="px-1 py-0.5 rounded text-[10px] bg-bg-secondary border border-border-default text-text-tertiary">
                                    {step.category}
                                  </span>
                                )}
                                {step.wave && (
                                  <span className="px-1 py-0.5 rounded text-[10px] bg-accent-primary/10 border border-accent-primary/20 text-accent-primary">
                                    {step.wave}
                                  </span>
                                )}
                              </div>
                              {step.description && (
                                <div className="text-text-tertiary mt-0.5 truncate">{step.description}</div>
                              )}
                              {issues.map((issue, issueIdx) => (
                                <div key={issueIdx} className="mt-1 text-status-error text-[10px]">
                                  🚨 {issue.message}
                                </div>
                              ))}
                            </div>
                            {/* Status */}
                            <span className={`shrink-0 text-sm ${isError ? 'text-status-error' : 'text-status-success'}`}>
                              {isError ? '✗' : '✓'}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Resumo por seção */}
                    {(stepGroups.rpaActions.length > 0 || stepGroups.aiDecisions.length > 0 || stepGroups.humanActions.length > 0 || stepGroups.errors.length > 0) && (
                      <div className="mt-3 pt-3 border-t border-border-default grid grid-cols-2 gap-2 text-xs">
                        {stepGroups.aiDecisions.length > 0 && (
                          <div className="p-2 rounded border border-purple-400/20 bg-purple-400/5">
                            <div className="font-semibold text-purple-400 mb-1">🧠 Decisões de IA ({stepGroups.aiDecisions.length})</div>
                            {stepGroups.aiDecisions.map((s, i) => (
                              <div key={i} className="text-text-secondary truncate">{s.name || s.type}</div>
                            ))}
                          </div>
                        )}
                        {stepGroups.humanActions.length > 0 && (
                          <div className="p-2 rounded border border-amber-400/20 bg-amber-400/5">
                            <div className="font-semibold text-amber-400 mb-1">👨‍💼 Ações Humanas ({stepGroups.humanActions.length})</div>
                            {stepGroups.humanActions.map((s, i) => (
                              <div key={i} className="text-text-secondary truncate">{s.name || s.type}</div>
                            ))}
                          </div>
                        )}
                        {stepGroups.rpaActions.length > 0 && (
                          <div className="p-2 rounded border border-rose-400/20 bg-rose-400/5">
                            <div className="font-semibold text-rose-400 mb-1">🕹️ RPA ({stepGroups.rpaActions.length})</div>
                            {stepGroups.rpaActions.map((s, i) => (
                              <div key={i} className="text-text-secondary truncate">{s.name || s.type}</div>
                            ))}
                          </div>
                        )}
                        {stepGroups.errors.length > 0 && (
                          <div className="p-2 rounded border border-status-error/20 bg-status-error/5">
                            <div className="font-semibold text-status-error mb-1">🚨 Erros ({stepGroups.errors.length})</div>
                            {stepGroups.errors.map((s, i) => (
                              <div key={i} className="text-text-secondary truncate">{s.name || s.type}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Timeline de Execução e Erros */}
            {timeline.length > 0 && (              <div className="bg-bg-secondary rounded-lg border border-border-default">
                <div className="flex items-center justify-between p-4 border-b border-border-default">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">📊 Execução</span>
                    {pageErrors.length > 0 && (
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-status-warning/20 text-status-warning border border-status-warning/40">
                        ⚠️ {pageErrors.length} erro(s)
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => setShowTimeline(!showTimeline)}
                      variant="default"
                      size="sm"
                      className="text-xs"
                    >
                      {showTimeline ? '📋 Ver Resumo' : '📋 Ver Timeline'}
                    </Button>
                  </div>
                </div>

                {showTimeline ? (
                  <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
                    <div className="text-xs text-text-tertiary mb-2">{timeline.length} evento(s) registrado(s)</div>
                    {timeline.map((event, idx) => {
                      const levelColor = 
                        event.level === 'error' ? 'text-status-error' :
                        event.level === 'warning' ? 'text-status-warning' :
                        event.level === 'success' ? 'text-status-success' :
                        'text-text-secondary';
                      const bgColor =
                        event.level === 'error' ? 'bg-status-error/5 border-status-error/20' :
                        event.level === 'warning' ? 'bg-status-warning/5 border-status-warning/20' :
                        event.level === 'success' ? 'bg-status-success/5 border-status-success/20' :
                        'bg-bg-primary border-border-default';
                      return (
                        <div key={idx} className={`p-2 rounded border text-xs ${bgColor} ${levelColor}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-text-tertiary mb-1 font-mono text-xs">{formatDate(event.timestamp)}</div>
                              <div className="text-text-primary break-words">{event.message}</div>
                              {event.action && <div className="text-text-secondary mt-1">Ação: {event.action}</div>}
                              {event.details && <div className="text-text-secondary mt-1">Detalhes: {event.details}</div>}
                            </div>
                            {event.step && (
                              <div className="flex-shrink-0 ml-2 text-text-tertiary text-xs">{event.step}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-4 space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-bg-primary rounded p-2 text-center">
                        <div className="text-xs text-text-tertiary mb-1">Total de Eventos</div>
                        <div className="text-lg font-bold text-text-primary">{timeline.length}</div>
                      </div>
                      <div className="bg-bg-primary rounded p-2 text-center">
                        <div className="text-xs text-text-tertiary mb-1">Sucessos</div>
                        <div className="text-lg font-bold text-status-success">
                          {timeline.filter((e) => e.level === 'success').length}
                        </div>
                      </div>
                      <div className="bg-bg-primary rounded p-2 text-center">
                        <div className="text-xs text-text-tertiary mb-1">Avisos</div>
                        <div className="text-lg font-bold text-status-warning">
                          {pageErrors.length}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-text-secondary mt-3">
                      Clique em "Ver Timeline" para ver detalhes de cada evento.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Erros da Página (detectados durante execução) */}
            {pageErrors.length > 0 && (
              <div className="bg-status-error/5 rounded-lg border border-status-error/20">
                <div className="p-4 border-b border-status-error/20">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-status-error">🚨 Erros Detectados ({pageErrors.length})</span>
                  </div>
                </div>
                <div className="p-4 space-y-3 max-h-60 overflow-y-auto">
                  {pageErrors.map((event, idx) => (
                    <div key={idx} className="bg-bg-primary rounded p-3 border border-status-error/30">
                      <div className="flex items-start gap-2">
                        <span className="text-status-error text-lg flex-shrink-0">⚠️</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-text-tertiary mb-1">{formatDate(event.timestamp)}</div>
                          <div className="text-sm text-text-primary break-words font-medium">{event.message}</div>
                          {event.errors && Array.isArray(event.errors) && (
                            <div className="mt-2 space-y-1">
                              {event.errors.map((err, errIdx) => (
                                <div key={errIdx} className="text-xs text-text-secondary bg-bg-secondary rounded p-2 break-words">
                                  <div className="font-mono text-text-tertiary">{err.type || 'error'}</div>
                                  <div>{err.message || String(err)}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                      <Button onClick={jumpToError} variant="default" size="sm" className="text-xs">⛳ Ir para erro</Button>
                      <span className="text-xs text-text-tertiary">{isPlaying ? 'Reproduzindo...' : 'Pausado'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={showOnlyFailures}
                          onChange={(e) => setShowOnlyFailures(e.target.checked)}
                        />
                        Mostrar apenas falhas
                      </label>
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
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-primary">#{activeStep.index ?? currentStep + 1} {activeStep.title || activeStep.name}</span>
                    <StatusBadge status={activeStep.status} />
                    {activeStep.category && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-bg-tertiary border border-border-default text-text-secondary">
                        {CATEGORY_ICON[activeStep.category] || ''} {activeStep.category}
                      </span>
                    )}
                    {activeStep.actor && (() => {
                      const cfg = getStepActorConfig(activeStep);
                      return (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${cfg.bg} ${cfg.color}`}>
                          {cfg.icon} {cfg.label}
                        </span>
                      );
                    })()}
                    {activeStep.error && (
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-status-error/20 text-status-error border border-status-error/40">ERRO</span>
                    )}
                  </div>
                  {activeStep.description && (
                    <div className="text-xs text-text-secondary mb-2">{activeStep.description}</div>
                  )}
                  {/* ── Modo Treinamento ── */}
                  {trainingMode && (activeStep.trainingDescription || activeStep.trainingHint || activeStep.expectedVisual) && (
                    <div className="mt-2 p-3 rounded-lg bg-accent-primary/10 border border-accent-primary/30 space-y-2">
                      <div className="text-xs font-semibold text-accent-primary flex items-center gap-1">
                        🎓 Material de Treinamento
                      </div>
                      {activeStep.trainingDescription && (
                        <div className="text-xs text-text-primary leading-relaxed">
                          <span className="text-text-tertiary">📖 </span>
                          {activeStep.trainingDescription}
                        </div>
                      )}
                      {activeStep.trainingHint && (
                        <div className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                          <span className="text-text-tertiary">💡 Dica: </span>
                          {activeStep.trainingHint}
                        </div>
                      )}
                      {activeStep.expectedVisual && (
                        <div className="text-xs text-text-secondary leading-relaxed">
                          <span className="text-text-tertiary">👁️ Visual esperado: </span>
                          {activeStep.expectedVisual}
                        </div>
                      )}
                    </div>
                  )}
                  {/* ── Fim Modo Treinamento ── */}
                  <div className="text-xs text-text-tertiary">{formatDate(activeStep.at || activeStep.startedAt)}</div>
                  <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div><span className="text-text-tertiary">Ação:</span> <span className="text-text-primary">{activeStep.action || activeStep.stepType || activeStep.type || '-'}</span></div>
                    <div><span className="text-text-tertiary">Seletor:</span> <span className="text-text-primary font-mono break-all">{activeStep.selector || '-'}</span></div>
                    <div><span className="text-text-tertiary">Input:</span> <span className="text-text-primary break-all">{activeStep.input !== undefined ? (typeof activeStep.input === 'object' ? JSON.stringify(activeStep.input) : String(activeStep.input)) : '-'}</span></div>
                    <div><span className="text-text-tertiary">Expected:</span> <span className="text-text-primary break-all">{activeStep.expected !== undefined ? (typeof activeStep.expected === 'object' ? JSON.stringify(activeStep.expected) : String(activeStep.expected)) : '-'}</span></div>
                    <div><span className="text-text-tertiary">Actual:</span> <span className="text-text-primary break-all">{activeStep.actual !== undefined ? (typeof activeStep.actual === 'object' ? JSON.stringify(activeStep.actual) : String(activeStep.actual)) : '-'}</span></div>
                    <div><span className="text-text-tertiary">Duração:</span> <span className="text-text-primary">{activeStep.durationMs !== undefined && activeStep.durationMs !== null ? formatDuration(activeStep.durationMs) : '-'}</span></div>
                  </div>

                  {/* Alertas de resultado (HTML em vez de JSON, erros de console) */}
                  {(() => {
                    const issues = detectStepResultIssues(activeStep);
                    return issues.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        {issues.map((issue, i) => (
                          <div key={i} className="p-2 rounded bg-status-error/10 border border-status-error/30 text-xs text-status-error">
                            🚨 {issue.message}
                          </div>
                        ))}
                      </div>
                    ) : null;
                  })()}

                  {/* Evidências vinculadas ao step */}
                  {activeStep.evidence && typeof activeStep.evidence === 'object' && (
                    <div className="mt-3 pt-3 border-t border-border-default space-y-2">
                      <div className="text-xs font-semibold text-text-primary">🔍 Evidências do Passo</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {activeStep.evidence.ticketId && (
                          <div><span className="text-text-tertiary">Ticket:</span> <span className="font-mono text-text-primary">{activeStep.evidence.ticketId}</span></div>
                        )}
                        {activeStep.evidence.conversationId && (
                          <div><span className="text-text-tertiary">Conversa:</span> <span className="font-mono text-text-primary">{activeStep.evidence.conversationId}</span></div>
                        )}
                        {activeStep.evidence.messageId && (
                          <div><span className="text-text-tertiary">Mensagem:</span> <span className="font-mono text-text-primary">{activeStep.evidence.messageId}</span></div>
                        )}
                        {activeStep.evidence.payload && (
                          <div className="col-span-2">
                            <span className="text-text-tertiary">Payload:</span>
                            <pre className="mt-1 p-2 bg-bg-primary rounded border border-border-default font-mono text-[10px] overflow-auto max-h-24 text-text-primary">
                              {typeof activeStep.evidence.payload === 'object' ? JSON.stringify(activeStep.evidence.payload, null, 2) : String(activeStep.evidence.payload)}
                            </pre>
                          </div>
                        )}
                        {activeStep.evidence.apiRequest && (
                          <div className="col-span-2">
                            <span className="text-text-tertiary">API Request:</span>
                            <pre className="mt-1 p-2 bg-bg-primary rounded border border-border-default font-mono text-[10px] overflow-auto max-h-24 text-text-primary">
                              {typeof activeStep.evidence.apiRequest === 'object' ? JSON.stringify(activeStep.evidence.apiRequest, null, 2) : String(activeStep.evidence.apiRequest)}
                            </pre>
                          </div>
                        )}
                        {activeStep.evidence.apiResponse && (
                          <div className="col-span-2">
                            <span className="text-text-tertiary">API Response:</span>
                            <pre className={`mt-1 p-2 rounded border font-mono text-[10px] overflow-auto max-h-24 ${/^\s*<(!DOCTYPE|html)/i.test(String(activeStep.evidence.apiResponse)) ? 'bg-status-error/10 border-status-error/30 text-status-error' : 'bg-bg-primary border-border-default text-text-primary'}`}>
                              {typeof activeStep.evidence.apiResponse === 'object' ? JSON.stringify(activeStep.evidence.apiResponse, null, 2) : String(activeStep.evidence.apiResponse)}
                            </pre>
                          </div>
                        )}
                        {Array.isArray(activeStep.evidence.consoleErrors) && activeStep.evidence.consoleErrors.length > 0 && (
                          <div className="col-span-2">
                            <span className="text-text-tertiary text-status-error">Console Errors ({activeStep.evidence.consoleErrors.length}):</span>
                            <div className="mt-1 space-y-1">
                              {activeStep.evidence.consoleErrors.map((err, i) => (
                                <div key={i} className="p-1 bg-status-error/10 rounded text-[10px] text-status-error font-mono">{typeof err === 'object' ? JSON.stringify(err) : String(err)}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      {/* Screenshots vinculadas ao step */}
                      {(activeStep.evidence.screenshotBefore || activeStep.evidence.screenshotAfter) && (
                        <div className="grid grid-cols-2 gap-2">
                          {activeStep.evidence.screenshotBefore && (
                            <div>
                              <div className="text-[10px] text-text-tertiary mb-1">Before</div>
                              <img src={activeStep.evidence.screenshotBefore} alt="screenshot before" className="max-w-full rounded border border-border-default" />
                            </div>
                          )}
                          {activeStep.evidence.screenshotAfter && (
                            <div>
                              <div className="text-[10px] text-text-tertiary mb-1">After</div>
                              <img src={activeStep.evidence.screenshotAfter} alt="screenshot after" className="max-w-full rounded border border-border-default" />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {details.tracePath && (
                    <div className="mt-2">
                      <Button
                        onClick={() => window.open(details.tracePath, '_blank', 'noopener,noreferrer')}
                        variant="default"
                        size="sm"
                        className="text-xs"
                      >
                        Abrir trace.zip
                      </Button>
                    </div>
                  )}
                  {Array.isArray(activeStep.consoleLogs) && activeStep.consoleLogs.length > 0 && (
                    <div className="mt-2 p-2 rounded bg-bg-primary border border-border-default text-xs text-text-secondary max-h-32 overflow-auto">
                      {activeStep.consoleLogs.slice(0, 20).map((log, idx) => (
                        <div key={`log-${idx}`}>{log.level || 'log'}: {log.text || JSON.stringify(log)}</div>
                      ))}
                    </div>
                  )}
                  {activeStep.error && (
                    <div className="mt-2 p-2 rounded bg-status-error/10 border border-status-error/30 text-xs text-status-error break-all">
                      {activeStep.error?.message || String(activeStep.error)}
                    </div>
                  )}
                  {(activeStep.adapter || activeStep.channel) && (
                    <div className="mt-2 flex gap-3 text-xs text-text-secondary">
                      {activeStep.channel && <span>📡 Canal: <span className="font-mono text-text-primary">{activeStep.channel}</span></span>}
                      {activeStep.adapter && activeStep.adapter !== activeStep.channel && (
                        <span>⚙️ Adapter: <span className="font-mono text-text-primary">{activeStep.adapter}</span></span>
                      )}
                    </div>
                  )}
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
                  {!activeStepScreenshotSrc && activeStep.stepType && (
                    <div className="mt-3 p-2 rounded bg-bg-primary border border-border-default text-xs text-text-tertiary">
                      📵 Sem captura de tela — testes de canal de mensagem ({activeStep.channel || activeStep.adapter || 'messaging'}) não geram screenshots de browser.
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

            {/* Telas capturadas (screens do replay QA Waves) */}
            {Array.isArray(details.screens) && details.screens.length > 0 && screenshotSteps.length === 0 && (
              <div className="bg-bg-secondary rounded-lg border border-border-default p-4">
                <h4 className="text-xs font-semibold text-text-primary mb-2">
                  {details.screens.length} tela(s) capturada(s) durante a execução
                </h4>
                <div className="grid grid-cols-2 gap-2 max-h-96 overflow-y-auto">
                  {details.screens.map((screen, screenIndex) => (
                    <div key={screen.screenId || screenIndex} className="border border-border-default rounded p-2">
                      {screen.screenshot && (
                        <img
                          src={`data:image/png;base64,${screen.screenshot}`}
                          alt={`Screenshot ${screenIndex + 1}`}
                          className="max-w-full h-auto rounded"
                        />
                      )}
                      {screen.timestamp && (
                        <div className="text-xs text-text-tertiary mt-1">{formatDate(screen.timestamp)}</div>
                      )}
                    </div>
                  ))}
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
                <div className="text-xs text-text-tertiary mb-2">{visibleSteps.length} passo(s) registrado(s)</div>
                {visibleSteps.map((step) => {
                  const idx = steps.indexOf(step);
                  const isCurrent = stepByStep && currentStep === idx;
                  const stepIcon = getStepIcon(step);
                  const actorCfg = getStepActorConfig(step);
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
                            <span className="text-xs">{stepIcon}</span>
                            <div className="font-mono text-text-primary font-semibold truncate">
                              #{step.index ?? idx + 1} {step.title || step.name}
                            </div>
                          </div>
                          {(step.actor || step.category) && (
                            <div className="flex gap-1 flex-wrap mb-1">
                              {step.actor && (
                                <span className={`px-1 py-0.5 rounded text-[10px] border font-semibold ${actorCfg.bg} ${actorCfg.color}`}>
                                  {actorCfg.icon} {actorCfg.label}
                                </span>
                              )}
                              {step.category && (
                                <span className="px-1 py-0.5 rounded text-[10px] border border-border-default bg-bg-secondary text-text-tertiary">
                                  {step.category}
                                </span>
                              )}
                            </div>
                          )}
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
