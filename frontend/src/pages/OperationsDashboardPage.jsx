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
import {
  getBeautyAgenda,
  searchBeautyCustomers,
  getBeautyCustomerDetail,
  sendBeautyFollowUp,
  markBeautyServiceCompleted,
  markBeautyNoShow,
  searchFitnessStudents,
  getFitnessStudentDetail,
  registerFitnessCheckIn,
  registerFitnessCheckOut,
  updateFitnessMembershipBilling,
} from '../api/verticalPilot';
import { markScheduleDone, markScheduleNoShow } from '../api/scheduling';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

const TABS = [
  { id: 'beauty-agenda', label: 'Agenda Beauty' },
  { id: 'beauty-customer', label: 'Atendimento Beauty' },
  { id: 'fitness-checkin', label: 'Check-in Fitness' },
  { id: 'fitness-student', label: 'Aluno Fitness' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'jobs', label: 'Scheduler / Jobs' },
  { id: 'notifications', label: 'Notificacoes' },
  { id: 'insights', label: 'Insights Operacionais' },
];

function statusBadgeClass(status) {
  const value = String(status || '').toLowerCase();
  if (value === 'success' || value === 'sent' || value === 'concluido' || value === 'confirmado' || value === 'liberado' || value === 'active') {
    return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  }
  if (value === 'failed' || value === 'bloqueado' || value === 'blocked' || value === 'cancelado' || value === 'delinquent' || value === 'inativo') {
    return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
  }
  if (value === 'pending' || value === 'grace period' || value === 'pendente' || value === 'em atendimento') {
    return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
  }
  if (value === 'provider-dependent') return 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40';
  if (value === 'skipped' || value === 'no-show') return 'bg-slate-500/20 text-slate-300 border border-slate-500/40';
  return 'bg-slate-600/20 text-slate-200 border border-slate-500/40';
}

function cardNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return Intl.NumberFormat('pt-BR').format(n);
}

