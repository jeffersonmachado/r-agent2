import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
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

export function QaMeshPage() {
  const { isAuthenticated, loading: authLoading, agent } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const [registry, setRegistry] = useState([]);
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [scheduler, setScheduler] = useState(null);
  const [executionStatus, setExecutionStatus] = useState(null);
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
      const [registryData, latestData, historyData, schedulerData] = await Promise.all([
        qaMeshApi.getQaMeshRegistry(),
        qaMeshApi.getQaMeshLatest().catch(() => null),
        qaMeshApi.getQaMeshHistory({ limit: 10, domain: nextFilters.domain === 'all' ? undefined : nextFilters.domain }),
        qaMeshApi.getQaMeshScheduler(),
      ]);
      setRegistry(registryData.scenarios || []);
      setLatest(latestData);
      setHistory(historyData.results || []);
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
      refreshAll();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!executionStatus?.executionId) return undefined;
    if (!['queued', 'running'].includes(executionStatus.status)) return undefined;

    const timer = setInterval(async () => {
      try {
        const next = await qaMeshApi.getQaMeshExecutionStatus(executionStatus.executionId);
        setExecutionStatus(next);
        if (['completed', 'failed'].includes(next.status)) {
          await refreshAll();
          setRunning(false);
        }
      } catch (_) {
        // Mantém polling discreto.
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [executionStatus?.executionId, executionStatus?.status]);

  const domainOptions = useMemo(() => ['all', ...Array.from(new Set(registry.map((item) => item.domain))).sort()], [registry]);
  const criticalityOptions = useMemo(() => ['all', ...Array.from(new Set(registry.map((item) => item.criticality))).sort()], [registry]);
  const statusOptions = ['all', 'passed', 'failed', 'infra_error', 'environment_missing', 'flaky', 'skipped'];

  const activeExecution = executionStatus?.results ? executionStatus : latest;
  const scenarioResults = activeExecution?.results || [];
  const topErrors = activeExecution?.summary?.topErrors || [];
  const repairRanking = activeExecution?.repairPlan?.orderedFixList || [];
  const evolution = history.slice(0, 6);

  const filteredRegistry = useMemo(() => {
    return registry.filter((scenario) => {
      if (filters.domain !== 'all' && scenario.domain !== filters.domain) return false;
      if (filters.criticality !== 'all' && scenario.criticality !== filters.criticality) return false;
      if (filters.status !== 'all') {
        const result = scenarioResults.find((item) => item.id === scenario.id);
        if ((result?.status || 'not_run') !== filters.status) return false;
      }
      return true;
    });
  }, [registry, filters, scenarioResults]);

  const canRun = agent?.role === 'admin' || agent?.role === 'supervisor';

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

      <section className="mb-6 grid gap-4 md:grid-cols-5">
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-xs uppercase text-text-secondary">Go / No-Go</div>
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
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mb-6 rounded-xl border border-border-default bg-bg-elevated p-4">
        <div className="mb-3 text-lg font-semibold text-text-primary">Execução atual</div>
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Status</div>
            <div className="mt-2"><StatusBadge value={executionStatus?.status || activeExecution?.summary?.goNoGo || 'N/A'} /></div>
          </div>
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Progresso</div>
            <div className="mt-2 text-2xl font-semibold text-text-primary">{executionStatus?.progress ?? 100}%</div>
          </div>
          <div className="rounded-lg border border-border-default bg-bg-primary p-3">
            <div className="text-xs uppercase text-text-secondary">Scheduler</div>
            <div className="mt-2 text-sm text-text-primary">{scheduler?.nextRuns?.critical || 'n/d'}</div>
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
          {filteredRegistry.map((scenario) => {
            const result = scenarioResults.find((item) => item.id === scenario.id);
            const isCriticalFailure = scenario.criticality === 'blocking' && result && result.status !== 'passed';
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
                    <StatusBadge value={result?.status || 'N/A'} />
                    <Button onClick={() => handleReplay(scenario.id)} disabled={running}>
                      Reproduzir cenário
                    </Button>
                  </div>
                </div>
                <div className="mt-2 text-sm text-text-secondary">
                  Assertions: {(scenario.assertions || []).join(', ') || 'n/d'}
                </div>
                {result ? (
                  <>
                    <div className="mt-2 text-sm text-text-primary">
                      Início: {result.startedAt} | Fim: {result.finishedAt}
                    </div>
                    <div className="mt-2 text-sm text-text-secondary">
                      Tipo: {result.failureType || 'n/d'} | Causa provável: {result.rootCauseHint || 'n/d'}
                    </div>
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
                      <Button onClick={() => handleReplay(scenario.id)} disabled={running}>
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
        <div className="mb-3 text-lg font-semibold text-text-primary">Histórico</div>
        <div className="space-y-3">
          {history.map((item) => (
            <div key={item.executionId} className="rounded-lg border border-border-default bg-bg-primary p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-text-primary">{item.executionId}</div>
                  <div className="text-xs text-text-secondary">{item.startedAt}</div>
                </div>
                <StatusBadge value={item.summary?.goNoGo || 'N/A'} />
              </div>
              <div className="mt-2 text-sm text-text-secondary">
                coverage {Math.round((item.summary?.executionCoverage || 0) * 100)}% | attempted {item.summary?.attempted ?? 0} | failed {item.summary?.failed ?? 0}
              </div>
            </div>
          ))}
        </div>
      </section>
      <ToastContainer />
    </CrudPageBase>
  );
}
