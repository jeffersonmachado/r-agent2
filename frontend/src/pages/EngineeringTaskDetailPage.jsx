import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../hooks/useRouter';
import {
  getEngineeringTask, listEngineeringAttempts, listEngineeringTests, listEngineeringReviews,
  listEngineeringTelemetry, runEngineeringTask, cancelEngineeringTask,
} from '../api/engineeringRouter';
import { useToast } from '../components/Toast';
import { useEngineeringTaskRealtime } from './engineering-router/useEngineeringTaskRealtime';

const PIPELINE_STAGES = ['CREATED', 'CLASSIFIED', 'ROUTED', 'CODING', 'TESTING', 'REVIEWING', 'REGRESSION', 'GOVERNANCE', 'GREEN'];

const STAGE_STATUS_STYLE = {
  running: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  success: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  error: 'bg-red-500/15 text-red-500 border-red-500/30',
  info: 'bg-bg-subtle text-text-secondary border-border-default',
};

function StageDot({ status }) {
  const color = status === 'running' ? 'bg-blue-500 animate-pulse'
    : status === 'success' ? 'bg-emerald-500'
      : status === 'error' ? 'bg-red-500'
        : 'bg-text-secondary';
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${color}`} />;
}

function formatStageTime(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

/** Feed ao vivo de estágios da execução — o equivalente, nesta tela, à lista de passos que a
 * extensão do VSCode mostra durante uma edição assistida por IA (sem polling: cada linha chega
 * via WebSocket assim que o backend confirma a transição real). */
function LiveActivityFeed({ feed, connected }) {
  if (feed.length === 0) {
    return (
      <div className="text-sm text-text-secondary">
        {connected ? 'Nenhum evento ainda — clique em Run para começar.' : 'Conectando ao WebSocket…'}
      </div>
    );
  }
  return (
    <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
      {feed.slice().reverse().map((event, idx) => (
        <div key={`${event.ts}-${idx}`} className="flex items-start gap-2 text-xs">
          <span className="mt-1"><StageDot status={event.status} /></span>
          <span className="text-text-secondary font-mono w-16 flex-shrink-0">{formatStageTime(event.ts)}</span>
          <span className={`px-1.5 py-0.5 rounded border font-medium flex-shrink-0 ${STAGE_STATUS_STYLE[event.status] || STAGE_STATUS_STYLE.info}`}>
            {event.stage}{event.attemptNumber ? ` #${event.attemptNumber}` : ''}
          </span>
          <span className="text-text-primary">{event.message}</span>
        </div>
      ))}
    </div>
  );
}

/** Lista ao vivo dos arquivos tocados pelo patch aplicado — nome de arquivo + caminho, no
 * mesmo espírito da lista de "changed files" da extensão do VSCode. */
