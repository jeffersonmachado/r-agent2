import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { useWebSocketContext } from '../context/WebSocketContext';
import { Button } from '../styles/Button';
import { CrudPageBase } from '../modules/crud-base';
import * as qaMeshApi from '../api/qaMesh';

function StatusBadge({ value }) {
  const palette = {
    GO: 'bg-green-100 text-green-800',
    NO_GO: 'bg-red-100 text-red-800',
    passed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    skipped: 'bg-yellow-100 text-yellow-800',
    infra_error: 'bg-orange-100 text-orange-800',
    environment_missing: 'bg-amber-100 text-amber-800',
    pipeline_required: 'bg-amber-100 text-amber-800',
    flaky: 'bg-fuchsia-100 text-fuchsia-800',
    completed: 'bg-green-100 text-green-800',
    running: 'bg-blue-100 text-blue-800',
    queued: 'bg-slate-100 text-slate-700',
    'N/A': 'bg-slate-100 text-slate-700',
  };
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${palette[value] || palette['N/A']}`}>
      {value}
    </span>
  );
}

function OriginBadge({ value }) {
  const palette = {
    pipeline: 'bg-emerald-100 text-emerald-800',
    scheduler: 'bg-sky-100 text-sky-800',
    manual_run: 'bg-slate-100 text-slate-700',
    manual_replay: 'bg-violet-100 text-violet-800',
    unknown: 'bg-slate-100 text-slate-700',
    'N/A': 'bg-slate-100 text-slate-700',
  };

  const labels = {
    pipeline: 'pipeline oficial',
    scheduler: 'agendada',
    manual_run: 'manual UI',
    manual_replay: 'replay UI',
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
  const statusOptions = ['all', 'passed', 'failed', 'infra_error', 'environment_missing', 'pipeline_required', 'flaky', 'skipped'];

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

  const filteredRegistry = useMemo(() => {
    return registry.filter((scenario) => {
      if (filters.domain !== 'all' && scenario.domain !== filters.domain) return false;
      if (filters.criticality !== 'all' && scenario.criticality !== filters.criticality) return false;
      if (filters.status !== 'all') {
        const result = scenarioResults.find((item) => item.id === scenario.id);
        if (getDisplayStatus(result) !== filters.status) return false;
      }
      return true;
    });
  }, [registry, filters, scenarioResults]);

  const canRun = agent?.role === 'admin' || agent?.role === 'supervisor';

  const replayBlockedReason = (scenario) => {
    if (!scenario?.requiresOfficialPipeline) return null;
    return 'Este cenário exige o pipeline oficial. Use npm run pipeline ou PIPELINE_BYPASS=1 fora da UI.';
  };

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

  const handleReplay = async (scenarioId) => {
    await startExecution(() => qaMeshApi.replayQaMeshScenario(scenarioId));
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
      <section className="mb-6 rounded-2xl border border-border-default bg-[linear-gradient(135deg,rgba(31,31,31,0.98),rgba(31,31,31,0.94)_58%,rgba(94,106,210,0.14))] p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-[#b7c2ff]">QA Mesh</div>
            <h1 className="mt-2 text-3xl font-bold text-text-primary">Unified Execution Mesh</h1>
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

      <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="font-semibold uppercase tracking-[0.16em] text-amber-800">Leitura operacional</div>
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
          <div className="mt-2 text-2xl font-semibold text-red-600">
            {scenarioResults.filter((item) => item.criticality === 'blocking' && item.status !== 'passed').length}
          </div>
        </div>
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Bloqueios pipeline</div>
          <div className={`mt-2 text-2xl font-semibold ${pipelineBlockedCount > 0 ? 'text-amber-700' : 'text-text-primary'}`}>
            {pipelineBlockedCount}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Referência oficial atual</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-emerald-200 bg-white/80 p-3">
            <div className="text-xs uppercase text-emerald-700">Execution ID oficial</div>
            <div className="mt-2 break-all font-mono text-sm text-emerald-950">{officialExecutionId || 'nenhuma execução oficial identificada'}</div>
            <div className="mt-3">
              <Button onClick={() => copyText(officialExecutionId, 'executionId oficial')} disabled={!officialExecutionId}>Copiar executionId</Button>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-white/80 p-3">
            <div className="text-xs uppercase text-emerald-700">Histórico correspondente</div>
            <div className="mt-2 break-all font-mono text-sm text-emerald-950">{officialHistoryPath || 'aguardando execução oficial marcada'}</div>
            <div className="mt-3">
              <Button onClick={() => copyText(officialHistoryPath, 'historyPath oficial')} disabled={!officialHistoryPath}>Copiar historyPath</Button>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-white/80 p-3">
            <div className="text-xs uppercase text-emerald-700">Como ler</div>
            <div className="mt-2 text-sm text-emerald-950">
              Use este executionId como referência canônica. Execuções fora desta trilha continuam visíveis apenas como sinal operacional.
            </div>
            <div className="mt-3 text-xs text-emerald-800">
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
                  <div className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-amber-700">
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
        {viewMode !== 'official' ? (
          <div className="mt-3 text-xs text-text-secondary">
            Scheduler ativo: {scheduler?.nextRuns?.critical || 'n/d'}
          </div>
        ) : null}
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
            {statusOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select
            value={filters.criticality}
            onChange={(event) => setFilters((prev) => ({ ...prev, criticality: event.target.value }))}
            className="rounded-md border border-border-default bg-bg-primary px-3 py-2 text-sm"
          >
            {criticalityOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div className="space-y-3">
          {filteredRegistry.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border-default bg-bg-primary p-4 text-sm text-text-secondary">
              Nenhum cenário corresponde aos filtros atuais.
            </div>
          ) : null}
          {filteredRegistry.map((scenario) => {
            const result = scenarioResults.find((item) => item.id === scenario.id);
            const isCriticalFailure = scenario.criticality === 'blocking' && result && result.status !== 'passed';
            const replayRestriction = replayBlockedReason(scenario);
            return (
              <div key={scenario.id} className={`rounded-lg border p-3 ${isCriticalFailure ? 'border-red-400 bg-red-50' : 'border-border-default bg-bg-primary'}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-text-primary">{scenario.flow}</div>
                    <div className="text-xs text-text-secondary">
                      {scenario.id} | {scenario.domain} | {scenario.type} | {scenario.criticality}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={getDisplayStatus(result)} />
                    <Button
                      onClick={() => handleReplay(scenario.id)}
                      disabled={running || Boolean(replayRestriction)}
                      title={replayRestriction || undefined}
                    >
                      Reproduzir cenário
                    </Button>
                  </div>
                </div>
                <div className="mt-2 text-sm text-text-secondary">
                  Assertions: {(scenario.assertions || []).join(', ') || 'n/d'}
                </div>
                {replayRestriction ? (
                  <div className="mt-2 text-sm text-amber-700">
                    Execução local bloqueada: este cenário só roda pelo pipeline oficial.
                  </div>
                ) : null}
                {result ? (
                  <>
                    <div className="mt-2 text-sm text-text-primary">
                      Início: {result.startedAt} | Fim: {result.finishedAt}
                    </div>
                    <div className="mt-2 text-sm text-text-secondary">
                      Tipo: {getDisplayFailureType(result)} | Causa provável: {result.rootCauseHint || 'n/d'}
                    </div>
                    {isPipelineRequiredResult(result) ? (
                      <div className="mt-2 text-sm text-amber-700">
                        Falha operacional: a execução foi barrada por exigir o pipeline oficial, antes do fluxo funcional ser validado.
                      </div>
                    ) : null}
                    <div className="mt-2 text-sm text-text-secondary">
                      Erro principal: {result.errorMessage || 'n/d'}
                    </div>
                    <div className="mt-2 text-sm text-text-secondary">
                      Artefatos: {(result.artifacts || []).map((item) => item.path).join(' | ') || 'n/d'}
                    </div>
                    <div className="mt-2 rounded-md bg-slate-950 p-3 font-mono text-xs text-slate-100">
                      {(result.logs || []).slice(0, 8).map((log, index) => (
                        <div key={`${result.id}-${index}`}>{log.message || JSON.stringify(log)}</div>
                      ))}
                      {(result.errors || []).length > 0 ? (
                        <div className="mt-2 text-red-300">{result.errors.map((item) => item.error || item).join(' | ')}</div>
                      ) : null}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        onClick={() => handleReplay(scenario.id)}
                        disabled={running || Boolean(replayRestriction)}
                        title={replayRestriction || undefined}
                      >
                        Corrigir e reexecutar
                      </Button>
                    </div>
                  </>
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
                coverage {Math.round((item.summary?.executionCoverage || 0) * 100)}% | attempted {item.summary?.attempted ?? 0} | failed {item.summary?.failed ?? 0}
              </div>
              <div className="mt-2 text-xs text-text-secondary">
                canônica: {isOfficialPipelineExecution(item) ? 'sim' : 'não'}
              </div>
              <div className="mt-1 break-all text-xs text-text-secondary">
                histórico: {getHistoryDisplayPath(item)}
              </div>
              {getPipelineBlockedSummaryCount(item) > 0 ? (
                <div className="mt-2 inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                  bloqueio de pipeline: {getPipelineBlockedSummaryCount(item)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </section>
      <ToastContainer />
    </CrudPageBase>
  );
}
