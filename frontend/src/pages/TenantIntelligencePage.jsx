import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import logger from '../utils/logger';
import {
  buildOperationalTrendTooltip,
  computeOperationalTrend,
  OPERATIONAL_STATE_LABELS,
} from '../utils/operationalTrend.mjs';
import {
  applyAllTenantRecommendations,
  applyTenantRecommendation,
  collectTenantMetricSnapshots,
  createTenantGoal,
  dismissTenantRecommendation,
  evaluateTenantRecommendationOutcome,
  getTenantOperationalState,
  listInsightEvidence,
  listTenantGoals,
  listTenantInsights,
  listTenantRecommendations,
  refreshTenantOperationalState,
  searchTenantIntelligence,
  updateTenantGoal,
} from '../api/intelligence';
import { getTenantCapabilities } from '../api/tenantCapabilities';
import { CrudPageBase } from '../modules/crud-base';
import { describeExecutedAction, executedActionToneClass, describeActionSignal, describeOutcomeReason } from '../modules/intelligence/executionFeedback';

function formatNumber(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}

function toPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return `${Math.round(n * 100)}%`;
}

function formatJsonForUi(value) {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

const EVIDENCE_PAGE_SIZE = 5;

const RECOMMENDATION_STATUS_LABELS = {
  open: 'Aberta',
  applied: 'Aplicada',
  dismissed: 'Dispensada',
  completed: 'Concluída',
};

const RECOMMENDATION_STATUS_STYLES = {
  open: 'border border-status-info/20 bg-status-info/10 text-status-info',
  applied: 'border border-status-warning/20 bg-status-warning/10 text-status-warning',
  dismissed: 'border border-border-default bg-text-secondary/10 text-text-secondary',
  completed: 'border border-status-success/20 bg-status-success/10 text-status-success',
};

const RECOMMENDATION_OUTCOME_LABELS = {
  improved: 'Resultado: melhorou',
  regressed: 'Resultado: piorou',
  unchanged: 'Resultado: sem mudança relevante',
  pending: 'Aguardando novos dados para medir o resultado',
};

const RECOMMENDATION_OUTCOME_STYLES = {
  improved: 'text-status-success',
  regressed: 'text-status-error',
  unchanged: 'text-text-secondary',
  pending: 'text-status-warning',
};

function formatRecommendationDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR');
}

function formatDeltaPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  // Contrato do backend: deltaPct é fração (ex.: -0.26) — exibir em pontos percentuais.
  const rounded = Math.round(n * 100);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function toCsvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function buildEvidenceCsv(items) {
  const header = [
    'id',
    'evidence_type',
    'source_type',
    'source_id',
    'excerpt',
    'structured_data',
    'metadata',
  ];

  const rows = items.map((evidence) => {
    const structuredData = evidence?.structured_data && typeof evidence.structured_data === 'object'
      ? JSON.stringify(evidence.structured_data)
      : '';
    const metadata = evidence?.metadata && typeof evidence.metadata === 'object'
      ? JSON.stringify(evidence.metadata)
      : '';

    return [
      evidence?.id || '',
      evidence?.evidence_type || '',
      evidence?.source_type || '',
      evidence?.source_id || '',
      evidence?.excerpt || '',
      structuredData,
      metadata,
    ].map(toCsvCell).join(',');
  });

  return [header.map(toCsvCell).join(','), ...rows].join('\n');
}