function isoDateToday() {
  return new Date().toISOString().slice(0, 10);
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

function riskLevel(score) {
  const value = Number(score || 0);
  if (value >= 0.7) return 'alto';
  if (value >= 0.4) return 'medio';
  return 'baixo';
}

function parseTimelineDetail(item) {
  return item.details?.reason || item.details?.rawStatus || item.details?.triggeredBy || '-';
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

function SectionState({ loading, error, empty, emptyMessage }) {
  if (loading) {
    return <div className="text-sm text-text-secondary py-3">Carregando...</div>;
  }
  if (error) {
    return <div className="text-sm text-rose-300 py-3">{error}</div>;
  }
  if (empty) {
    return <div className="text-sm text-text-secondary py-3">{emptyMessage}</div>;
  }
  return null;
}

function TabButton({ tab, activeTab, setActiveTab }) {
  return (
    <button
      key={tab.id}
      className={`px-3 py-2 rounded text-sm border ${activeTab === tab.id ? 'bg-accent-primary text-white border-accent-primary' : 'bg-bg-tertiary border-border-default'}`}
      onClick={() => setActiveTab(tab.id)}
    >
      {tab.label}
    </button>
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

  const [activeTab, setActiveTab] = useState('beauty-agenda');

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');

  const [timelineQuery, setTimelineQuery] = useState({ subjectId: '', customerId: '', membershipId: '', status: '', page: 1, limit: 30 });
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineData, setTimelineData] = useState(null);
  const [timelineError, setTimelineError] = useState('');

  const [jobsQuery, setJobsQuery] = useState({ status: '', page: 1, limit: 30 });
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsData, setJobsData] = useState(null);
  const [jobsError, setJobsError] = useState('');

  const [notificationsQuery, setNotificationsQuery] = useState({ status: '', channel: '', page: 1, limit: 30 });
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsData, setNotificationsData] = useState(null);
  const [notificationsError, setNotificationsError] = useState('');

  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsData, setInsightsData] = useState(null);
  const [insightsError, setInsightsError] = useState('');

  const [beautyAgendaFilters, setBeautyAgendaFilters] = useState({ date: isoDateToday(), professionalId: '' });
  const [beautyAgendaLoading, setBeautyAgendaLoading] = useState(false);
  const [beautyAgendaData, setBeautyAgendaData] = useState(null);
  const [beautyAgendaError, setBeautyAgendaError] = useState('');
  const [selectedAppointment, setSelectedAppointment] = useState(null);

  const [beautySearchQuery, setBeautySearchQuery] = useState('');
  const [beautySearchLoading, setBeautySearchLoading] = useState(false);
  const [beautySearchResults, setBeautySearchResults] = useState([]);
  const [beautySearchError, setBeautySearchError] = useState('');
  const [selectedBeautySubject, setSelectedBeautySubject] = useState('');

  const [beautyDetailLoading, setBeautyDetailLoading] = useState(false);
  const [beautyDetail, setBeautyDetail] = useState(null);
  const [beautyDetailError, setBeautyDetailError] = useState('');
  const [beautyFollowUpNote, setBeautyFollowUpNote] = useState('');

  const [fitnessQuery, setFitnessQuery] = useState('');
  const [fitnessSearchLoading, setFitnessSearchLoading] = useState(false);
  const [fitnessSearchResults, setFitnessSearchResults] = useState([]);
  const [fitnessSearchError, setFitnessSearchError] = useState('');
  const [selectedFitnessSubject, setSelectedFitnessSubject] = useState('');

  const [fitnessStudentInput, setFitnessStudentInput] = useState('');
  const [fitnessDetailLoading, setFitnessDetailLoading] = useState(false);
  const [fitnessDetail, setFitnessDetail] = useState(null);
  const [fitnessDetailError, setFitnessDetailError] = useState('');

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
    setSummaryError('');
    try {
      const result = await getOperationsSummary(baseParams());
      setSummary(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadSummary failed', err);
      setSummaryError('Erro ao carregar resumo do painel operacional.');
      showToast('Erro ao carregar resumo do painel operacional', 'error');
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadTimeline(queryOverride) {
    setTimelineLoading(true);
    setTimelineError('');
    try {
      const query = queryOverride || timelineQuery;
      const result = await getOperationsTimeline({
        ...baseParams(),
        ...query,
      });
      setTimelineData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadTimeline failed', err);
      setTimelineError('Erro ao carregar timeline operacional.');
      showToast('Erro ao carregar timeline operacional', 'error');
    } finally {
      setTimelineLoading(false);
    }
  }

  async function loadJobs() {
    setJobsLoading(true);
    setJobsError('');
    try {
      const result = await getOperationsJobs({
        ...baseParams(),
        ...jobsQuery,
      });
      setJobsData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadJobs failed', err);
      setJobsError('Erro ao carregar jobs do scheduler.');
      showToast('Erro ao carregar jobs do scheduler', 'error');
    } finally {
      setJobsLoading(false);
    }
  }

  async function loadNotifications() {
    setNotificationsLoading(true);
    setNotificationsError('');
    try {
      const result = await getOperationsNotifications({
        ...baseParams(),
        ...notificationsQuery,
      });
      setNotificationsData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadNotifications failed', err);
      setNotificationsError('Erro ao carregar notificacoes.');
      showToast('Erro ao carregar notificacoes', 'error');
    } finally {
      setNotificationsLoading(false);
    }
  }

  async function loadInsights() {
    setInsightsLoading(true);
    setInsightsError('');
    try {
      const result = await getOperationsInsights({
        ...baseParams(),
        limit: 30,
      });
      setInsightsData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadInsights failed', err);
      setInsightsError('Erro ao carregar insights operacionais.');
      showToast('Erro ao carregar insights operacionais', 'error');
    } finally {
      setInsightsLoading(false);
    }
  }

  async function loadBeautyAgenda() {
    setBeautyAgendaLoading(true);
    setBeautyAgendaError('');
    try {
      const result = await getBeautyAgenda({
        date: beautyAgendaFilters.date,
        professionalId: beautyAgendaFilters.professionalId || undefined,
      });
      setBeautyAgendaData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadBeautyAgenda failed', err);
      setBeautyAgendaError('Erro ao carregar agenda Beauty.');
      showToast('Erro ao carregar agenda Beauty', 'error');
    } finally {
      setBeautyAgendaLoading(false);
    }
  }

  async function loadBeautySearch() {
    setBeautySearchLoading(true);
    setBeautySearchError('');
    try {
      const result = await searchBeautyCustomers({ q: beautySearchQuery, limit: 30 });
      setBeautySearchResults(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadBeautySearch failed', err);
      setBeautySearchError('Erro ao buscar clientes Beauty.');
      showToast('Erro ao buscar clientes Beauty', 'error');
    } finally {
      setBeautySearchLoading(false);
    }
  }

  async function loadBeautyDetail(subjectId) {
    if (!subjectId) return;
    setBeautyDetailLoading(true);
    setBeautyDetailError('');
    try {
      const result = await getBeautyCustomerDetail(subjectId, { limit: 150 });
      setBeautyDetail(result || null);
      setSelectedBeautySubject(subjectId);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadBeautyDetail failed', err);
      setBeautyDetailError('Erro ao carregar detalhe do cliente Beauty.');
      showToast('Erro ao carregar detalhe do cliente Beauty', 'error');
    } finally {
      setBeautyDetailLoading(false);
    }
  }

  async function loadFitnessSearch() {
    setFitnessSearchLoading(true);
    setFitnessSearchError('');
    try {
      const result = await searchFitnessStudents({ q: fitnessQuery, limit: 30 });
      setFitnessSearchResults(Array.isArray(result?.items) ? result.items : []);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadFitnessSearch failed', err);
      setFitnessSearchError('Erro ao buscar alunos Fitness.');
      showToast('Erro ao buscar alunos Fitness', 'error');
    } finally {
      setFitnessSearchLoading(false);
    }
  }

  async function loadFitnessDetail(subjectId) {
    if (!subjectId) return;
    setFitnessDetailLoading(true);
    setFitnessDetailError('');
    try {
      const result = await getFitnessStudentDetail(subjectId, { limit: 120 });
      setFitnessDetail(result || null);
      setSelectedFitnessSubject(subjectId);
      setFitnessStudentInput(subjectId);
    } catch (err) {
      logger.error('[OperationsDashboardPage] loadFitnessDetail failed', err);
      setFitnessDetailError('Erro ao carregar detalhe do aluno.');
      showToast('Erro ao carregar detalhe do aluno', 'error');
    } finally {
      setFitnessDetailLoading(false);
    }
  }

  async function refreshAll() {
    await loadSummary();

    if (activeTab === 'beauty-agenda') await loadBeautyAgenda();
    if (activeTab === 'beauty-customer') {
      if (beautySearchQuery) await loadBeautySearch();
      if (selectedBeautySubject) await loadBeautyDetail(selectedBeautySubject);
    }
    if (activeTab === 'fitness-checkin') {
      if (fitnessQuery) await loadFitnessSearch();
    }
    if (activeTab === 'fitness-student' && selectedFitnessSubject) {
      await loadFitnessDetail(selectedFitnessSubject);
    }
    if (activeTab === 'timeline') await loadTimeline();
    if (activeTab === 'jobs') await loadJobs();
    if (activeTab === 'notifications') await loadNotifications();
    if (activeTab === 'insights') await loadInsights();
  }

  async function openTimeline(vertical, subjectId, customerId = '', membershipId = '') {
    const nextFilters = { ...filters, vertical: vertical || filters.vertical };
    setFilters(nextFilters);

    const query = {
      ...timelineQuery,
      subjectId: subjectId || '',
      customerId: customerId || '',
      membershipId: membershipId || '',
      page: 1,
    };
    setTimelineQuery(query);
    setActiveTab('timeline');

    setTimelineLoading(true);
    setTimelineError('');
    try {
      const result = await getOperationsTimeline({
        tenantId: nextFilters.tenantId || undefined,
        vertical: nextFilters.vertical,
        startDate: nextFilters.startDate,
        endDate: nextFilters.endDate,
        ...query,
      });
      setTimelineData(result || null);
    } catch (err) {
      logger.error('[OperationsDashboardPage] openTimeline failed', err);
      setTimelineError('Erro ao carregar timeline operacional.');
      showToast('Erro ao carregar timeline operacional', 'error');
    } finally {
      setTimelineLoading(false);
    }
  }

  async function handleCompleteAppointment(item) {
    if (!item?.scheduleId) return;
    try {
      await markScheduleDone(item.scheduleId);
      await markBeautyServiceCompleted({
        subjectId: item.subjectId || item.clientId,
        customerId: item.clientId || null,
        scheduleId: item.scheduleId,
        metadata: { triggeredBy: 'manual_ui' },
      });
      showToast('Atendimento concluido com sucesso.', 'success');
      await loadBeautyAgenda();
      if (selectedBeautySubject && beautyDetail?.customer?.subjectId) {
        await loadBeautyDetail(beautyDetail.customer.subjectId);
      }
    } catch (err) {
      logger.error('[OperationsDashboardPage] handleCompleteAppointment failed', err);
      showToast('Erro ao concluir atendimento.', 'error');
    }
  }

  async function handleNoShowAppointment(item) {
    if (!item?.scheduleId) return;
    try {
      await markScheduleNoShow(item.scheduleId);
      await markBeautyNoShow({
        subjectId: item.subjectId || item.clientId,
        customerId: item.clientId || null,
        scheduleId: item.scheduleId,
        metadata: { triggeredBy: 'manual_ui' },
      });
      showToast('No-show registrado com sucesso.', 'success');
      await loadBeautyAgenda();
      if (selectedBeautySubject && beautyDetail?.customer?.subjectId) {
        await loadBeautyDetail(beautyDetail.customer.subjectId);
      }
    } catch (err) {
      logger.error('[OperationsDashboardPage] handleNoShowAppointment failed', err);
      showToast('Erro ao registrar no-show.', 'error');
    }
  }

  async function handleBeautyFollowUp() {
    if (!beautyDetail?.customer?.subjectId) return;
    try {
      await sendBeautyFollowUp({
        subjectId: beautyDetail.customer.subjectId,
        customerId: beautyDetail.customer.customerId,
        note: beautyFollowUpNote || undefined,
        metadata: {
          note: beautyFollowUpNote || null,
          triggeredBy: 'manual_ui',
        },
      });
      showToast('Follow-up registrado.', 'success');
      setBeautyFollowUpNote('');
      await loadBeautyDetail(beautyDetail.customer.subjectId);
    } catch (err) {
      logger.error('[OperationsDashboardPage] handleBeautyFollowUp failed', err);
      showToast('Erro ao registrar follow-up.', 'error');
    }
  }

  async function handleFitnessCheckIn(item) {
    if (!item?.subjectId) return;
    try {
      await registerFitnessCheckIn({
        subjectId: item.subjectId,
        membershipId: item.membershipId || undefined,
        metadata: { triggeredBy: 'manual_ui' },
      });
      showToast('Check-in registrado com sucesso.', 'success');
      if (fitnessQuery) await loadFitnessSearch();
      if (selectedFitnessSubject) await loadFitnessDetail(selectedFitnessSubject);
    } catch (err) {
      logger.error('[OperationsDashboardPage] handleFitnessCheckIn failed', err);
      showToast('Erro ao registrar check-in.', 'error');
    }
  }

  async function handleFitnessCheckOut(item) {
    if (!item?.subjectId) return;
    try {
      await registerFitnessCheckOut({
        subjectId: item.subjectId,
        metadata: { triggeredBy: 'manual_ui' },
      });
      showToast('Check-out registrado com sucesso.', 'success');
      if (fitnessQuery) await loadFitnessSearch();
      if (selectedFitnessSubject) await loadFitnessDetail(selectedFitnessSubject);
    } catch (err) {
      logger.error('[OperationsDashboardPage] handleFitnessCheckOut failed', err);
      showToast('Erro ao registrar check-out.', 'error');
    }
  }

  async function handleFitnessReactivation() {
    const membershipId = fitnessDetail?.membership?.id;
    if (!membershipId) return;
    try {
      await updateFitnessMembershipBilling(membershipId, {
        toStatus: 'active',
        reason: 'manual_reactivation_ui',
      });
      showToast('Aluno reativado com sucesso.', 'success');
      if (fitnessDetail?.student?.subjectId) {
        await loadFitnessDetail(fitnessDetail.student.subjectId);
      }
    } catch (err) {
      logger.error('[OperationsDashboardPage] handleFitnessReactivation failed', err);
      showToast('Erro ao reativar aluno.', 'error');
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadSummary();
      loadBeautyAgenda();
    }
  }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (activeTab === 'beauty-agenda') loadBeautyAgenda();
    if (activeTab === 'timeline') loadTimeline();
    if (activeTab === 'jobs') loadJobs();
    if (activeTab === 'notifications') loadNotifications();
    if (activeTab === 'insights') loadInsights();
  }, [activeTab, isAuthenticated]);

  const beauty = summary?.summary?.beauty;
  const fitness = summary?.summary?.fitness;
  const system = summary?.summary?.system;

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>Painel Operacional Beauty + Fitness</h1>
        <div className="support-controls">
          <button onClick={refreshAll} disabled={loadingSummary}>
            {loadingSummary ? 'Atualizando...' : 'Atualizar painel'}
          </button>
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} onRefresh={refreshAll} loading={loadingSummary} />

      {summaryError ? (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded p-3 text-sm text-rose-300 mb-4">
          {summaryError}
        </div>
      ) : null}

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
            <TabButton key={tab.id} tab={tab} activeTab={activeTab} setActiveTab={setActiveTab} />
          ))}
        </div>

        {activeTab === 'beauty-agenda' ? (
          <div>
            <div className="grid gap-3 md:grid-cols-4 mb-3">
              <input
                type="date"
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm"
                value={beautyAgendaFilters.date}
                onChange={(e) => setBeautyAgendaFilters({ ...beautyAgendaFilters, date: e.target.value })}
              />
              <input
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm"
                placeholder="professionalId"
                value={beautyAgendaFilters.professionalId}
                onChange={(e) => setBeautyAgendaFilters({ ...beautyAgendaFilters, professionalId: e.target.value })}
              />
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={loadBeautyAgenda} disabled={beautyAgendaLoading}>
                {beautyAgendaLoading ? 'Carregando...' : 'Atualizar agenda'}
              </button>
              <div className="text-xs text-text-secondary flex items-center">
                total: {cardNumber(beautyAgendaData?.summary?.total)}
              </div>
            </div>

            <SectionState
              loading={beautyAgendaLoading}
              error={beautyAgendaError}
              empty={!beautyAgendaLoading && !beautyAgendaError && !(beautyAgendaData?.items || []).length}
              emptyMessage="Nenhum agendamento encontrado para o dia selecionado."
            />

            {(beautyAgendaData?.items || []).length ? (
              <div className="overflow-auto border border-border-default rounded">
                <table className="w-full text-sm">
                  <thead className="bg-bg-tertiary text-text-secondary">
                    <tr>
                      <th className="text-left p-2">Horario</th>
                      <th className="text-left p-2">Cliente</th>
                      <th className="text-left p-2">Profissional</th>
                      <th className="text-left p-2">Servico</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(beautyAgendaData?.items || []).map((item) => (
                      <tr key={item.id} className="border-t border-border-default">
                        <td className="p-2 whitespace-nowrap">{item.startAt ? new Date(item.startAt).toLocaleString('pt-BR') : '-'}</td>
                        <td className="p-2">{item.clientName || '-'}</td>
                        <td className="p-2">{item.professionalName || '-'}</td>
                        <td className="p-2">{item.service || '-'}</td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(item.status)}`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            <button className="px-2 py-1 rounded text-xs bg-bg-tertiary border border-border-default" onClick={() => setSelectedAppointment(item)}>
                              Detalhes
                            </button>
                            <button className="px-2 py-1 rounded text-xs bg-emerald-600/20 border border-emerald-500/30" onClick={() => handleCompleteAppointment(item)}>
                              Concluir
                            </button>
                            <button className="px-2 py-1 rounded text-xs bg-amber-600/20 border border-amber-500/30" onClick={() => handleNoShowAppointment(item)}>
                              No-show
                            </button>
                            <button
                              className="px-2 py-1 rounded text-xs bg-bg-tertiary border border-border-default"
                              onClick={() => {
                                const candidate = item.subjectId || item.clientId;
                                if (!candidate) return;
                                setActiveTab('beauty-customer');
                                setSelectedBeautySubject(candidate);
                                loadBeautyDetail(candidate);
                              }}
                            >
                              Cliente
                            </button>
                            <button
                              className="px-2 py-1 rounded text-xs bg-bg-tertiary border border-border-default"
                              onClick={() => openTimeline('beauty', item.subjectId || '', item.clientId || '', '')}
                            >
                              Jornada
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'beauty-customer' ? (
          <div>
            <div className="grid gap-3 md:grid-cols-5 mb-3">
              <input
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm md:col-span-3"
                placeholder="Buscar cliente por nome, documento, subjectId ou codigo"
                value={beautySearchQuery}
                onChange={(e) => setBeautySearchQuery(e.target.value)}
              />
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={loadBeautySearch} disabled={beautySearchLoading}>
                {beautySearchLoading ? 'Buscando...' : 'Buscar cliente'}
              </button>
              <button
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm"
                onClick={() => {
                  if (!selectedBeautySubject) return;
                  loadBeautyDetail(selectedBeautySubject);
                }}
                disabled={beautyDetailLoading || !selectedBeautySubject}
              >
                {beautyDetailLoading ? 'Atualizando...' : 'Refresh cliente'}
              </button>
            </div>

            {beautySearchError ? <div className="text-sm text-rose-300 mb-3">{beautySearchError}</div> : null}

            <div className="grid gap-4 md:grid-cols-12">
              <div className="md:col-span-4 border border-border-default rounded-lg p-3 bg-bg-tertiary">
                <div className="text-xs text-text-secondary mb-2">Resultados</div>
                <SectionState
                  loading={beautySearchLoading}
                  error={null}
                  empty={!beautySearchLoading && !(beautySearchResults || []).length}
                  emptyMessage="Nenhum cliente encontrado."
                />
                <div className="space-y-2 max-h-[420px] overflow-auto">
                  {(beautySearchResults || []).map((item) => (
                    <button
                      key={`${item.subjectId}-${item.customerId}`}
                      className={`w-full text-left p-2 rounded border ${selectedBeautySubject === item.subjectId ? 'border-accent-primary bg-accent-light' : 'border-border-default bg-bg-elevated'}`}
                      onClick={() => {
                        setSelectedBeautySubject(item.subjectId);
                        loadBeautyDetail(item.subjectId);
                      }}
                    >
                      <div className="text-sm font-medium">{item.name || item.subjectId}</div>
                      <div className="text-xs text-text-secondary">subject: {item.subjectId || '-'}</div>
                      <div className="text-xs text-text-secondary">doc: {item.document || '-'}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="md:col-span-8 border border-border-default rounded-lg p-3 bg-bg-tertiary">
                <SectionState
                  loading={beautyDetailLoading}
                  error={beautyDetailError}
                  empty={!beautyDetailLoading && !beautyDetailError && !beautyDetail}
                  emptyMessage="Selecione um cliente para abrir o atendimento operacional."
                />

                {beautyDetail ? (
                  <div className="space-y-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="bg-bg-elevated border border-border-default rounded p-3">
                        <div className="text-xs text-text-secondary mb-1">Cliente</div>
                        <div className="text-sm font-medium">{beautyDetail.customer?.name || beautyDetail.customer?.subjectId}</div>
                        <div className="text-xs text-text-secondary mt-1">subject: {beautyDetail.customer?.subjectId || '-'}</div>
                        <div className="text-xs text-text-secondary">documento: {beautyDetail.customer?.document || '-'}</div>
                        <div className="text-xs text-text-secondary">contato: {beautyDetail.customer?.phone || beautyDetail.customer?.email || '-'}</div>
                      </div>

                      <div className="bg-bg-elevated border border-border-default rounded p-3">
                        <div className="text-xs text-text-secondary mb-1">Indicadores</div>
                        <div className="flex flex-wrap gap-2">
                          <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(riskLevel(beautyDetail.indicators?.noShowRiskScore) === 'alto' ? 'failed' : riskLevel(beautyDetail.indicators?.noShowRiskScore) === 'medio' ? 'pending' : 'success')}`}>
                            no-show risk: {riskLevel(beautyDetail.indicators?.noShowRiskScore)} ({Number(beautyDetail.indicators?.noShowRiskScore || 0).toFixed(2)})
                          </span>
                          <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(beautyDetail.indicators?.eligibleForReturn ? 'success' : 'pending')}`}>
                            retorno: {beautyDetail.indicators?.eligibleForReturn ? 'elegivel' : 'nao elegivel'}
                          </span>
                          <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(beautyDetail.indicators?.followUpStatus === 'sent' ? 'success' : 'pending')}`}>
                            follow-up: {beautyDetail.indicators?.followUpStatus === 'sent' ? 'enviado' : 'pendente'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-bg-elevated border border-border-default rounded p-3">
                      <div className="text-xs text-text-secondary mb-2">Status da automacao</div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                        <span className={`px-2 py-1 rounded ${statusBadgeClass(beautyDetail.automation?.confirmationSent ? 'success' : 'pending')}`}>confirmacao</span>
                        <span className={`px-2 py-1 rounded ${statusBadgeClass(beautyDetail.automation?.reminder24hSent ? 'success' : 'pending')}`}>reminder 24h</span>
                        <span className={`px-2 py-1 rounded ${statusBadgeClass(beautyDetail.automation?.reminderNearSent ? 'success' : 'pending')}`}>reminder proximo</span>
                        <span className={`px-2 py-1 rounded ${statusBadgeClass(beautyDetail.automation?.followUpSent ? 'success' : 'pending')}`}>follow-up</span>
                        <span className={`px-2 py-1 rounded ${statusBadgeClass(beautyDetail.automation?.reactivationSent ? 'success' : 'pending')}`}>reativacao</span>
                      </div>
                    </div>

                    <div className="bg-bg-elevated border border-border-default rounded p-3">
                      <div className="text-xs text-text-secondary mb-2">Pacote / sessoes</div>
                      <div className="text-sm">saldo: {beautyDetail.bundle?.remaining ?? '-'} de {beautyDetail.bundle?.total ?? '-'}</div>
                      <div className="text-xs text-text-secondary">tipo: {beautyDetail.bundle?.bundleType || '-'}</div>
                    </div>

                    <div className="bg-bg-elevated border border-border-default rounded p-3">
                      <div className="text-xs text-text-secondary mb-2">Proximo agendamento</div>
                      {beautyDetail.nextAppointment ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm">{new Date(beautyDetail.nextAppointment.startAt).toLocaleString('pt-BR')}</span>
                          <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(beautyDetail.nextAppointment.status)}`}>
                            {beautyDetail.nextAppointment.status}
                          </span>
                          <button className="px-2 py-1 rounded text-xs bg-emerald-600/20 border border-emerald-500/30" onClick={() => handleCompleteAppointment(beautyDetail.nextAppointment)}>
                            Concluir
                          </button>
                          <button className="px-2 py-1 rounded text-xs bg-amber-600/20 border border-amber-500/30" onClick={() => handleNoShowAppointment(beautyDetail.nextAppointment)}>
                            No-show
                          </button>
                        </div>
                      ) : (
                        <div className="text-sm text-text-secondary">Nenhum proximo agendamento.</div>
                      )}
                    </div>

                    <div>
                      <div className="text-xs text-text-secondary mb-2">Ultimos atendimentos</div>
                      <div className="overflow-auto border border-border-default rounded">
                        <table className="w-full text-sm">
                          <thead className="bg-bg-elevated text-text-secondary">
                            <tr>
                              <th className="text-left p-2">Horario</th>
                              <th className="text-left p-2">Servico</th>
                              <th className="text-left p-2">Status</th>
                              <th className="text-left p-2">Acoes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(beautyDetail.recentAppointments || []).slice(0, 8).map((item) => (
                              <tr key={item.scheduleId || item.id} className="border-t border-border-default">
                                <td className="p-2">{item.startAt ? new Date(item.startAt).toLocaleString('pt-BR') : '-'}</td>
                                <td className="p-2">{item.service || '-'}</td>
                                <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                                <td className="p-2">
                                  <div className="flex gap-2">
                                    <button className="px-2 py-1 rounded text-xs bg-bg-tertiary border border-border-default" onClick={() => openTimeline('beauty', beautyDetail.customer?.subjectId || '', beautyDetail.customer?.customerId || '', '')}>
                                      Timeline
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                            {!(beautyDetail.recentAppointments || []).length ? (
                              <tr>
                                <td className="p-2 text-text-secondary" colSpan={4}>Sem atendimentos anteriores.</td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-text-secondary mb-2">Registrar follow-up manual</div>
                      <div className="grid gap-2 md:grid-cols-6">
                        <textarea
                          className="bg-bg-elevated border border-border-default rounded px-2 py-2 text-sm md:col-span-5"
                          rows={2}
                          placeholder="Ex.: ligar para confirmar retorno"
                          value={beautyFollowUpNote}
                          onChange={(e) => setBeautyFollowUpNote(e.target.value)}
                        />
                        <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={handleBeautyFollowUp}>
                          Registrar
                        </button>
                      </div>
                    </div>

                    <div>
                      <button
                        className="px-3 py-2 rounded text-sm bg-bg-elevated border border-border-default"
                        onClick={() => openTimeline('beauty', beautyDetail.customer?.subjectId || '', beautyDetail.customer?.customerId || '', '')}
                      >
                        Abrir timeline completa
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'fitness-checkin' ? (
          <div>
            <div className="grid gap-3 md:grid-cols-6 mb-3">
              <input
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm md:col-span-4"
                placeholder="Buscar aluno por nome, documento, codigo ou subjectId"
                value={fitnessQuery}
                onChange={(e) => setFitnessQuery(e.target.value)}
              />
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={loadFitnessSearch} disabled={fitnessSearchLoading}>
                {fitnessSearchLoading ? 'Buscando...' : 'Buscar aluno'}
              </button>
              <button
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm"
                onClick={() => {
                  if (!selectedFitnessSubject) return;
                  loadFitnessDetail(selectedFitnessSubject);
                }}
                disabled={fitnessDetailLoading || !selectedFitnessSubject}
              >
                {fitnessDetailLoading ? 'Atualizando...' : 'Refresh aluno'}
              </button>
            </div>

            <SectionState
              loading={fitnessSearchLoading}
              error={fitnessSearchError}
              empty={!fitnessSearchLoading && !fitnessSearchError && !(fitnessSearchResults || []).length}
              emptyMessage="Nenhum aluno encontrado."
            />

            {(fitnessSearchResults || []).length ? (
              <div className="overflow-auto border border-border-default rounded">
                <table className="w-full text-sm">
                  <thead className="bg-bg-tertiary text-text-secondary">
                    <tr>
                      <th className="text-left p-2">Aluno</th>
                      <th className="text-left p-2">Plano</th>
                      <th className="text-left p-2">Acesso</th>
                      <th className="text-left p-2">Mensagem</th>
                      <th className="text-left p-2">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fitnessSearchResults || []).map((item) => (
                      <tr key={`${item.subjectId}-${item.membershipId}`} className="border-t border-border-default">
                        <td className="p-2">
                          <div className="font-medium">{item.name || item.subjectId}</div>
                          <div className="text-xs text-text-secondary">subject: {item.subjectId}</div>
                        </td>
                        <td className="p-2">
                          <div className="text-sm">{item.effectiveBillingStatus || item.billingStatus || '-'}</div>
                          <div className="text-xs text-text-secondary">membership: {item.membershipId || '-'}</div>
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(item.accessLabel)}`}>
                            {item.accessLabel}
                          </span>
                        </td>
                        <td className="p-2 text-xs text-text-secondary">{item.accessLabel}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-2">
                            <button className="px-2 py-1 rounded text-xs bg-emerald-600/20 border border-emerald-500/30" onClick={() => handleFitnessCheckIn(item)}>
                              Check-in
                            </button>
                            <button className="px-2 py-1 rounded text-xs bg-amber-600/20 border border-amber-500/30" onClick={() => handleFitnessCheckOut(item)}>
                              Check-out
                            </button>
                            <button
                              className="px-2 py-1 rounded text-xs bg-bg-tertiary border border-border-default"
                              onClick={() => {
                                setActiveTab('fitness-student');
                                setSelectedFitnessSubject(item.subjectId);
                                loadFitnessDetail(item.subjectId);
                              }}
                            >
                              Detalhe
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === 'fitness-student' ? (
          <div>
            <div className="grid gap-3 md:grid-cols-6 mb-3">
              <input
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm md:col-span-4"
                placeholder="subjectId do aluno"
                value={fitnessStudentInput}
                onChange={(e) => setFitnessStudentInput(e.target.value)}
              />
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={() => loadFitnessDetail(fitnessStudentInput)} disabled={fitnessDetailLoading || !fitnessStudentInput}>
                {fitnessDetailLoading ? 'Carregando...' : 'Abrir detalhe'}
              </button>
              <button
                className="bg-bg-tertiary border border-border-default rounded px-2 py-2 text-sm"
                onClick={() => {
                  if (!fitnessDetail?.student?.subjectId) return;
                  loadFitnessDetail(fitnessDetail.student.subjectId);
                }}
                disabled={fitnessDetailLoading || !fitnessDetail?.student?.subjectId}
              >
                Refresh
              </button>
            </div>

            <SectionState
              loading={fitnessDetailLoading}
              error={fitnessDetailError}
              empty={!fitnessDetailLoading && !fitnessDetailError && !fitnessDetail}
              emptyMessage="Informe um subjectId para visualizar o detalhe operacional do aluno."
            />

            {fitnessDetail ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="bg-bg-tertiary border border-border-default rounded p-3">
                    <div className="text-xs text-text-secondary mb-1">Aluno</div>
                    <div className="text-sm font-medium">{fitnessDetail.student?.name || fitnessDetail.student?.subjectId}</div>
                    <div className="text-xs text-text-secondary">subject: {fitnessDetail.student?.subjectId}</div>
                    <div className="text-xs text-text-secondary">documento: {fitnessDetail.student?.document || '-'}</div>
                  </div>
                  <div className="bg-bg-tertiary border border-border-default rounded p-3">
                    <div className="text-xs text-text-secondary mb-1">Membership</div>
                    <div className="text-sm">{fitnessDetail.membership?.plan_name || '-'}</div>
                    <div className="text-xs text-text-secondary">status: {fitnessDetail.membership?.billing_status || '-'}</div>
                    <div className="text-xs text-text-secondary">id: {fitnessDetail.membership?.id || '-'}</div>
                  </div>
                  <div className="bg-bg-tertiary border border-border-default rounded p-3">
                    <div className="text-xs text-text-secondary mb-1">Acesso</div>
                    <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(fitnessDetail.accessStatus?.label)}`}>
                      {fitnessDetail.accessStatus?.label}
                    </span>
                    <div className="text-xs text-text-secondary mt-2">{fitnessDetail.accessStatus?.reasonCode || '-'}</div>
                  </div>
                  <div className="bg-bg-tertiary border border-border-default rounded p-3">
                    <div className="text-xs text-text-secondary mb-1">Frequencia</div>
                    <div className="text-sm">7d: {cardNumber(fitnessDetail.attendance?.frequency7d)}</div>
                    <div className="text-sm">30d: {cardNumber(fitnessDetail.attendance?.frequency30d)}</div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="bg-bg-tertiary border border-border-default rounded p-3">
                    <div className="text-xs text-text-secondary mb-2">Risco de evasao</div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(Number(fitnessDetail.churnRisk?.score || 0) >= 0.7 ? 'failed' : Number(fitnessDetail.churnRisk?.score || 0) >= 0.4 ? 'pending' : 'success')}`}>
                        score {Number(fitnessDetail.churnRisk?.score || 0).toFixed(2)}
                      </span>
                      <span className="text-sm text-text-secondary">{fitnessDetail.churnRisk?.reason || '-'}</span>
                    </div>
                  </div>

                  <div className="bg-bg-tertiary border border-border-default rounded p-3">
                    <div className="text-xs text-text-secondary mb-2">Alertas operacionais</div>
                    {(fitnessDetail.alerts || []).length ? (
                      <div className="space-y-2">
                        {fitnessDetail.alerts.map((alert, idx) => (
                          <div key={`${alert.type}-${idx}`} className="text-sm">
                            <span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(alert.severity === 'high' ? 'failed' : 'pending')}`}>{alert.type}</span>
                            <span className="ml-2 text-text-secondary">{alert.message}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-text-secondary">Sem alertas no momento.</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button className="px-3 py-2 rounded text-sm bg-emerald-600/20 border border-emerald-500/30" onClick={handleFitnessReactivation} disabled={!fitnessDetail.membership?.id}>
                    Reativar membership
                  </button>
                  <button
                    className="px-3 py-2 rounded text-sm bg-bg-tertiary border border-border-default"
                    onClick={() => openTimeline('fitness', fitnessDetail.student?.subjectId || '', '', fitnessDetail.membership?.id || '')}
                  >
                    Abrir timeline completa
                  </button>
                </div>

                <div>
                  <div className="text-xs text-text-secondary mb-2">Historico recente de presenca</div>
                  <div className="overflow-auto border border-border-default rounded">
                    <table className="w-full text-sm">
                      <thead className="bg-bg-elevated text-text-secondary">
                        <tr>
                          <th className="text-left p-2">Check-in</th>
                          <th className="text-left p-2">Check-out</th>
                          <th className="text-left p-2">Status</th>
                          <th className="text-left p-2">Duracao</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(fitnessDetail.attendance?.items || []).slice(0, 12).map((item) => (
                          <tr key={item.id} className="border-t border-border-default">
                            <td className="p-2">{item.checked_in_at ? new Date(item.checked_in_at).toLocaleString('pt-BR') : '-'}</td>
                            <td className="p-2">{item.checked_out_at ? new Date(item.checked_out_at).toLocaleString('pt-BR') : '-'}</td>
                            <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(item.status === 'absent' ? 'failed' : 'success')}`}>{item.status || '-'}</span></td>
                            <td className="p-2">{item.duration_minutes != null ? `${item.duration_minutes} min` : '-'}</td>
                          </tr>
                        ))}
                        {!(fitnessDetail.attendance?.items || []).length ? (
                          <tr>
                            <td className="p-2 text-text-secondary" colSpan={4}>Sem historico de presenca.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-text-secondary mb-2">Timeline do aluno</div>
                  <div className="overflow-auto border border-border-default rounded max-h-[280px]">
                    <table className="w-full text-sm">
                      <thead className="bg-bg-elevated text-text-secondary sticky top-0">
                        <tr>
                          <th className="text-left p-2">Timestamp</th>
                          <th className="text-left p-2">Evento</th>
                          <th className="text-left p-2">Status</th>
                          <th className="text-left p-2">Origem</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(fitnessDetail.timeline || []).slice(0, 20).map((item, idx) => (
                          <tr key={`${item.timestamp}-${idx}`} className="border-t border-border-default">
                            <td className="p-2">{item.timestamp ? new Date(item.timestamp).toLocaleString('pt-BR') : '-'}</td>
                            <td className="p-2">{item.eventType || '-'}</td>
                            <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(item.status)}`}>{item.status}</span></td>
                            <td className="p-2">{item.origin || '-'}</td>
                          </tr>
                        ))}
                        {!(fitnessDetail.timeline || []).length ? (
                          <tr>
                            <td className="p-2 text-text-secondary" colSpan={4}>Sem timeline para este aluno.</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

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
              <button className="bg-accent-primary rounded px-2 py-2 text-sm text-white" onClick={() => loadTimeline()} disabled={timelineLoading}>{timelineLoading ? 'Buscando...' : 'Buscar'}</button>
            </div>

            <SectionState
              loading={timelineLoading}
              error={timelineError}
              empty={!timelineLoading && !timelineError && !(timelineData?.items || []).length}
              emptyMessage="Nenhum evento encontrado para os filtros."
            />

            {(timelineData?.items || []).length ? (
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
                        <td className="p-2 text-xs text-text-secondary">{parseTimelineDetail(item)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
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

            <SectionState
              loading={jobsLoading}
              error={jobsError}
              empty={false}
              emptyMessage=""
            />

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
                    <th className="text-left p-2">Tipo do job</th>
                    <th className="text-left p-2">Tenant</th>
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
                      <td className="p-2">{job.tenantId || '-'}</td>
                      <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(job.status)}`}>{job.status}</span></td>
                      <td className="p-2">{job.startedAt ? new Date(job.startedAt).toLocaleString('pt-BR') : '-'}</td>
                      <td className="p-2">{job.durationMs != null ? `${job.durationMs}ms` : '-'}</td>
                      <td className="p-2">{job.attempt}</td>
                      <td className="p-2 text-xs text-text-secondary">{job.error || '-'}</td>
                    </tr>
                  ))}
                  {!(jobsData?.items || []).length ? (
                    <tr>
                      <td className="p-3 text-text-secondary" colSpan={7}>Nenhum job encontrado para os filtros.</td>
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

            <SectionState
              loading={notificationsLoading}
              error={notificationsError}
              empty={false}
              emptyMessage=""
            />

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

            <SectionState
              loading={insightsLoading}
              error={insightsError}
              empty={!insightsLoading && !insightsError && !(insightsData?.items || []).length}
              emptyMessage="Nenhum insight acionavel encontrado para os filtros atuais."
            />

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
                  <div className="mt-2">
                    <button className="px-2 py-1 rounded text-xs bg-bg-elevated border border-border-default" onClick={() => openTimeline(insight.vertical, insight.subjectId || '', insight.customerId || '', insight.membershipId || '')}>
                      Abrir timeline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {selectedAppointment ? (
        <div className="support-modal-overlay" onClick={() => setSelectedAppointment(null)}>
          <div className="support-modal-content" style={{ maxWidth: '640px', width: '96%' }} onClick={(event) => event.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Detalhes do agendamento</h3>
            <div className="grid gap-3 md:grid-cols-2 mb-3">
              <div>
                <div className="text-xs text-text-secondary">Cliente</div>
                <div className="text-sm">{selectedAppointment.clientName || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Profissional</div>
                <div className="text-sm">{selectedAppointment.professionalName || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Horario</div>
                <div className="text-sm">{selectedAppointment.startAt ? new Date(selectedAppointment.startAt).toLocaleString('pt-BR') : '-'}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Servico</div>
                <div className="text-sm">{selectedAppointment.service || '-'}</div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">Status</div>
                <div className="text-sm"><span className={`px-2 py-1 rounded text-xs ${statusBadgeClass(selectedAppointment.status)}`}>{selectedAppointment.status}</span></div>
              </div>
              <div>
                <div className="text-xs text-text-secondary">subjectId</div>
                <div className="text-sm">{selectedAppointment.subjectId || '-'}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" className="btn-base btn-default" onClick={() => setSelectedAppointment(null)}>Fechar</button>
              <button type="button" className="btn-base btn-default" onClick={() => handleNoShowAppointment(selectedAppointment)}>No-show</button>
              <button type="button" className="btn-base btn-primary" onClick={() => handleCompleteAppointment(selectedAppointment)}>Concluir</button>
            </div>
          </div>
        </div>
      ) : null}

      <ToastContainer />
    </CrudPageBase>
  );
}