function ChangedFilesList({ files }) {
  if (files.length === 0) {
    return <div className="text-sm text-text-secondary">Nenhum arquivo alterado ainda.</div>;
  }
  return (
    <ul className="space-y-1">
      {files.map((path) => {
        const name = path.split('/').pop();
        const dir = path.slice(0, path.length - name.length);
        return (
          <li key={path} className="flex items-baseline gap-1.5 text-xs font-mono">
            <span className="text-emerald-500">●</span>
            <span className="text-text-primary">{name}</span>
            {dir && <span className="text-text-secondary truncate">{dir.replace(/\/$/, '')}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function extractTaskId(currentPath) {
  const match = /^\/dev\/engineering\/tasks\/([^/]+)/.exec(currentPath);
  return match ? match[1] : null;
}

function PipelineTrack({ status }) {
  const isTerminalRed = status === 'RED' || status === 'BLOCKED' || status === 'CANCELLED';
  // ERV1-CLOSE-005: READY_FOR_PROMOTION é distinto de GREEN — CODER/TESTE/REVIEW/REGRESSION/
  // GOVERNANCE passaram de verdade, mas a promoção do patch validado ao repositório real não
  // completou (nunca "quase GREEN": é seu próprio estado terminal, com o motivo exato).
  const isReadyForPromotion = status === 'READY_FOR_PROMOTION';
  const currentIndex = (isTerminalRed || isReadyForPromotion) ? -1 : PIPELINE_STAGES.indexOf(status);
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {isTerminalRed && (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-500/15 text-red-500 border border-red-500/30">{status}</span>
      )}
      {isReadyForPromotion && (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30" title="Patch validado (CODER/teste/review/regressão/governança passaram de verdade), mas a promoção ao repositório real não completou">
          READY_FOR_PROMOTION
        </span>
      )}
      {!isTerminalRed && !isReadyForPromotion && PIPELINE_STAGES.map((stage, idx) => (
        <React.Fragment key={stage}>
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${
              idx < currentIndex ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                : idx === currentIndex ? 'bg-blue-500/15 text-blue-500 border-blue-500/30'
                  : 'bg-bg-elevated text-text-secondary border-border-default'
            }`}
          >
            {stage}
          </span>
          {idx < PIPELINE_STAGES.length - 1 && <span className="text-text-secondary">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

export function EngineeringTaskDetailPage() {
  const { currentPath, navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const taskId = extractTaskId(currentPath);

  const [task, setTask] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [testsByAttempt, setTestsByAttempt] = useState({});
  const [reviewsByAttempt, setReviewsByAttempt] = useState({});
  const [telemetry, setTelemetry] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const [t, a, tests, reviews, tel] = await Promise.all([
        getEngineeringTask(taskId),
        listEngineeringAttempts(taskId),
        listEngineeringTests(taskId),
        listEngineeringReviews(taskId),
        listEngineeringTelemetry(taskId),
      ]);
      setTask(t);
      setAttempts(a.attempts || []);
      setTestsByAttempt(tests.testsByAttempt || {});
      setReviewsByAttempt(reviews.reviewsByAttempt || {});
      setTelemetry(tel.telemetry || []);
    } catch (err) {
      showToast?.(err.message || 'Falha ao carregar task', 'error');
    } finally {
      setLoading(false);
    }
  }, [taskId, showToast]);

  useEffect(() => { load(); }, [load]);

  // Ao chegar um estágio terminal (GREEN/RED) via WebSocket, sincroniza uma última vez com o
  // backend para trazer attempts/tests/reviews/telemetria definitivos — nenhum polling entre
  // esse ponto e o clique em Run: tudo o que acontece no meio chega pelo feed ao vivo.
  const { feed, changedFiles, resetFeed, connected: wsConnected } = useEngineeringTaskRealtime(taskId, {
    onTerminalStage: () => load(),
  });

  const TERMINAL_STATUSES = ['GREEN', 'READY_FOR_PROMOTION', 'RED', 'BLOCKED', 'CANCELLED'];
  // "Em execução" reflete o lock real de runTask (locked_at), não a lista de status —
  // uma task recém-criada já fica em CLASSIFIED (aguardando o clique em Run), e tratar
  // CLASSIFIED/ROUTED como "ativo" travava o botão Run permanentemente antes da primeira
  // execução (defeito real encontrado testando o pilot ponta a ponta via UI).
  const isActive = Boolean(task?.locked_at);
  const isTerminal = task && TERMINAL_STATUSES.includes(task.status);

  const handleRun = async () => {
    setActing(true);
    try {
      resetFeed();
      await runEngineeringTask(taskId);
      showToast?.('Execução iniciada — acompanhe abaixo em tempo real', 'success');
      load();
    } catch (err) {
      showToast?.(err.message || 'Falha ao iniciar execução', 'error');
    } finally {
      setActing(false);
    }
  };

  const handleCancel = async () => {
    setActing(true);
    try {
      await cancelEngineeringTask(taskId);
      showToast?.('Task cancelada', 'success');
      load();
    } catch (err) {
      showToast?.(err.message || 'Falha ao cancelar', 'error');
    } finally {
      setActing(false);
    }
  };

  if (loading && !task) {
    return <div className="p-6 text-sm text-text-secondary">Carregando…</div>;
  }
  if (!task) {
    return <div className="p-6 text-sm text-text-secondary">Task não encontrada.</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ToastContainer />
      <button type="button" onClick={() => navigate('/dev/engineering/tasks')} className="text-sm text-text-secondary mb-4 hover:text-text-primary">← Voltar para Tasks</button>

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-text-primary">{task.title}</h1>
        <div className="flex gap-2">
          <button type="button" disabled={acting || isActive || isTerminal} onClick={handleRun} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {isActive ? 'Em execução…' : 'Run'}
          </button>
          <button type="button" disabled={acting || isTerminal} onClick={handleCancel} className="px-4 py-2 rounded-lg border border-border-default text-sm text-text-secondary disabled:opacity-50">
            Cancel
          </button>
        </div>
      </div>

      <PipelineTrack status={task.status} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-text-primary">Atividade em tempo real</h2>
            <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-text-secondary'}`} title={wsConnected ? 'WebSocket conectado' : 'WebSocket desconectado'} />
          </div>
          <LiveActivityFeed feed={feed} connected={wsConnected} />
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Arquivos alterados nesta execução ({changedFiles.length})</h2>
          <ChangedFilesList files={changedFiles} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Task Contract</h2>
          <dl className="text-sm space-y-1">
            <div className="flex justify-between"><dt className="text-text-secondary">Tipo</dt><dd className="text-text-primary">{task.task_type}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Risco</dt><dd className="text-text-primary">{task.risk}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Escopo</dt><dd className="text-text-primary">{task.scope}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Max iterações</dt><dd className="text-text-primary">{task.max_iterations}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Release blocker</dt><dd className="text-text-primary">{task.release_blocker ? 'sim' : 'não'}</dd></div>
          </dl>
          <div className="mt-3">
            <div className="text-xs text-text-secondary mb-1">Objetivo</div>
            <div className="text-sm text-text-primary">{task.objective || '—'}</div>
          </div>
          <div className="mt-3">
            <div className="text-xs text-text-secondary mb-1">Allowed paths</div>
            <div className="text-xs font-mono text-text-primary space-y-0.5">{(task.allowed_paths || []).map((p) => <div key={p}>{p}</div>)}</div>
          </div>
          {task.last_error && (
            <div className="mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-500">
              {task.last_error.code}: {task.last_error.message}
            </div>
          )}
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Routing Decision</h2>
          {!task.routing_decision?.coder ? (
            <div className="text-sm text-text-secondary">Ainda não roteado.</div>
          ) : (
            <div className="text-sm space-y-3">
              <div>
                <div className="text-xs text-text-secondary">CODER</div>
                <div className="text-text-primary font-medium">
                  {task.routing_decision.coder.selected ? `${task.routing_decision.coder.selected.providerId}:${task.routing_decision.coder.selected.modelId}` : 'nenhum qualificado'}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(task.routing_decision.coder.reasonCodes || []).map((rc) => (
                    <span key={rc} className="px-2 py-0.5 rounded-full text-xs bg-bg-subtle border border-border-default text-text-secondary">{rc}</span>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">REVIEWER {task.routing_decision.independentReviewRequired ? '(independência exigida)' : ''}</div>
                <div className="text-text-primary font-medium">
                  {task.routing_decision.reviewer?.selected ? `${task.routing_decision.reviewer.selected.providerId}:${task.routing_decision.reviewer.selected.modelId}` : 'nenhum qualificado'}
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {(task.routing_decision.reviewer?.reasonCodes || []).map((rc) => (
                    <span key={rc} className="px-2 py-0.5 rounded-full text-xs bg-bg-subtle border border-border-default text-text-secondary">{rc}</span>
                  ))}
                </div>
              </div>
              <div className="text-xs text-text-secondary">policyVersion: {task.routing_decision.policyVersion}</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mt-4">
        <h2 className="text-sm font-bold text-text-primary mb-3">Histórico de tentativas ({attempts.length})</h2>
        {attempts.length === 0 ? (
          <div className="text-sm text-text-secondary">Nenhuma tentativa ainda.</div>
        ) : (
          <div className="space-y-4">
            {attempts.map((attempt) => (
              <div key={attempt.id} className="border border-border-default rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-text-primary">Tentativa #{attempt.attempt_number} — {attempt.coder_provider}:{attempt.coder_model}</div>
                  <span className="text-xs px-2 py-1 rounded-full bg-bg-subtle border border-border-default text-text-secondary">{attempt.status}</span>
                </div>
                {attempt.patch_diff && (
                  <details className="mb-2">
                    <summary className="text-xs text-text-secondary cursor-pointer">Ver patch</summary>
                    <pre className="text-xs bg-bg-primary border border-border-default rounded-lg p-2 mt-1 overflow-x-auto whitespace-pre-wrap">{attempt.patch_diff}</pre>
                  </details>
                )}
                {(testsByAttempt[attempt.id] || []).map((test) => (
                  <div key={test.id} className="text-xs text-text-secondary flex justify-between border-t border-border-default pt-1 mt-1">
                    <span className="font-mono truncate max-w-[70%]">{test.command}</span>
                    <span className={test.status === 'PASS' ? 'text-emerald-500' : 'text-red-500'}>{test.status} (exit {test.exit_code ?? '—'})</span>
                  </div>
                ))}
                {(reviewsByAttempt[attempt.id] || []).map((review) => (
                  <div key={review.id} className="text-xs border-t border-border-default pt-2 mt-2">
                    <div className={review.decision === 'APPROVE' ? 'text-emerald-500 font-medium' : 'text-red-500 font-medium'}>
                      {review.decision} — {review.reviewer_provider}:{review.reviewer_model} {review.independent_of_coder ? '(independente)' : ''}
                    </div>
                    {(review.findings || []).map((f, i) => (
                      <div key={i} className="text-text-secondary mt-1">[{f.severity}] {f.category}: {f.description}</div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-5 mt-4">
        <h2 className="text-sm font-bold text-text-primary mb-3">Telemetria</h2>
        {telemetry.length === 0 ? (
          <div className="text-sm text-text-secondary">Sem eventos.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-text-secondary border-b border-border-default">
                <th className="p-2">Papel</th><th className="p-2">Provider/Model</th><th className="p-2">Resultado</th><th className="p-2">Latência (ms)</th><th className="p-2">Tokens (in/out)</th><th className="p-2">Custo</th>
              </tr>
            </thead>
            <tbody>
              {telemetry.map((t) => (
                <tr key={t.id} className="border-b border-border-default last:border-0">
                  <td className="p-2 text-text-primary">{t.role}</td>
                  <td className="p-2 text-text-secondary">{t.provider}:{t.model}</td>
                  <td className="p-2">{t.result}</td>
                  <td className="p-2 text-text-secondary">{t.latency_ms ?? '—'}</td>
                  <td className="p-2 text-text-secondary">{t.input_tokens ?? '—'}/{t.output_tokens ?? '—'}</td>
                  <td className="p-2 text-text-secondary">{t.estimated_cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default EngineeringTaskDetailPage;