export function TenantIntelligencePage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [isLoading, setIsLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [operationalLoading, setOperationalLoading] = useState(false);

  const [question, setQuestion] = useState('Quais metas do tenant estão em maior risco e quais ações têm maior impacto no curto prazo?');
  const [period, setPeriod] = useState('month');

  const [searchResult, setSearchResult] = useState(null);
  const [operationalState, setOperationalState] = useState(null);
  const [previousOperationalScore, setPreviousOperationalScore] = useState(null);
  const [goals, setGoals] = useState([]);
  const [insights, setInsights] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [insightEvidenceMap, setInsightEvidenceMap] = useState({});
  const [insightEvidenceSourceFilterMap, setInsightEvidenceSourceFilterMap] = useState({});
  const [insightEvidencePageMap, setInsightEvidencePageMap] = useState({});
  const [expandedInsightId, setExpandedInsightId] = useState(null);
  const [evidenceLoadingId, setEvidenceLoadingId] = useState(null);
  const [recommendationActionLoadingId, setRecommendationActionLoadingId] = useState(null);
  const [autonomyLevel, setAutonomyLevel] = useState('suggest');
  const [batchApplyLoading, setBatchApplyLoading] = useState(false);

  const [goalForm, setGoalForm] = useState({
    name: '',
    metric_key: 'tickets.resolution_rate',
    target_value: '85',
    comparison_mode: 'gte',
    period_type: 'month',
    priority: 'medium',
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function loadInitialData() {
    setIsLoading(true);
    try {
      const [goalsResp, insightsResp, recommendationsResp, operationalResp, capabilitiesResp] = await Promise.all([
        listTenantGoals({ status: 'active', limit: 50 }),
        listTenantInsights({ status: 'open', limit: 20 }),
        listTenantRecommendations({ status: 'open', limit: 20 }),
        getTenantOperationalState({ period, mode: 'read', refreshMetrics: false, includeEvidence: false }),
        // Capacidades são auxiliares (nível de autonomia); falha não derruba a página.
        getTenantCapabilities().catch(() => null),
      ]);
      setGoals(Array.isArray(goalsResp?.items) ? goalsResp.items : []);
      setInsights(Array.isArray(insightsResp?.items) ? insightsResp.items : []);
      setRecommendations(Array.isArray(recommendationsResp?.items) ? recommendationsResp.items : []);
      setAutonomyLevel(capabilitiesResp?.capabilities?.autonomyLevel || 'suggest');
      setOperationalState((prev) => {
        const prevScore = Number(prev?.health?.score);
        const nextScore = Number(operationalResp?.state?.health?.score);
        if (Number.isFinite(prevScore) && Number.isFinite(nextScore) && prevScore !== nextScore) {
          setPreviousOperationalScore(prevScore);
        }
        return operationalResp?.state || null;
      });
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao carregar dados iniciais', error);
      showToast('Erro ao carregar Tenant Intelligence', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadInitialData();
    }
  }, [authLoading, isAuthenticated, period]);

  async function handleSearch(event) {
    event.preventDefault();
    if (!question.trim()) {
      showToast('Informe uma pergunta para a busca estratégica', 'error');
      return;
    }

    setSearching(true);
    try {
      const response = await searchTenantIntelligence({
        question: question.trim(),
        period,
        filters: {},
      });
      setSearchResult(response);

      const newGoals = response?.goalsImpact;
      const newInsights = response?.insights;
      const newRecommendations = response?.recommendations;

      if (Array.isArray(newGoals)) setGoals(newGoals);
      if (Array.isArray(newInsights)) setInsights(newInsights);
      if (Array.isArray(newRecommendations)) setRecommendations(newRecommendations);

      showToast('Busca estratégica concluída', 'success');
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro na busca estratégica', error);
      showToast('Erro ao executar busca estratégica', 'error');
    } finally {
      setSearching(false);
    }
  }

  async function handleSnapshotRefresh() {
    setSnapshotLoading(true);
    try {
      await collectTenantMetricSnapshots({ period, filters: {} });
      await loadInitialData();
      showToast('Snapshots atualizados com sucesso', 'success');
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao atualizar snapshots', error);
      showToast('Erro ao atualizar snapshots', 'error');
    } finally {
      setSnapshotLoading(false);
    }
  }

  async function handleOperationalRefresh() {
    setOperationalLoading(true);
    try {
      const response = await refreshTenantOperationalState({ period, includeEvidence: false });
      setOperationalState((prev) => {
        const prevScore = Number(prev?.health?.score);
        const nextScore = Number(response?.state?.health?.score);
        if (Number.isFinite(prevScore) && Number.isFinite(nextScore) && prevScore !== nextScore) {
          setPreviousOperationalScore(prevScore);
        }
        return response?.state || null;
      });

      const stateGoals = response?.state?.goals?.items;
      const stateInsights = response?.state?.insights?.items;
      const stateRecommendations = response?.state?.recommendations?.items;
      if (Array.isArray(stateGoals)) setGoals(stateGoals);
      if (Array.isArray(stateInsights)) setInsights(stateInsights);
      if (Array.isArray(stateRecommendations)) setRecommendations(stateRecommendations);

      showToast('Estado operacional atualizado', 'success');
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao atualizar estado operacional', error);
      showToast('Erro ao atualizar estado operacional', 'error');
    } finally {
      setOperationalLoading(false);
    }
  }

  async function handleCreateGoal(event) {
    event.preventDefault();
    if (!goalForm.name.trim() || !goalForm.metric_key.trim() || goalForm.target_value === '') {
      showToast('Preencha nome, metric_key e target_value da meta', 'error');
      return;
    }

    try {
      await createTenantGoal({
        ...goalForm,
        name: goalForm.name.trim(),
        metric_key: goalForm.metric_key.trim(),
        target_value: Number(goalForm.target_value),
      });
      setGoalForm((prev) => ({
        ...prev,
        name: '',
      }));
      await loadInitialData();
      showToast('Meta criada com sucesso', 'success');
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao criar meta', error);
      showToast('Erro ao criar meta', 'error');
    }
  }

  async function handleUpdateCurrentValue(goal) {
    const currentValue = window.prompt(`Atualizar valor atual da meta "${goal?.name || ''}"`, String(goal?.current_value ?? ''));
    if (currentValue === null) return;

    const parsed = Number(currentValue);
    if (!Number.isFinite(parsed)) {
      showToast('Valor atual inválido', 'error');
      return;
    }

    try {
      await updateTenantGoal(goal.id, { current_value: parsed });
      await loadInitialData();
      showToast('Meta atualizada com sucesso', 'success');
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao atualizar meta', error);
      showToast('Erro ao atualizar meta', 'error');
    }
  }

  async function handleToggleInsightEvidence(insightId) {
    if (!insightId) return;

    if (expandedInsightId === insightId) {
      setExpandedInsightId(null);
      return;
    }

    setExpandedInsightId(insightId);

    if (insightEvidenceMap[insightId]) {
      return;
    }

    setEvidenceLoadingId(insightId);
    try {
      const response = await listInsightEvidence(insightId);
      setInsightEvidenceMap((prev) => ({
        ...prev,
        [insightId]: Array.isArray(response?.items) ? response.items : [],
      }));
      setInsightEvidenceSourceFilterMap((prev) => ({
        ...prev,
        [insightId]: 'all',
      }));
      setInsightEvidencePageMap((prev) => ({
        ...prev,
        [insightId]: 1,
      }));
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao carregar evidências do insight', error);
      showToast('Erro ao carregar evidências do insight', 'error');
    } finally {
      setEvidenceLoadingId(null);
    }
  }

  function upsertRecommendationInState(updated) {
    if (!updated || !updated.id) return;
    const merge = (items) => items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item));
    setRecommendations((prev) => merge(prev));
    setSearchResult((prev) => {
      if (!prev || !Array.isArray(prev.recommendations)) return prev;
      return { ...prev, recommendations: merge(prev.recommendations) };
    });
  }

  function resolveRecommendationActionError(error, fallbackMessage) {
    const status = error?.status ?? error?.httpStatus;
    const code = typeof error?.body?.error === 'string' ? error.body.error : error?.code;
    if (status === 403 || code === 'forbidden') {
      return { message: 'Sem permissão para aplicar recomendações', refresh: false };
    }
    if (status === 404 || code === 'recommendation_not_found') {
      return { message: 'Recomendação não encontrada. A lista será atualizada.', refresh: true };
    }
    if (status === 409 || code === 'recommendation_not_open' || code === 'recommendation_not_applied') {
      return { message: 'Esta recomendação mudou de estado. A lista será atualizada.', refresh: true };
    }
    return { message: fallbackMessage, refresh: false };
  }

  async function runRecommendationAction(recommendation, action, fallbackMessage, successMessage) {
    if (!recommendation?.id) return;
    setRecommendationActionLoadingId(recommendation.id);
    try {
      const response = await action();
      if (response?.recommendation) {
        upsertRecommendationInState(response.recommendation);
      }
      showToast(successMessage, 'success');
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro em ação de recomendação', error);
      const { message, refresh } = resolveRecommendationActionError(error, fallbackMessage);
      showToast(message, 'error');
      if (refresh) {
        await loadInitialData();
      }
    } finally {
      setRecommendationActionLoadingId(null);
    }
  }

  function handleApplyRecommendation(recommendation) {
    return runRecommendationAction(
      recommendation,
      () => applyTenantRecommendation(recommendation.id),
      'Erro ao aplicar recomendação',
      'Recomendação aplicada',
    );
  }

  // "Aprovar todas" (autonomia = approve): aplica em lote as recomendações
  // abertas e recarrega a lista de abertas para refletir o novo estado.
  async function handleApplyAllRecommendations() {
    setBatchApplyLoading(true);
    try {
      const response = await applyAllTenantRecommendations({ limit: 50 });
      const applied = Number(response?.applied) || 0;
      const failed = Number(response?.failed) || 0;
      showToast(
        failed > 0
          ? `${applied} recomendações aplicadas; ${failed} não puderam ser aplicadas`
          : `${applied} recomendações aplicadas`,
        failed > 0 ? 'error' : 'success',
      );
      const openResp = await listTenantRecommendations({ status: 'open', limit: 20 });
      const openItems = Array.isArray(openResp?.items) ? openResp.items : [];
      setRecommendations(openItems);
      setSearchResult((prev) => (
        prev && Array.isArray(prev.recommendations) ? { ...prev, recommendations: openItems } : prev
      ));
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao aplicar recomendações em lote', error);
      const { message, refresh } = resolveRecommendationActionError(error, 'Erro ao aplicar recomendações em lote');
      showToast(message, 'error');
      if (refresh) {
        await loadInitialData();
      }
    } finally {
      setBatchApplyLoading(false);
    }
  }

  async function handleDismissRecommendation(recommendation) {
    if (!recommendation?.id) return;
    const reason = window.prompt('Motivo para dispensar a recomendação (opcional)', '');
    if (reason === null) return;
    return runRecommendationAction(
      recommendation,
      () => dismissTenantRecommendation(recommendation.id, reason),
      'Erro ao dispensar recomendação',
      'Recomendação dispensada',
    );
  }

  function handleEvaluateRecommendationOutcome(recommendation) {
    return runRecommendationAction(
      recommendation,
      () => evaluateTenantRecommendationOutcome(recommendation.id),
      'Erro ao avaliar resultado',
      'Resultado avaliado',
    );
  }

  const activeGoalsCount = searchResult?.goalsImpact
    ? searchResult.goalsImpact.length
    : goals.length;
  const offTrackCount = searchResult?.goalsImpact
    ? searchResult.goalsImpact.filter((g) => g.status === 'off_track').length
    : null;
  const ragConfidence = searchResult?.meta?.ragConfidence ?? null;
  const tenantObjective = searchResult?.context?.tenant?.objetivo || null;
  const operationalHealth = operationalState?.health || null;
  const operationalStatus = operationalHealth?.status || null;
  const operationalScore = operationalHealth?.score;
  const operationalReasons = Array.isArray(operationalHealth?.reasons) ? operationalHealth.reasons : [];
  const operationalGeneratedAt = operationalState?.generatedAt || null;
  const operationalTrend = useMemo(
    () => computeOperationalTrend(operationalScore, previousOperationalScore),
    [operationalScore, previousOperationalScore],
  );
  const operationalTrendTooltip = useMemo(() => {
    return buildOperationalTrendTooltip(operationalScore, previousOperationalScore);
  }, [operationalScore, previousOperationalScore]);

  const topInsights = useMemo(() => {
    if (Array.isArray(searchResult?.insights) && searchResult.insights.length > 0) {
      return searchResult.insights.slice(0, 5);
    }
    return insights.slice(0, 5);
  }, [searchResult, insights]);

  const topRecommendations = useMemo(() => {
    if (Array.isArray(searchResult?.recommendations) && searchResult.recommendations.length > 0) {
      return searchResult.recommendations.slice(0, 5);
    }
    return recommendations.slice(0, 5);
  }, [searchResult, recommendations]);

  const getFilteredEvidence = (insightId) => {
    const allEvidence = insightEvidenceMap[insightId] || [];
    const selectedSourceType = insightEvidenceSourceFilterMap[insightId] || 'all';
    if (selectedSourceType === 'all') return allEvidence;
    return allEvidence.filter((evidence) => String(evidence.source_type || '') === selectedSourceType);
  };

  const getEvidenceSourceOptions = (insightId) => {
    const allEvidence = insightEvidenceMap[insightId] || [];
    const values = Array.from(new Set(allEvidence.map((evidence) => String(evidence.source_type || '')).filter(Boolean)));
    return values;
  };

  const getEvidencePagination = (insightId) => {
    const filteredEvidence = getFilteredEvidence(insightId);
    const totalPages = Math.max(1, Math.ceil(filteredEvidence.length / EVIDENCE_PAGE_SIZE));
    const rawCurrentPage = Number(insightEvidencePageMap[insightId] || 1);
    const currentPage = Math.max(1, Math.min(rawCurrentPage, totalPages));
    const start = (currentPage - 1) * EVIDENCE_PAGE_SIZE;
    const pagedEvidence = filteredEvidence.slice(start, start + EVIDENCE_PAGE_SIZE);

    return {
      currentPage,
      totalPages,
      filteredCount: filteredEvidence.length,
      pagedEvidence,
    };
  };

  const handleChangeInsightEvidenceSourceFilter = (insightId, sourceType) => {
    setInsightEvidenceSourceFilterMap((prev) => ({
      ...prev,
      [insightId]: sourceType,
    }));
    setInsightEvidencePageMap((prev) => ({
      ...prev,
      [insightId]: 1,
    }));
  };

  const handleChangeInsightEvidencePage = (insightId, nextPage) => {
    setInsightEvidencePageMap((prev) => ({
      ...prev,
      [insightId]: nextPage,
    }));
  };

  const handleExportInsightEvidence = (insightId, format) => {
    const filteredEvidence = getFilteredEvidence(insightId);
    if (!Array.isArray(filteredEvidence) || filteredEvidence.length === 0) {
      showToast('Não há evidências para exportar no filtro atual', 'error');
      return;
    }

    try {
      if (format === 'csv') {
        const csv = buildEvidenceCsv(filteredEvidence);
        downloadTextFile(`insight-${insightId}-evidence.csv`, csv, 'text/csv;charset=utf-8');
      } else {
        const json = JSON.stringify(filteredEvidence, null, 2);
        downloadTextFile(`insight-${insightId}-evidence.json`, json, 'application/json;charset=utf-8');
      }
      showToast('Exportação de evidências concluída', 'success');
    } catch (error) {
      logger.error('[TenantIntelligencePage] Erro ao exportar evidências', error);
      showToast('Erro ao exportar evidências', 'error');
    }
  };

  if (authLoading) {
    return (
      <CrudPageBase>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>🧠 Inteligência do Tenant</h1>
        <div className="support-controls" style={{ flexWrap: 'wrap' }}>
          <Button onClick={handleSnapshotRefresh} disabled={snapshotLoading} style={{ width: 'auto' }}>
            {snapshotLoading ? 'Atualizando snapshots...' : 'Atualizar snapshots'}
          </Button>
          <Button onClick={handleOperationalRefresh} disabled={operationalLoading} style={{ width: 'auto' }}>
            {operationalLoading ? 'Atualizando estado...' : 'Atualizar estado operacional'}
          </Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-lg font-semibold text-text-primary mb-3">{OPERATIONAL_STATE_LABELS.sectionTitle}</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-3">
          <div>
            <div className="text-xs text-text-secondary">{OPERATIONAL_STATE_LABELS.health}</div>
            <div className="text-xl font-semibold text-text-primary">{operationalStatus || '-'}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary" title={operationalTrendTooltip}>{OPERATIONAL_STATE_LABELS.score}</div>
            <div className="text-xl font-semibold text-text-primary" title={operationalTrendTooltip}>
              {Number.isFinite(Number(operationalScore)) ? Number(operationalScore) : '-'}
            </div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">{OPERATIONAL_STATE_LABELS.openInsights}</div>
            <div className="text-xl font-semibold text-text-primary">{operationalState?.insights?.totalOpen ?? '-'}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary">{OPERATIONAL_STATE_LABELS.openRecommendations}</div>
            <div className="text-xl font-semibold text-text-primary">{operationalState?.recommendations?.totalOpen ?? '-'}</div>
          </div>
          <div>
            <div className="text-xs text-text-secondary" title={operationalTrendTooltip}>{OPERATIONAL_STATE_LABELS.trend}</div>
            <div className="text-xl font-semibold text-text-primary" title={operationalTrendTooltip}>
              {operationalTrend.label}
              {' '}
              <span className="text-sm">{operationalTrend.detail}</span>
            </div>
          </div>
        </div>
        {operationalReasons.length > 0 ? (
          <ul className="text-sm text-text-secondary" style={{ marginLeft: '16px', listStyle: 'disc' }}>
            {operationalReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-text-secondary">{OPERATIONAL_STATE_LABELS.noCriticalAlerts}</p>
        )}
        <div className="text-xs text-text-secondary" style={{ marginTop: '8px' }}>
          {OPERATIONAL_STATE_LABELS.updatedAt} {operationalGeneratedAt || '-'}
        </div>
      </div>

      <form
        className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg"
        onSubmit={handleSearch}
      >
        <h3 className="text-lg font-semibold text-text-primary mb-4">Busca estratégica</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <label className="md:col-span-3 text-sm text-text-secondary">
            Pergunta
            <textarea
              className="support-form-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              placeholder="Ex: Quais metas estão fora da meta neste mês e quais ações priorizar?"
            />
          </label>
          <label className="text-sm text-text-secondary">
            Período
            <select
              className="support-form-select"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="day">Dia</option>
              <option value="week">Semana</option>
              <option value="month">Mês</option>
              <option value="quarter">Trimestre</option>
            </select>
          </label>
        </div>
        <Button type="submit" disabled={searching} style={{ width: 'auto' }}>
          {searching ? 'Analisando...' : 'Executar busca'}
        </Button>
      </form>

      {searchResult?.answer && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-lg font-semibold text-text-primary mb-3">Análise estratégica</h3>
          <p className="text-sm text-text-primary" style={{ whiteSpace: 'pre-wrap' }}>{searchResult.answer}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-secondary">Metas ativas</div>
          <div className="text-2xl font-semibold text-text-primary">{activeGoalsCount}</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-secondary">Metas em risco</div>
          <div className="text-2xl font-semibold text-status-warning">{offTrackCount ?? '-'}</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-secondary">Confiança RAG</div>
          <div className="text-2xl font-semibold text-text-primary">{ragConfidence != null ? toPercent(ragConfidence) : '-'}</div>
        </div>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div className="text-xs text-text-secondary">Objetivo principal</div>
          <div className="text-sm font-medium text-text-primary">{tenantObjective || 'Não informado'}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h3 className="text-lg font-semibold text-text-primary mb-3">Top Insights</h3>
          {topInsights.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhum insight disponível.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {topInsights.map((item) => (
                <li key={item.id || item.title} className="border border-border-default rounded-lg p-3">
                  <div className="font-medium text-text-primary">{item.title || item.type || 'Insight'}</div>
                  <div className="text-text-secondary">
                    impacto: {item.impact || '-'} | confiança: {formatNumber(item.confidence, 2)}
                  </div>
                  {Array.isArray(item.metadata?.probableCauses) && item.metadata.probableCauses.length > 0 ? (
                    <div className="text-text-secondary" style={{ marginTop: '4px' }}>
                      Possíveis causas: {item.metadata.probableCauses
                        .map((cause) => `${cause.metricKey} (${cause.direction === 'up' ? '+' : ''}${Math.round(cause.changeRatio * 100)}%)`)
                        .join(', ')}
                    </div>
                  ) : null}
                  {item.metadata?.projection ? (
                    <div className="text-text-secondary" style={{ marginTop: '4px' }}>
                      Projeção de fechamento: ~{formatNumber(item.metadata.projection.projectedValue)} vs alvo {formatNumber(item.metadata.projection.targetValue)}
                      ({item.metadata.projection.projectedStatus === 'will_meet' ? 'atinge a meta' : 'não atinge a meta'})
                    </div>
                  ) : null}
                  {item.id ? (
                    <div style={{ marginTop: '8px' }}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        style={{ width: 'auto' }}
                        onClick={() => handleToggleInsightEvidence(item.id)}
                      >
                        {expandedInsightId === item.id ? 'Ocultar evidências' : 'Ver evidências'}
                      </Button>
                    </div>
                  ) : null}

                  {expandedInsightId === item.id ? (
                    <div className="mt-2 text-xs text-text-secondary" style={{ marginTop: '10px' }}>
                      {evidenceLoadingId === item.id ? (
                        <div>Carregando evidências...</div>
                      ) : (
                        <>
                          {getEvidenceSourceOptions(item.id).length > 0 ? (
                            <div className="mb-2">
                              <label>
                                Filtrar fonte:
                                <select
                                  className="support-form-select"
                                  style={{ marginLeft: '8px', width: 'auto' }}
                                  value={insightEvidenceSourceFilterMap[item.id] || 'all'}
                                  onChange={(event) => {
                                    handleChangeInsightEvidenceSourceFilter(item.id, event.target.value);
                                  }}
                                >
                                  <option value="all">Todas</option>
                                  {getEvidenceSourceOptions(item.id).map((sourceType) => (
                                    <option key={sourceType} value={sourceType}>{sourceType}</option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          ) : null}

                          {(() => {
                            const pagination = getEvidencePagination(item.id);
                            return (
                              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  style={{ width: 'auto' }}
                                  onClick={() => handleExportInsightEvidence(item.id, 'json')}
                                >
                                  Exportar JSON
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  style={{ width: 'auto' }}
                                  onClick={() => handleExportInsightEvidence(item.id, 'csv')}
                                >
                                  Exportar CSV
                                </Button>
                                <span style={{ alignSelf: 'center' }}>
                                  {pagination.filteredCount} evidências no filtro atual
                                </span>
                              </div>
                            );
                          })()}

                          <ul className="space-y-1">
                            {getEvidencePagination(item.id).filteredCount === 0 ? (
                              <li>Nenhuma evidência para o filtro selecionado.</li>
                            ) : null}
                            {(insightEvidenceMap[item.id] || []).length === 0 ? (
                              <li>Nenhuma evidência registrada para este insight.</li>
                            ) : (
                              getEvidencePagination(item.id).pagedEvidence.map((evidence) => (
                                <li key={evidence.id || `${item.id}-${evidence.source_type}-${evidence.source_id || 'na'}`}>
                                  <strong>{evidence.evidence_type || 'evidence'}</strong>
                                  {' '}| fonte: {evidence.source_type || '-'}
                                  {evidence.source_id ? ` (${evidence.source_id})` : ''}
                                  {evidence.excerpt ? ` | ${evidence.excerpt}` : ''}
                                  {formatJsonForUi(evidence.structured_data) ? (
                                    <details style={{ marginTop: '6px' }}>
                                      <summary>structured_data</summary>
                                      <pre style={{ whiteSpace: 'pre-wrap', marginTop: '4px' }}>
                                        {formatJsonForUi(evidence.structured_data)}
                                      </pre>
                                    </details>
                                  ) : null}
                                  {formatJsonForUi(evidence.metadata) ? (
                                    <details style={{ marginTop: '6px' }}>
                                      <summary>metadata</summary>
                                      <pre style={{ whiteSpace: 'pre-wrap', marginTop: '4px' }}>
                                        {formatJsonForUi(evidence.metadata)}
                                      </pre>
                                    </details>
                                  ) : null}
                                </li>
                              ))
                            )}
                          </ul>

                          {(() => {
                            const pagination = getEvidencePagination(item.id);
                            if (pagination.totalPages <= 1 || pagination.filteredCount === 0) {
                              return null;
                            }
                            return (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={pagination.currentPage <= 1}
                                  style={{ width: 'auto' }}
                                  onClick={() => handleChangeInsightEvidencePage(item.id, pagination.currentPage - 1)}
                                >
                                  Anterior
                                </Button>
                                <span>
                                  Página {pagination.currentPage} de {pagination.totalPages}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  disabled={pagination.currentPage >= pagination.totalPages}
                                  style={{ width: 'auto' }}
                                  onClick={() => handleChangeInsightEvidencePage(item.id, pagination.currentPage + 1)}
                                >
                                  Próxima
                                </Button>
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <div className="flex items-center justify-between gap-2 mb-3" style={{ flexWrap: 'wrap' }}>
            <h3 className="text-lg font-semibold text-text-primary">Top Recomendações</h3>
            {autonomyLevel === 'approve' && topRecommendations.some((item) => item.status === 'open') ? (
              <Button
                type="button"
                size="sm"
                style={{ width: 'auto' }}
                disabled={batchApplyLoading}
                onClick={handleApplyAllRecommendations}
              >
                {batchApplyLoading ? 'Aplicando em lote...' : 'Aprovar todas as recomendações abertas'}
              </Button>
            ) : null}
          </div>
          {topRecommendations.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhuma recomendação disponível.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {topRecommendations.map((item) => {
                const outcome = item.metadata?.outcome || null;
                const outcomeKey = outcome?.outcome || 'pending';
                const outcomeMetrics = Array.isArray(outcome?.metrics) ? outcome.metrics : [];
                const executedAction = item.metadata?.application?.executedAction || null;
                return (
                  <li
                    key={item.id || item.title}
                    className={`border border-border-default rounded-lg p-3 ${item.status === 'dismissed' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-text-primary">{item.title || 'Recomendação'}</div>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${RECOMMENDATION_STATUS_STYLES[item.status] || RECOMMENDATION_STATUS_STYLES.open}`}>
                        {RECOMMENDATION_STATUS_LABELS[item.status] || RECOMMENDATION_STATUS_LABELS.open}
                      </span>
                    </div>
                    <div className="text-text-secondary">
                      prioridade: {item.priority || '-'} | tipo: {item.action_type || '-'}
                    </div>
                    {item.description ? (
                      <div className="text-text-secondary" style={{ marginTop: '4px' }}>{item.description}</div>
                    ) : null}

                    {item.status === 'applied' ? (
                      <div className="text-text-secondary" style={{ marginTop: '4px' }}>
                        Aplicada em {formatRecommendationDate(item.metadata?.application?.appliedAt)}
                        {item.metadata?.application?.origin === 'auto' ? (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold border border-status-success/20 bg-status-success/10 text-status-success" style={{ marginLeft: '8px' }}>
                            Aplicada automaticamente
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {(() => {
                      const feedback = describeExecutedAction(executedAction);
                      if (!feedback) return null;
                      return (
                        <div
                          className={executedActionToneClass(feedback.tone)}
                          style={{ marginTop: '4px' }}
                        >
                          {feedback.message}
                        </div>
                      );
                    })()}

                    {outcome ? (
                      <div style={{ marginTop: '8px' }}>
                        <div className={`font-medium ${RECOMMENDATION_OUTCOME_STYLES[outcomeKey] || RECOMMENDATION_OUTCOME_STYLES.pending}`}>
                          {RECOMMENDATION_OUTCOME_LABELS[outcomeKey] || RECOMMENDATION_OUTCOME_LABELS.pending}
                        </div>
                        {outcomeMetrics.length > 0 ? (
                          <ul className="text-text-secondary" style={{ marginLeft: '16px', listStyle: 'disc' }}>
                            {outcomeMetrics.map((metric) => {
                              const deltaPct = formatDeltaPct(metric.deltaPct);
                              return (
                                <li key={metric.metricKey}>
                                  {metric.metricKey}: {formatNumber(metric.baselineValue)} → {formatNumber(metric.currentValue)}
                                  {deltaPct ? ` (${deltaPct})` : ''}
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                        {(Array.isArray(outcome.actionSignals) ? outcome.actionSignals : []).map((signal, signalIndex) => {
                          const signalFeedback = describeActionSignal(signal);
                          if (!signalFeedback) return null;
                          return (
                            <div
                              key={`signal-${signal.type || signalIndex}`}
                              className={executedActionToneClass(signalFeedback.tone)}
                              style={{ marginTop: '4px' }}
                            >
                              {signalFeedback.message}
                            </div>
                          );
                        })}
                        {outcome.reason ? (
                          <div className="text-text-secondary">{describeOutcomeReason(outcome.reason)}</div>
                        ) : null}
                      </div>
                    ) : null}

                    {item.id && item.status === 'open' ? (
                      <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <Button
                          type="button"
                          size="sm"
                          style={{ width: 'auto' }}
                          disabled={recommendationActionLoadingId === item.id}
                          onClick={() => handleApplyRecommendation(item)}
                        >
                          Aplicar recomendação
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          style={{ width: 'auto' }}
                          disabled={recommendationActionLoadingId === item.id}
                          onClick={() => handleDismissRecommendation(item)}
                        >
                          Dispensar
                        </Button>
                      </div>
                    ) : null}

                    {item.id && item.status === 'applied' ? (
                      <div style={{ marginTop: '8px' }}>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          style={{ width: 'auto' }}
                          disabled={recommendationActionLoadingId === item.id}
                          onClick={() => handleEvaluateRecommendationOutcome(item)}
                        >
                          Avaliar resultado
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <form className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg" onSubmit={handleCreateGoal}>
          <h3 className="text-lg font-semibold text-text-primary mb-3">Nova Meta</h3>
          <div className="space-y-3">
            <input
              className="support-form-input"
              value={goalForm.name}
              placeholder="Nome da meta"
              onChange={(e) => setGoalForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="support-form-input"
              value={goalForm.metric_key}
              placeholder="metric_key (ex: tickets.resolution_rate)"
              onChange={(e) => setGoalForm((prev) => ({ ...prev, metric_key: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className="support-form-input"
                type="number"
                value={goalForm.target_value}
                placeholder="Target"
                onChange={(e) => setGoalForm((prev) => ({ ...prev, target_value: e.target.value }))}
              />
              <select
                className="support-form-select"
                value={goalForm.comparison_mode}
                onChange={(e) => setGoalForm((prev) => ({ ...prev, comparison_mode: e.target.value }))}
              >
                <option value="gte">Maior ou igual (gte)</option>
                <option value="lte">Menor ou igual (lte)</option>
                <option value="eq">Igual (eq)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                className="support-form-select"
                value={goalForm.period_type}
                onChange={(e) => setGoalForm((prev) => ({ ...prev, period_type: e.target.value }))}
              >
                <option value="day">Dia</option>
                <option value="week">Semana</option>
                <option value="month">Mês</option>
                <option value="quarter">Trimestre</option>
              </select>
              <select
                className="support-form-select"
                value={goalForm.priority}
                onChange={(e) => setGoalForm((prev) => ({ ...prev, priority: e.target.value }))}
              >
                <option value="low">Baixa</option>
                <option value="medium">Média</option>
                <option value="high">Alta</option>
                <option value="critical">Crítica</option>
              </select>
            </div>
            <Button type="submit" style={{ width: 'auto' }}>Criar meta</Button>
          </div>
        </form>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          <h3 className="text-lg font-semibold text-text-primary mb-3">Metas Ativas</h3>
          {isLoading ? (
            <p className="text-sm text-text-secondary">Carregando metas...</p>
          ) : goals.length === 0 ? (
            <p className="text-sm text-text-secondary">Nenhuma meta ativa cadastrada.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {goals.map((goal) => (
                <li key={goal.id} className="border border-border-default rounded-lg p-3">
                  <div className="font-medium text-text-primary">{goal.name}</div>
                  <div className="text-text-secondary mb-2">
                    {goal.metric_key} | atual: {formatNumber(goal.current_value, 2)} | alvo: {formatNumber(goal.target_value, 2)}
                  </div>
                  <div className="text-text-secondary mb-2">
                    status: {goal.computed?.computedStatus || goal.status || '-'} | progresso: {goal.computed?.progressPercent ?? '-'}%
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    style={{ width: 'auto' }}
                    onClick={() => handleUpdateCurrentValue(goal)}
                  >
                    Atualizar valor atual
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ToastContainer />
    </CrudPageBase>
  );
}
