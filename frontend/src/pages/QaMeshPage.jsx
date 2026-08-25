import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';
import { Button } from '../styles/Button';
import { CrudPageBase } from '../modules/crud-base';
import { Dialog } from '../components/Dialog';
import { ReplayPlayer, normalizeReplaySteps, normalizeTypedEntries, normalizeAssertions } from '../components/replay';
import { getRpaReplay } from '../api/flows';
import * as qaMeshApi from '../api/qaMesh';

// Opções de frequência com rótulos amigáveis (nunca expõe a expressão cron).
const FREQUENCY_OPTIONS = [
  { key: '15min', label: 'A cada 15 minutos' },
  { key: '30min', label: 'A cada 30 minutos' },
  { key: '1h', label: 'A cada 1 hora' },
  { key: '2h', label: 'A cada 2 horas' },
  { key: '6h', label: 'A cada 6 horas' },
  { key: '12h', label: 'A cada 12 horas' },
  { key: 'daily', label: 'Uma vez por dia' },
];

const STATUS_LABELS = {
  GO: 'GO',
  NO_GO: 'NO GO',
  passed: 'aprovado',
  failed: 'falhou',
  skipped: 'ignorado',
  infra_error: 'erro de infra',
  environment_missing: 'ambiente ausente',
  pipeline_required: 'exige pipeline',
  flaky: 'instável',
  completed: 'concluído',
  running: 'em execução',
  queued: 'na fila',
  'N/A': 'n/d',
};

const CRITICALITY_LABELS = {
  blocking: 'bloqueante',
  critical: 'crítica',
  high: 'alta',
  medium: 'média',
  low: 'baixa',
};

const TYPE_LABELS = {
  regression: 'regressão',
  smoke: 'fumaça',
  unit: 'unitário',
  integration: 'integração',
};

function StatusBadge({ value }) {
  const palette = {
    GO: 'border border-status-success/20 bg-status-success/10 text-status-success',
    NO_GO: 'border border-status-error/20 bg-status-error/10 text-status-error',
    passed: 'border border-status-success/20 bg-status-success/10 text-status-success',
    failed: 'border border-status-error/20 bg-status-error/10 text-status-error',
    skipped: 'border border-status-warning/20 bg-status-warning/10 text-status-warning',
    infra_error: 'border border-status-warning/20 bg-status-warning/10 text-status-warning',
    environment_missing: 'border border-status-warning/20 bg-status-warning/10 text-status-warning',
    pipeline_required: 'border border-status-warning/20 bg-status-warning/10 text-status-warning',
    flaky: 'border border-accent-primary/20 bg-accent-primary/10 text-accent-hover',
    completed: 'border border-status-success/20 bg-status-success/10 text-status-success',
    running: 'border border-status-info/20 bg-status-info/10 text-status-info',
    queued: 'border border-border-default bg-text-secondary/10 text-text-secondary',
    'N/A': 'border border-border-default bg-text-secondary/10 text-text-secondary',
  };
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${palette[value] || palette['N/A']}`}>
      {STATUS_LABELS[value] || value}
    </span>
  );
}

function OriginBadge({ value }) {
  const palette = {
    pipeline: 'border border-status-success/20 bg-status-success/10 text-status-success',
    scheduler: 'border border-status-info/20 bg-status-info/10 text-status-info',
    manual_run: 'border border-border-default bg-text-secondary/10 text-text-secondary',
    manual_replay: 'border border-accent-primary/20 bg-accent-primary/10 text-accent-hover',
    unknown: 'border border-border-default bg-text-secondary/10 text-text-secondary',
    'N/A': 'border border-border-default bg-text-secondary/10 text-text-secondary',
  };

  const labels = {
    pipeline: 'pipeline oficial',
    scheduler: 'agendada',
    manual_run: 'manual',
    manual_replay: 'replay',
    unknown: 'origem indefinida',
    'N/A': 'n/d',
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${palette[value] || palette['N/A']}`}>
      {labels[value] || value}
    </span>
  );
}

