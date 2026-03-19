import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import {
  getOperationsSummary,
  getOperationsTimeline,
  getOperationsJobs,
  getOperationsNotifications,
  getOperationsInsights,
} from '../api/operationsDashboard';
import logger from '../utils/logger';

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'jobs', label: 'Scheduler / Jobs' },
  { id: 'notifications', label: 'Notificacoes' },
  { id: 'insights', label: 'Insights Operacionais' },
];

function statusBadgeClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'success' || value === 'sent') return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  if (value === 'failed') return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
  if (value === 'pending') return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
  if (value === 'provider-dependent') return 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40';
  if (value === 'skipped') return 'bg-slate-500/20 text-slate-300 border border-slate-500/40';
  return 'bg-slate-600/20 text-slate-200 border border-slate-500/40';
}

function cardNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return Intl.NumberFormat('pt-BR').format(n);
}

function isoTodayRange() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: now.toISOString().slice(0, 10),
  };
}

function FilterBar({ filters, onChange, onRefresh, loading }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-4 mb-4">
      <div className="grid gap-3 md:grid-cols-5">
        <div>
          <label className="block text-xs text-text-secondary mb-1">Tenant</label>
          <input
            className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
            value={filters.tenantId}
            placeholder="tenant opcional (super-admin)"
            onChange={(e) => onChange({ ...filters, tenantId: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">Vertical</label>
          <select
            className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
            value={filters.vertical}
            onChange={(e) => onChange({ ...filters, vertical: e.target.value })}
          >
            <option value="all">all</option>
            <option value="beauty">beauty</option>
            <option value="fitness">fitness</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">Inicio</label>
          <input
            type="date"
            className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
            value={filters.startDate}
            onChange={(e) => onChange({ ...filters, startDate: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">Fim</label>
          <input
            type="date"
            className="w-full bg-bg-tertiary border border-border-default rounded px-3 py-2 text-sm"
            value={filters.endDate}
            onChange={(e) => onChange({ ...filters, endDate: e.target.value })}
          />
        </div>
        <div className="flex items-end">
          <button
            className="w-full bg-accent-primary hover:bg-accent-hover text-white rounded px-3 py-2 text-sm disabled:opacity-50"
            onClick={onRefresh}
            disabled={loading}
          >
            {loading ? 'Atualizando...' : 'Atualizar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, subtitle }) {
  return (
    <div className="bg-bg-elevated border border-border-default rounded-xl p-4">
      <div className="text-xs text-text-secondary mb-1">{title}</div>
      <div className="text-2xl font-semibold text-text-primary">{cardNumber(value)}</div>
      {subtitle ? <div className="text-xs text-text-tertiary mt-1">{subtitle}</div> : null}
    </div>
  );
}

export function OperationsDashboardPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const initialRange = useMemo(() => isoTodayRange(), []);

  const [filters, setFilters] = useState({
    tenantId: '',
    vertical: 'all',
    startDate: initialRange.startDate,
    endDate: initialRange.endDate,
  });

  const [activeTab, setActiveTab] = useState('timeline');
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summary, setSummary] = useState(null);

  const [timelineQuery, setTimelineQuery] = useState({ subjectId: '', customerId: '', membershipId: '', status: '', page: 1, limit: 30 });
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineData, setTimelineData] = useState(null);

  const [jobsQuery, setJobsQuery] = useState({ status: '', page: 1, limit: 30 });
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsData, setJobsData] = useState(null);

  const [notificationsQuery, setNotificationsQuery] = useState({ status: '', channel: '', page: 1, limit: 30 });
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsData, setNotificationsData] = useState(null);

  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsData, setInsightsData] = useState(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  function baseParams() {
    return {
      tenantId: filters.tenantId || undefined,
      vertical: filters.vertical,
      startDate: filters.startDate,
      endDate: filters.endDate,
    };
  }

  async function loadSummary() {
    setLoadingSummary(true);
    try {
      const result = await getOperationsSummary(baseParams());
      setSummary(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadSummary failed', err);
      showToast('Erro ao carregar resumo do painel operacional', 'error');
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadTimeline() {
    setTimelineLoading(true);
    try {
      const result = await getOperationsTimeline({
        ...baseParams(),
        ...timelineQuery,
      });
      setTimelineData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadTimeline failed', err);
      showToast('Erro ao carregar timeline operacional', 'error');
    } finally {
      setTimelineLoading(false);
    }
  }

  async function loadJobs() {
    setJobsLoading(true);
    try {
      const result = await getOperationsJobs({
        ...baseParams(),
        ...jobsQuery,
      });
      setJobsData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadJobs failed', err);
      showToast('Erro ao carregar jobs do scheduler', 'error');
    } finally {
      setJobsLoading(false);
    }
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    try {
      const result = await getOperationsNotifications({
        ...baseParams(),
        ...notificationsQuery,
      });
      setNotificationsData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadNotifications failed', err);
      showToast('Erro ao carregar notificacoes', 'error');
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function loadInsights() {
    setInsightsLoading(true);
    try {
      const result = await getOperationsInsights({
        ...baseParams(),
        limit: 30,
      });
      setInsightsData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadInsights failed', err);
      showToast('Erro ao carregar insights operacionais', 'error');
    } finally {
      setInsightsLoading(false);
    }
  }

  async function refreshAll() {
    await loadSummary();
    if (activeTab === 'timeline') await loadTimeline();
    if (activeTab === 'jobs') await loadJobs();
    if (activeTab === 'notifications') await loadNotifications();
    if (activeTab === 'insights') await loadInsights();
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadSummary();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === 'timeline') loadTimeline();
    if (activeTab === 'jobs') loadJobs();
    if (activeTab === 'notifications') loadNotifications();
    if (activeTab === 'insights') loadInsights();
  }, [activeTab, isAuthenticated]);

  const beauty = summary?.summary?.beauty;
  const fitness = summary?.summary?.fitness;
  const system = summary?.summary?.system;

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Painel Operacional Beauty + Fitness</h1>
        <div className="support-controls">
          <button onClick={refreshAll} disabled={loadingSummary}>
            {loadingSummary ? 'Atualizando...' : 'Atualizar painel'}
          </button>
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} onRefresh={refreshAll} loading={loadingSummary} />

      {summary?.meta?.derivedMetrics?.length ? (
        <div className="bg-bg-tertiary border border-border-default rounded p-3 text-xs text-text-secondary mb-4">
          <strong>Metricas derivadas:</strong> {summary.meta.derivedMetrics.map((m) => m.metric || m.field).join(', ')}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <div className="bg-bg-elevated border border-border-default rounded-xl p-4">
          <h3 className="font-semibold mb-3">Beauty</h3>
          <div className="grid gap-3 grid-cols-2">
            <KpiCard title="Agendamentos hoje" value={beauty?.appointmentsToday} />
            <KpiCard title="Concluidos" value={beauty?.completedServices} />
            <KpiCard title="No-show" value={beauty?.noShow} />
            <KpiCard title="Reativacoes" value={beauty?.reactivations} />
          </div>
        </div>

        <div className="bg-bg-elevated border border-border-default rounded-xl p-4">
          <h3 className="font-semibold mb-3">Fitness</h3>
          <div className="grid gap-3 grid-cols-2">
            <KpiCard title="Check-ins hoje" value={fitness?.checkInsToday} />
            <KpiCard title="Alunos ativos" value={fitness?.activeStudents} />
            <KpiCard title="Baixa frequencia" value={fitness?.lowFrequency} />
            <KpiCard title="Bloqueados" value={fitness?.blocked} />
          </div>
        </div>

        <div className="bg-bg-elevated border border-border-default rounded-xl p-4">
          <h3 className="font-semibold mb-3">Sistema</h3>
          <div className="grid gap-3 grid-cols-2">
            <KpiCard title="Jobs executados" value={system?.jobsExecuted} />
            <KpiCard title="Jobs com erro" value={system?.jobsError} />
            <KpiCard title="Notificacoes enviadas" value={system?.notificationsSent} />
            <KpiCard title="Falhas envio" value={system?.notificationFailures} />
          </div>
        </div>
      </div>

      <div className="bg-bg-elevated border border-border-default rounded-xl p-4 mb-4">
        <div className="flex flex-wrap gap-2 mb-4">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`px-3 py-2 rounded text-sm border ${activeTab === tab.id ? 'bg-accent-primary text-white border-accent-primary' : 'bg-bg-tertiary border-border-default'}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'timeline' ? (
          <div>
            <div className="grid gap-3 md:grid-cols-6 mb-3">
              <input className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" placeholder="subjectId" value={timelineQuery.subjectId} onChange={(e) => setTimelineQuery({ ...timelineQuery, subjectId: e.target.value, page: 1 })} />
              <input className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" placeholder="customerId" value={timelineQuery.customerId} onChange={(e) => setTimelineQuery({ ...timelineQuery, customerId: e.target.value, page: 1 })} />
              <input className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" placeholder="membershipId" value={timelineQuery.membershipId} onChange={(e) => setTimelineQuery({ ...timelineQuery, membershipId: e.target.value, page: 1 })} />
              <select className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" value={timelineQuery.status} onChange={(e) => setTimelineQuery({ ...timelineQuery, status: e.target.value, page: 1 })}>
                <option value="">status: all</option>
                <option value="success">success</option>
                <option value="failed">failed</option>
                <option value="pending">pending</option>
                <option value="provider-dependent">provider-dependent</option>
              </select>
              <select className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" value={timelineQuery.limit} onChange={(e) => setTimelineQuery({ ...timelineQuery, limit: Number(e.target.value), page: 1 })}>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={loadTimeline} disabled={timelineLoading}>{timelineLoading ? 'Buscando...' : 'Buscar'}</button>
            </div>

            <div className="overflow-auto border border-border-default rounded">
              <table className="w-full text-sm">
                <thead className="bg-bg-tertiary text-text-secondary">
                  <tr>
                    <th className="text-left p-2">Timestamp</th>
                    <th className="text-left p-2">Evento</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Origem</th>
                    <th className="text-left p-2">Subject</th>
                    <th className="text-left p-2">Detalhes</th>
                  </tr>
                </thead>
                <tbody>
                  {(timelineData?.items || []).map((item, idx) => (
                    <tr key={`${item.timestamp}-${item.eventType}-${idx}`} className="border-t border-border-default">
                      <td className="p-2 whitespace-nowrap">{item.timestamp ? new Date(item.timestamp).toLocaleString('pt-BR') : '-'}</td>
                      <td className="p-2">{item.eventType}</td>
                      <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                      <td className="p-2">{item.origin}</td>
                      <td className="p-2">{item.subjectId || '-'}</td>
                      <td className="p-2 text-xs text-text-secondary">{item.details?.reason || item.details?.rawStatus || item.details?.triggeredBy || '-'}</td>
                    </tr>
                  ))}
                  {!(timelineData?.items || []).length ? (
                    <tr>
                      <td className="p-3 text-text-secondary" colSpan={6}>Nenhum evento encontrado para os filtros.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === 'jobs' ? (
          <div>
            <div className="grid gap-3 md:grid-cols-4 mb-3">
              <select className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" value={jobsQuery.status} onChange={(e) => setJobsQuery({ ...jobsQuery, status: e.target.value, page: 1 })}>
                <option value="">status: all</option>
                <option value="success">success</option>
                <option value="failed">failed</option>
                <option value="pending">pending</option>
              </select>
              <select className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" value={jobsQuery.limit} onChange={(e) => setJobsQuery({ ...jobsQuery, limit: Number(e.target.value), page: 1 })}>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={loadJobs} disabled={jobsLoading}>{jobsLoading ? 'Carregando...' : 'Aplicar'}</button>
              <div className="text-xs text-text-secondary flex items-center">backlog: {cardNumber(jobsData?.summary?.backlogEstimated)}</div>
            </div>

            <div className="grid gap-3 grid-cols-2 md:grid-cols-6 mb-4">
              <KpiCard title="Executados" value={jobsData?.summary?.executed} />
              <KpiCard title="Sucesso" value={jobsData?.summary?.success} />
              <KpiCard title="Erro" value={jobsData?.summary?.failed} />
              <KpiCard title="Duracao media (ms)" value={jobsData?.summary?.avgDurationMs} />
              <KpiCard title="Retries" value={jobsData?.summary?.retries} />
              <KpiCard title="Pendentes" value={jobsData?.summary?.pending} />
            </div>

            <div className="overflow-auto border border-border-default rounded">
              <table className="w-full text-sm">
                <thead className="bg-bg-tertiary text-text-secondary">
                  <tr>
                    <th className="text-left p-2">Tipo</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Inicio</th>
                    <th className="text-left p-2">Duracao</th>
                    <th className="text-left p-2">Tentativa</th>
                    <th className="text-left p-2">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {(jobsData?.items || []).map((job) => (
                    <tr key={job.id} className="border-t border-border-default">
                      <td className="p-2">{job.kind}</td>
                      <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(job.status)}`}>{job.status}</span></td>
                      <td className="p-2">{job.startedAt ? new Date(job.startedAt).toLocaleString('pt-BR') : '-'}</td>
                      <td className="p-2">{job.durationMs != null ? `${job.durationMs}ms` : '-'}</td>
                      <td className="p-2">{job.attempt}</td>
                      <td className="p-2 text-xs text-text-secondary">{job.error || '-'}</td>
                    </tr>
                  ))}
                  {!(jobsData?.items || []).length ? (
                    <tr>
                      <td className="p-3 text-text-secondary" colSpan={6}>Nenhum job encontrado para os filtros.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === 'notifications' ? (
          <div>
            <div className="grid gap-3 md:grid-cols-5 mb-3">
              <select className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" value={notificationsQuery.status} onChange={(e) => setNotificationsQuery({ ...notificationsQuery, status: e.target.value, page: 1 })}>
                <option value="">status: all</option>
                <option value="sent">sent</option>
                <option value="failed">failed</option>
                <option value="skipped">skipped</option>
                <option value="provider-dependent">provider-dependent</option>
              </select>
              <select className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" value={notificationsQuery.channel} onChange={(e) => setNotificationsQuery({ ...notificationsQuery, channel: e.target.value, page: 1 })}>
                <option value="">canal: all</option>
                <option value="whatsapp">whatsapp</option>
                <option value="email">email</option>
                <option value="sms">sms</option>
                <option value="internal">internal</option>
              </select>
              <select className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm" value={notificationsQuery.limit} onChange={(e) => setNotificationsQuery({ ...notificationsQuery, limit: Number(e.target.value), page: 1 })}>
                <option value={20}>20</option>
                <option value={30}>30</option>
                <option value={50}>50</option>
              </select>
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={loadNotifications} disabled={notificationsLoading}>{notificationsLoading ? 'Carregando...' : 'Aplicar'}</button>
              <div className="text-xs text-text-secondary flex items-center">fonte: {notificationsData?.meta?.dataSource || '-'}</div>
            </div>

            {!!notificationsData?.meta?.warnings?.length && (
              <div className="mb-3 bg-amber-500/10 border border-amber-500/30 rounded p-2 text-xs text-amber-200">
                {notificationsData.meta.warnings.join(', ')}
              </div>
            )}

            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
              <KpiCard title="Enviadas" value={notificationsData?.summary?.sent} />
              <KpiCard title="Falhadas" value={notificationsData?.summary?.failed} />
              <KpiCard title="Skipped" value={notificationsData?.summary?.skipped} />
              <KpiCard title="Provider-dependent" value={notificationsData?.summary?.providerDependent} />
            </div>

            <div className="overflow-auto border border-border-default rounded">
              <table className="w-full text-sm">
                <thead className="bg-bg-tertiary text-text-secondary">
                  <tr>
                    <th className="text-left p-2">Data/hora</th>
                    <th className="text-left p-2">Canal</th>
                    <th className="text-left p-2">Destino</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Tipo</th>
                    <th className="text-left p-2">Stub/Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {(notificationsData?.items || []).map((item, idx) => (
                    <tr key={`${item.timestamp}-${idx}`} className="border-t border-border-default">
                      <td className="p-2">{item.timestamp ? new Date(item.timestamp).toLocaleString('pt-BR') : '-'}</td>
                      <td className="p-2">{item.channel}</td>
                      <td className="p-2">{item.destination}</td>
                      <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                      <td className="p-2">{item.messageType || '-'}</td>
                      <td className="p-2 text-xs text-text-secondary">{item.isStub === true ? 'stub' : 'real'}{item.error ? ` | ${item.error}` : ''}</td>
                    </tr>
                  ))}
                  {!(notificationsData?.items || []).length ? (
                    <tr>
                      <td className="p-3 text-text-secondary" colSpan={6}>Nenhuma notificacao encontrada para os filtros.</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === 'insights' ? (
          <div>
            <div className="mb-3">
              <button className="bg-accent-primary rounded px-3 py-2 text-sm text-white" onClick={loadInsights} disabled={insightsLoading}>{insightsLoading ? 'Atualizando...' : 'Atualizar insights'}</button>
            </div>

            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 mb-4">
              <KpiCard title="Total" value={insightsData?.summary?.total} />
              <KpiCard title="Beauty" value={insightsData?.summary?.byVertical?.beauty} />
              <KpiCard title="Fitness" value={insightsData?.summary?.byVertical?.fitness} />
            </div>

            <div className="grid gap-3">
              {(insightsData?.items || []).map((insight, idx) => (
                <div key={`${insight.type}-${insight.subjectId}-${idx}`} className="border border-border-default rounded-lg p-3 bg-bg-tertiary">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs px-2 py-1 rounded bg-accent-light text-text-primary">{insight.vertical}</span>
                    <span className="text-sm font-medium">{insight.type}</span>
                    <span className={`text-xs px-2 py-1 rounded ${statusBadgeClass('provider-dependent')}`}>score {Number(insight.score || 0).toFixed(2)} ({insight.scoreSource})</span>
                  </div>
                  <div className="text-sm text-text-primary mb-1">{insight.reason}</div>
                  <div className="text-xs text-text-secondary">acao: {insight.action} | subject: {insight.subjectId || '-'}</div>
                </div>
              ))}
              {!(insightsData?.items || []).length ? (
                <div className="text-sm text-text-secondary">Nenhum insight acionavel encontrado para os filtros atuais.</div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <ToastContainer />
    </div>
  );
}