function isPipelineRequiredResult(result) {
  if (!result) return false;
  if (result.failureType === 'pipeline_required') return true;

  const details = [
    result.errorMessage,
    ...(result.errors || []).map((item) => item?.error || item?.message || item),
    ...(result.logs || []).map((item) => item?.message || item),
  ]
    .filter(Boolean)
    .join(' | ')
    .toLowerCase();

  return details.includes('exige o pipeline oficial') || details.includes('execute: npm run pipeline');
}

function getDisplayStatus(result) {
  if (isPipelineRequiredResult(result)) return 'pipeline_required';
  return result?.status || 'N/A';
}

function getDisplayFailureType(result) {
  if (isPipelineRequiredResult(result)) return 'bloqueio_operacional_pipeline';
  return result?.failureType || 'n/d';
}

function getPipelineBlockedSummaryCount(execution) {
  if (!execution) return 0;
  const explicitCount = execution.summary?.pipelineBlocked;
  if (Number.isFinite(explicitCount)) return explicitCount;
  const summaryCount = execution.summary?.failuresByType?.pipeline_required;
  if (Number.isFinite(summaryCount)) return summaryCount;
  const results = Array.isArray(execution.results) ? execution.results : [];
  return results.filter((item) => isPipelineRequiredResult(item)).length;
}

function getExecutionOrigin(execution) {
  return execution?.executionOrigin || execution?.summary?.executionOrigin || 'unknown';
}

function isOfficialPipelineExecution(execution) {
  return execution?.isCanonicalExecution === true && getExecutionOrigin(execution) === 'pipeline';
}

function getHistoryDisplayPath(execution) {
  return execution?.historyPath || 'n/d';
}

function formatTimestamp(value) {
  if (!value) return 'n/d';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function QaMeshPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const [registry, setRegistry] = useState([]);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [officialHistory, setOfficialHistory] = useState([]);
  const [officialReference, setOfficialReference] = useState(null);
  const [scheduler, setScheduler] = useState(null);
  const [executionStatus, setExecutionStatus] = useState(null);
  const [viewMode, setViewMode] = useState('all');
  const [filters, setFilters] = useState({
    domain: 'all',
    status: 'all',
    criticality: 'all',
  });
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [schedulerBusy, setSchedulerBusy] = useState(false);
  const [frequencyKey, setFrequencyKey] = useState('15min');
  const [expandedScenarioId, setExpandedScenarioId] = useState(null);
  const [replayModal, setReplayModal] = useState(null);
  const [replayData, setReplayData] = useState(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState(null);
  const [replayFullscreen, setReplayFullscreen] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate('/login');
  }, [authLoading, isAuthenticated, navigate]);

  const refreshAll = async (nextFilters = filters) => {
    setLoading(true);
    try {
      const [registryData, latestData, historyData, officialHistoryData, officialReferenceData, schedulerData] = await Promise.all([
        qaMeshApi.getQaMeshRegistry(),
        qaMeshApi.getQaMeshLatest().catch(() => null),
        qaMeshApi.getQaMeshHistory({ limit: 10, domain: nextFilters.domain === 'all' ? undefined : nextFilters.domain }),
        qaMeshApi.getQaMeshHistory({ limit: 10, domain: nextFilters.domain === 'all' ? undefined : nextFilters.domain, officialOnly: true }),
        qaMeshApi.getQaMeshOfficialReference().catch(() => null),
        qaMeshApi.getQaMeshScheduler(),
      ]);
      setRegistry(registryData.scenarios || []);
      setLatest(latestData);
      setHistory(historyData.results || []);
      setOfficialHistory(officialHistoryData.results || []);
      setOfficialReference(officialReferenceData);
      setScheduler(schedulerData);
      if (schedulerData?.frequency?.key) setFrequencyKey(schedulerData.frequency.key);
      if (!executionStatus && latestData) {
        setExecutionStatus(latestData);
      }
    } catch (error) {
      showToast(error.message || 'Erro ao carregar QA Mesh', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      refreshAll(filters);
    }
  }, [authLoading, isAuthenticated, filters.domain]);

  // WebSocket: acompanha a execução em tempo real (sem polling REST).
  // O payload do evento usa status público (success/failed/processing);
  // a página trabalha com completed/failed/running/queued.
  const executionStatusRef = useRef(null);
  useEffect(() => {
    executionStatusRef.current = executionStatus;
  }, [executionStatus]);

  const handleMeshWsEvent = useCallback((eventName, payload) => {
    if (eventName !== 'qa-waves.execution.updated') return;
    const current = executionStatusRef.current;
    if (!current?.executionId || payload?.executionId !== current.executionId) return;

    const statusMap = { success: 'completed', failed: 'failed', processing: 'running' };
    const nextStatus = statusMap[String(payload?.status || '').toLowerCase()] || current.status;
    setExecutionStatus({ ...current, ...payload, status: nextStatus });

    if (['completed', 'failed'].includes(nextStatus)) {
      refreshAll();
      setRunning(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useWebSocketContext({
    onEvent: handleMeshWsEvent,
    subscribeEvents: ['qa-waves.execution.updated'],
  });

  const domainOptions = useMemo(() => ['all', ...Array.from(new Set(registry.map((item) => item.domain))).sort()], [registry]);
  const criticalityOptions = useMemo(() => ['all', ...Array.from(new Set(registry.map((item) => item.criticality))).sort()], [registry]);
  const statusOptions = [
    { value: 'all', label: 'Todos' },
    { value: 'passed', label: 'Aprovados' },
    { value: 'failed', label: 'Falharam' },
    { value: 'infra_error', label: 'Erro de infra' },
    { value: 'environment_missing', label: 'Ambiente ausente' },
    { value: 'pipeline_required', label: 'Exige pipeline' },
    { value: 'flaky', label: 'Instáveis' },
    { value: 'skipped', label: 'Ignorados' },
  ];

  const latestOfficial = officialReference?.execution || officialHistory[0] || null;
  const officialExecutionId = officialReference?.executionId || latestOfficial?.executionId || null;
  const officialHistoryPath = officialReference?.historyPath || latestOfficial?.historyPath || null;
  const activeExecution = viewMode === 'official'
    ? latestOfficial
    : (executionStatus?.results ? executionStatus : latest);
  const activeStatusValue = viewMode === 'official'
    ? activeExecution?.summary?.goNoGo || 'N/A'
    : (executionStatus?.status || activeExecution?.summary?.goNoGo || 'N/A');
  const activeProgressValue = viewMode === 'official'
    ? (activeExecution ? 100 : 0)
    : (executionStatus?.progress ?? 100);
  const scenarioResults = activeExecution?.results || [];
  const pipelineBlockedCount = scenarioResults.filter((item) => isPipelineRequiredResult(item)).length;
  const topErrors = activeExecution?.summary?.topErrors || [];
  const repairRanking = activeExecution?.repairPlan?.orderedFixList || [];
  const visibleHistory = viewMode === 'official' ? officialHistory : history;
  const evolution = visibleHistory.slice(0, 6);

  // Último resultado POR cenário no histórico (mesma regra "último resultado
  // vence" do coverage gate). A lista não pode depender só da "última execução"
  // — que às vezes é um smoke pequeno (workspace-core) sem os demais cenários,
  // o que deixava tudo "N/A" mesmo com o cenário validado no run canônico.
  const scenarioResultsMap = useMemo(() => {
    const map = {};
    // Execução em andamento (WebSocket) tem prioridade máxima (mais recente).
    for (const result of (executionStatus?.results || [])) {
      if (result?.id) map[result.id] = result;
    }
    const sources = viewMode === 'official' ? officialHistory : history;
    for (const entry of sources) {
      for (const result of (entry?.results || [])) {
        if (result?.id && !map[result.id]) map[result.id] = result;
      }
    }
    // Referência oficial (run canônico, 131 cenários) é o fallback autoritativo.
    // O canônico fica fora da janela de histórico recente (MAX_HISTORY_FILES=5),
    // então sem ele os cenários não-blocking apareceriam "N/A" mesmo validados.
    for (const result of (officialReference?.execution?.results || [])) {
      if (result?.id && !map[result.id]) map[result.id] = result;
    }
    return map;
  }, [history, officialHistory, executionStatus, officialReference, viewMode]);

  const filteredRegistry = useMemo(() => {
    return registry.filter((scenario) => {
      if (filters.domain !== 'all' && scenario.domain !== filters.domain) return false;
      if (filters.criticality !== 'all' && scenario.criticality !== filters.criticality) return false;
      if (filters.status !== 'all') {
        const result = scenarioResultsMap[scenario.id];
        if (getDisplayStatus(result) !== filters.status) return false;
      }
      return true;
    });
  }, [registry, filters, scenarioResultsMap]);

  const canRun = agent?.role === 'admin' || agent?.role === 'supervisor';

  const copyText = async (value, label) => {
    if (!value) {
      showToast(`Nada para copiar em ${label}`, 'error');
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement('textarea');
        input.value = value;
        input.setAttribute('readonly', 'true');
        input.style.position = 'absolute';
        input.style.left = '-9999px';
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        document.body.removeChild(input);
      }
      showToast(`${label} copiado`, 'success');
    } catch (_) {
      showToast(`Falha ao copiar ${label}`, 'error');
    }
  };

  const startExecution = async (runner) => {
    try {
      setRunning(true);
      const queued = await runner();
      setExecutionStatus({
        executionId: queued.executionId,
        status: queued.status,
        progress: 0,
        results: [],
      });
      showToast(`Execução enfileirada: ${queued.executionId}`, 'success');
    } catch (error) {
      setRunning(false);
      showToast(error.message || 'Erro ao enfileirar execução', 'error');
    }
  };

  const handleRun = async () => {
    await startExecution(() => qaMeshApi.runQaMesh({
      domain: filters.domain === 'all' ? undefined : filters.domain,
      criticality: filters.criticality === 'all' ? undefined : filters.criticality,
    }));
  };

  const handleReplay = async (scenario) => {
    setReplayModal(scenario);
    setReplayData(null);
    setReplayError(null);
    setReplayLoading(true);
    try {
      const data = await getRpaReplay(`${scenario.id}.json`);
      setReplayData(data || null);
    } catch (error) {
      setReplayError(error?.message || 'Falha ao carregar o replay');
    } finally {
      setReplayLoading(false);
    }
  };

  const replaySteps = useMemo(() => normalizeReplaySteps(replayData), [replayData]);
  const replayTyped = useMemo(() => normalizeTypedEntries(replayData), [replayData]);
  const replayAssertions = useMemo(() => normalizeAssertions(replayData), [replayData]);

  const applyScheduler = async (enabled, nextFrequencyKey) => {
    setSchedulerBusy(true);
    try {
      const updated = await qaMeshApi.setQaMeshScheduler(enabled, nextFrequencyKey);
      setScheduler(updated);
      if (updated?.frequency?.key) setFrequencyKey(updated.frequency.key);
      showToast(enabled ? 'Verificação automática atualizada' : 'Verificação automática desligada', 'success');
    } catch (error) {
      showToast(error.message || 'Erro ao alterar a verificação automática', 'error');
    } finally {
      setSchedulerBusy(false);
    }
  };

  const handleToggleScheduler = () => {
    if (scheduler == null) return;
    applyScheduler(!scheduler.enabled, frequencyKey);
  };

  const handleFrequencyChange = (event) => {
    const nextKey = event.target.value;
    setFrequencyKey(nextKey);
    applyScheduler(true, nextKey);
  };

  if (authLoading || loading) {
    return (
      <CrudPageBase>
        <div className="flex min-h-[60vh] items-center justify-center text-text-secondary">Carregando QA Mesh...</div>
        <ToastContainer />
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <section className="mb-6 rounded-2xl border border-border-default bg-bg-elevated p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-accent-hover">QA Mesh</div>
            <h1 className="mt-2 text-3xl font-bold text-text-primary">Malha Unificada de Execução</h1>
            <p className="mt-2 text-sm text-text-secondary">
              Operação unificada de QA + RPA com execução assíncrona, replay universal e gate real.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => refreshAll()}>Atualizar</Button>
            {canRun ? (
              <Button onClick={handleRun} disabled={running}>
                {running ? 'Executando...' : 'Executar Malha'}
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-status-warning/20 bg-status-warning/10 p-4 text-sm text-text-primary">
        <div className="font-semibold uppercase tracking-wider text-status-warning">Leitura operacional</div>
        <div className="mt-2">
          {viewMode === 'official'
            ? 'Esta visão mostra apenas execuções marcadas como pipeline oficial. Use-a para ler a evidência canônica de validate/release.'
            : 'Esta tela combina histórico e monitoramento contínuo do QA Mesh. Execuções agendadas servem como sinal operacional de regressão. A evidência oficial para validate/release continua sendo o pipeline canônico.'}
        </div>
      </section>

      <section className="mb-6 flex flex-wrap gap-2">
        <Button onClick={() => setViewMode('all')} disabled={viewMode === 'all'}>Visão mista</Button>
        <Button onClick={() => setViewMode('official')} disabled={viewMode === 'official'}>Apenas pipeline oficial</Button>
      </section>

      <section className="mb-6 rounded-xl border border-border-default bg-bg-elevated p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-text-primary">Verificação automática</div>
            <div className="text-sm text-text-secondary">
              A plataforma reexecuta os testes importantes sozinha, de tempos em tempos.
              Deixe ligado apenas durante o desenvolvimento ou ao investigar um problema.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${scheduler?.enabled ? 'border-status-success/20 bg-status-success/10 text-status-success' : 'border-border-default bg-text-secondary/10 text-text-secondary'}`}>
              <span className={`h-2 w-2 rounded-full ${scheduler?.enabled ? 'bg-status-success' : 'bg-text-secondary'}`} />
              {scheduler?.enabled ? 'Ligada' : 'Desligada'}
            </span>
            <Button onClick={handleToggleScheduler} disabled={schedulerBusy || scheduler == null}>
              {schedulerBusy ? 'Aplicando...' : (scheduler?.enabled ? 'Desligar' : 'Ligar')}
            </Button>
          </div>
        </div>

        {scheduler?.enabled ? (
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <label htmlFor="scheduler-frequency" className="mb-2 block text-sm font-medium text-text-primary">
              Com que frequência os testes devem rodar?
            </label>
            <select
              id="scheduler-frequency"
              value={frequencyKey}
              onChange={handleFrequencyChange}
              disabled={schedulerBusy}
              className="rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm text-text-primary"
            >
              {FREQUENCY_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-text-secondary">
              Atual: {scheduler?.frequency?.label || 'A cada 15 minutos'} · Última verificação: {scheduler?.lastExecution?.at ? scheduler.lastExecution.at : 'ainda não houve'}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-default bg-bg-primary p-3 text-sm text-text-secondary">
            Verificação automática desligada. Os testes não serão executados sozinhos.
          </div>
        )}
      </section>

      <section className="mb-6 grid gap-4 md:grid-cols-6">
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Gate da execução observada</div>
          <div className="mt-2"><StatusBadge value={activeExecution?.summary?.goNoGo || 'N/A'} /></div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Cobertura</div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">
            {Math.round((activeExecution?.summary?.executionCoverage || 0) * 100)}%
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Qualidade</div>
          <div className="mt-2 text-sm font-semibold text-text-primary">{activeExecution?.summary?.executionQuality || 'n/d'}</div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Tentados</div>
          <div className="mt-2 text-2xl font-semibold text-text-primary">{activeExecution?.summary?.attempted ?? 0}</div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Falhas críticas</div>
          <div className="mt-2 text-2xl font-semibold text-status-error">
            {scenarioResults.filter((item) => item.criticality === 'blocking' && item.status !== 'passed').length}
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Bloqueios pipeline</div>
          <div className={`mt-2 text-2xl font-semibold ${pipelineBlockedCount > 0 ? 'text-status-warning' : 'text-text-primary'}`}>
            {pipelineBlockedCount}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-status-success/20 bg-status-success/10 p-4 text-sm text-text-primary">
        <div className="text-xs font-semibold uppercase tracking-wider text-status-success">Referência oficial atual</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-status-success/20 bg-bg-primary p-3">
            <div className="text-xs uppercase text-status-success">ID da execução oficial</div>
            <div className="mt-2 break-all font-mono text-sm text-text-primary">{officialExecutionId || 'nenhuma execução oficial identificada'}</div>
            <div className="mt-3">
              <Button onClick={() => copyText(officialExecutionId, 'ID da execução oficial')} disabled={!officialExecutionId}>Copiar ID da execução</Button>
            </div>
          </div>
          <div className="rounded-lg border border-status-success/20 bg-bg-primary p-3">
            <div className="text-xs uppercase text-status-success">Histórico correspondente</div>
            <div className="mt-2 break-all font-mono text-sm text-text-primary">{officialHistoryPath || 'aguardando execução oficial marcada'}</div>
            <div className="mt-3">
              <Button onClick={() => copyText(officialHistoryPath, 'histórico oficial')} disabled={!officialHistoryPath}>Copiar histórico</Button>
            </div>
          </div>
          <div className="rounded-lg border border-status-success/20 bg-bg-primary p-3">
            <div className="text-xs uppercase text-status-success">Como ler</div>
            <div className="mt-2 text-sm text-text-primary">
              Use este ID de execução como referência canônica. Execuções fora desta trilha continuam visíveis apenas como sinal operacional.
            </div>
            <div className="mt-3 text-xs text-text-secondary">
              gate oficial: {officialReference?.gate || 'n/d'}
            </div>
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="mb-2 text-lg font-semibold text-text-primary">Ranking de falhas</div>
          <div className="space-y-2 text-sm">
            {repairRanking.slice(0, 5).map((item) => (
              <div key={item.scenarioId} className="rounded-lg border border-border-default bg-bg-primary p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-text-primary">{item.scenarioId}</div>
                  <StatusBadge value={item.status} />
                </div>
                <div className="mt-1 text-text-secondary">
                  {item.domain} | {item.failureType} | prioridade {item.priority}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="mb-2 text-lg font-semibold text-text-primary">Top erros</div>
          <div className="space-y-2 text-sm text-text-secondary">
            {topErrors.slice(0, 5).map((item) => (
              <div key={item.message} className="rounded-lg border border-border-default bg-bg-primary p-3">
                <div className="font-medium text-text-primary">{item.count}x</div>
                <div>{item.message}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="mb-2 text-lg font-semibold text-text-primary">Evolução</div>
          <div className="space-y-2 text-sm">
            {evolution.map((item) => (
              <div key={item.executionId} className="rounded-lg border border-border-default bg-bg-primary p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-text-primary">{Math.round(((item.summary?.passed || 0) / Math.max(item.summary?.total || 1, 1)) * 100)}%</div>
                  <StatusBadge value={item.summary?.goNoGo || 'N/A'} />
                </div>
                <div className="mt-1 text-text-secondary">
                  {item.executionId}
                </div>
                {getPipelineBlockedSummaryCount(item) > 0 ? (
                  <div className="mt-2 text-xs font-medium uppercase tracking-wider text-status-warning">
                    bloqueio de pipeline: {getPipelineBlockedSummaryCount(item)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-border-default bg-bg-elevated p-4">
        <div className="mb-3 text-lg font-semibold text-text-primary">
          {viewMode === 'official' ? 'Última execução oficial do pipeline' : 'Última execução observada'}
        </div>
        {viewMode === 'official' && !activeExecution ? (
          <div className="rounded-lg border border-dashed border-border-default bg-bg-primary p-4 text-sm text-text-secondary">
            Ainda não há execução marcada como pipeline oficial no histórico desta tela.
          </div>
        ) : null}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Status</div>
            <div className="mt-2"><StatusBadge value={activeStatusValue} /></div>
          </div>
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Progresso</div>
            <div className="mt-2 text-2xl font-semibold text-text-primary">{activeProgressValue}%</div>
          </div>
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Origem</div>
            <div className="mt-2"><OriginBadge value={getExecutionOrigin(activeExecution) || 'N/A'} /></div>
          </div>
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Canônica</div>
            <div className="mt-2 text-sm font-semibold text-text-primary">{isOfficialPipelineExecution(activeExecution) ? 'sim' : 'não'}</div>
          </div>
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Razões</div>
            <div className="mt-2 text-sm text-text-primary">{(activeExecution?.summary?.reasons || []).join(', ') || 'sem bloqueios'}</div>
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-border-default bg-bg-elevated p-4">
        <div className="mb-3 flex flex-wrap gap-3">
          <select
            value={filters.domain}
            onChange={(event) => setFilters((prev) => ({ ...prev, domain: event.target.value }))}
            className="rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm"
          >
            {domainOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            value={filters.status}
            onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
            className="rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm"
          >
            {statusOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <select
            value={filters.criticality}
            onChange={(event) => setFilters((prev) => ({ ...prev, criticality: event.target.value }))}
            className="rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm"
          >
            {criticalityOptions.map((item) => <option key={item} value={item}>{item === 'all' ? 'Todos' : CRITICALITY_LABELS[item] || item}</option>)}
          </select>
        </div>

        <div className="space-y-3">
          {filteredRegistry.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-default bg-bg-primary p-4 text-sm text-text-secondary">
              Nenhum cenário corresponde aos filtros atuais.
            </div>
          ) : null}
          {filteredRegistry.map((scenario) => {
            const result = scenarioResultsMap[scenario.id];
            const isCriticalFailure = scenario.criticality === 'blocking' && result && result.status !== 'passed';
            const isExpanded = expandedScenarioId === scenario.id;
            return (
              <div key={scenario.id} className={`rounded-lg border p-4 ${isCriticalFailure ? 'border-status-error/30 bg-status-error/10' : 'border-border-default bg-bg-primary'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-text-primary">{scenario.flow}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full border border-border-default bg-text-secondary/10 px-2 py-0.5 text-xs text-text-secondary">{scenario.domain}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${scenario.criticality === 'blocking' ? 'border-status-error/20 bg-status-error/10 text-status-error' : 'border-border-default bg-text-secondary/10 text-text-secondary'}`}>
                        {CRITICALITY_LABELS[scenario.criticality] || scenario.criticality}
                      </span>
                      <span className="rounded-full border border-border-default bg-text-secondary/10 px-2 py-0.5 text-xs text-text-secondary">{TYPE_LABELS[scenario.type] || scenario.type}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge value={getDisplayStatus(result)} />
                    <Button onClick={() => handleReplay(scenario)}>
                      Replay
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => setExpandedScenarioId(isExpanded ? null : scenario.id)}
                    className="text-xs font-medium text-accent-hover hover:underline"
                  >
                    {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                  </button>
                </div>

                {isExpanded ? (
                  <div className="mt-3 space-y-2 rounded-md border border-border-default bg-bg-secondary/40 p-3 text-sm">
                    <div className="font-mono text-xs text-text-secondary">id: {scenario.id}</div>
                    {scenario.assertions?.length ? (
                      <div className="text-text-secondary">Assertions: {(scenario.assertions || []).join(', ')}</div>
                    ) : null}
                    {result ? (
                      <>
                        <div className="text-text-secondary">
                          {formatTimestamp(result.startedAt)} → {formatTimestamp(result.finishedAt)}
                        </div>
                        {getDisplayStatus(result) !== 'passed' ? (
                          <>
                            {result.failureType || isPipelineRequiredResult(result) ? (
                              <div className="text-text-secondary">
                                Tipo de falha: {getDisplayFailureType(result)}{result.rootCauseHint ? ` · Causa: ${result.rootCauseHint}` : ''}
                              </div>
                            ) : null}
                            {isPipelineRequiredResult(result) ? (
                              <div className="text-status-warning">Falha operacional: a execução foi barrada por exigir o pipeline oficial.</div>
                            ) : null}
                            {result.errorMessage ? <div className="text-status-error">Erro: {result.errorMessage}</div> : null}
                            {result.logs?.length || result.errors?.length ? (
                              <details className="rounded-md bg-bg-secondary p-2">
                                <summary className="cursor-pointer text-xs text-text-secondary">Log técnico ({(result.logs || []).length} linhas)</summary>
                                <div className="mt-2 space-y-1 font-mono text-xs text-text-primary">
                                  {(result.logs || []).slice(0, 8).map((log, index) => (
                                    <div key={`${result.id}-${index}`}>{log.message || JSON.stringify(log)}</div>
                                  ))}
                                  {result.errors?.length ? (
                                    <div className="text-status-error">{result.errors.map((item) => item.error || item).join(' | ')}</div>
                                  ) : null}
                                </div>
                              </details>
                            ) : null}
                          </>
                        ) : null}
                        {result.artifacts?.length ? (
                          <div className="text-text-secondary">
                            Evidência: {(result.artifacts || []).map((item) => (item?.path ? item.path.split('/').pop() : null)).filter(Boolean).join(', ')}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="text-text-secondary">Sem execução registrada para este cenário.</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-border-default bg-bg-elevated p-4">
        <div className="mb-3 text-lg font-semibold text-text-primary">
          {viewMode === 'official' ? 'Histórico do pipeline oficial' : 'Histórico'}
        </div>
        <div className="space-y-3">
          {visibleHistory.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-default bg-bg-primary p-4 text-sm text-text-secondary">
              {viewMode === 'official'
                ? 'Nenhuma execução oficial do pipeline encontrada no histórico filtrado.'
                : 'Nenhuma execução encontrada no histórico filtrado.'}
            </div>
          ) : null}
          {visibleHistory.map((item) => (
            <div key={item.executionId} className="rounded-lg border border-border-default bg-bg-primary p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-text-primary">{item.executionId}</div>
                  <div className="text-xs text-text-secondary">{item.startedAt}</div>
                </div>
                <div className="flex items-center gap-2">
                  <OriginBadge value={getExecutionOrigin(item)} />
                  <StatusBadge value={item.summary?.goNoGo || 'N/A'} />
                </div>
              </div>
              <div className="mt-2 text-sm text-text-secondary">
                cobertura {Math.round((item.summary?.executionCoverage || 0) * 100)}% | tentados {item.summary?.attempted ?? 0} | falhas {item.summary?.failed ?? 0}
              </div>
              <div className="mt-2 text-xs text-text-secondary">
                canônica: {isOfficialPipelineExecution(item) ? 'sim' : 'não'}
              </div>
              <div className="mt-1 break-all text-xs text-text-secondary">
                histórico: {getHistoryDisplayPath(item)}
              </div>
              {getPipelineBlockedSummaryCount(item) > 0 ? (
                <div className="mt-2 inline-flex rounded-full border border-status-warning/20 bg-status-warning/10 px-3 py-1 text-xs font-semibold text-status-warning">
                  bloqueio de pipeline: {getPipelineBlockedSummaryCount(item)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <Dialog
        isOpen={Boolean(replayModal)}
        onClose={() => {
          setReplayModal(null);
          setReplayFullscreen(false);
        }}
        title={replayModal ? `Replay — ${replayModal.flow}` : 'Replay'}
        size={replayFullscreen ? 'full' : 'lg'}
        headerActions={
          <button
            type="button"
            onClick={() => setReplayFullscreen((prev) => !prev)}
            className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors duration-fast focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
            aria-label={replayFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={replayFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {replayFullscreen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3" />
              </svg>
            )}
          </button>
        }
      >
        {replayLoading ? (
          <div className="p-4 text-sm text-text-secondary">Carregando replay...</div>
        ) : replayError ? (
          <div className="space-y-3 p-4">
            <div className="text-sm text-status-error">{replayError}</div>
            <a
              href={`/rpa-replays?scenarioId=${encodeURIComponent(replayModal?.id || '')}`}
              className="inline-block text-sm text-accent-hover hover:underline"
            >
              Abrir em Replays RPA
            </a>
          </div>
        ) : (
          <ReplayPlayer
            steps={replaySteps}
            typedEntries={replayTyped}
            assertions={replayAssertions}
            title={replayModal?.flow || null}
          />
        )}
      </Dialog>
      <ToastContainer />
    </CrudPageBase>
  );
}
