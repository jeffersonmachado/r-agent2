import React, { useEffect, useMemo, useState } from 'react';
import * as superAdminApi from '../api/superAdmin';
import logger from '../utils/logger';
import { OutcomeList } from '../components/operational/OutcomeList';
import { useOperationalOutcomes } from '../hooks/useOperationalOutcomes';
import {
  PlatformDashboardPage,
  PlatformDashboardHeader,
  PlatformDashboardSection,
  PlatformKpiCard,
  PlatformDashboardLoadingState,
  PlatformDashboardEmptyState,
} from '../modules/platform-dashboard';
import { PlatformGrid } from '../modules/platform-grid';
import {
  CRMTimelineSummaryCard,
  PlaybookExecutionModal,
  PlaybookSuggestionCard,
  OperationalRecommendationsCard,
  OperationalSignalsCard,
  useCrmTimelineSummary,
  usePlaybookExecution,
  usePlaybooks,
  useOperationalRecommendations,
  useOperationalSignals,
} from '../modules/crm';

function riskTone(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'red' || normalized === 'high') return 'text-status-error';
  if (normalized === 'yellow' || normalized === 'medium') return 'text-status-warning';
  return 'text-status-success';
}

function riskBadge(value) {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'red' || normalized === 'high') return 'bg-status-error/20 text-status-error border-status-error/30';
  if (normalized === 'yellow' || normalized === 'medium') return 'bg-status-warning/20 text-status-warning border-status-warning/30';
  return 'bg-status-success/20 text-status-success border-status-success/30';
}

export function OperationalControlCenter() {
  const [loading, setLoading] = useState(true);
  const [savingFlag, setSavingFlag] = useState('');
  const [summary, setSummary] = useState(null);
  const [selectedTenant, setSelectedTenant] = useState('');
  const [tenantMetrics, setTenantMetrics] = useState(null);
  const [tenantAlerts, setTenantAlerts] = useState([]);
  const [tenantAudit, setTenantAudit] = useState([]);
  const [tenantFlags, setTenantFlags] = useState([]);
  const [activePlaybook, setActivePlaybook] = useState(null);
  const [playbookModalOpen, setPlaybookModalOpen] = useState(false);
  const [outcomeFilters, setOutcomeFilters] = useState({
    status: '',
    sourceType: '',
    outcomeType: '',
    signalId: '',
    recommendationId: '',
    playbookExecutionId: '',
    from: '',
    to: '',
  });

  async function loadSummary() {
    const out = await superAdminApi.getOccTenantsHealth();
    setSummary(out);
    const firstTenant = out.items?.[0]?.tenantId || '';
    setSelectedTenant((current) => current || firstTenant);
  }

  async function loadTenantDetail(tenantId) {
    if (!tenantId) return;
    const [metricsOut, alertsOut, auditOut, flagsOut] = await Promise.all([
      superAdminApi.getOccTenantMetrics(tenantId),
      superAdminApi.getOccTenantAlerts(tenantId, { limit: 20 }),
      superAdminApi.getOccTenantUraAudit(tenantId, { limit: 20 }),
      superAdminApi.getOccTenantFeatureFlags(tenantId),
    ]);
    setTenantMetrics(metricsOut.item || null);
    setTenantAlerts(alertsOut.items || []);
    setTenantAudit(auditOut.items || []);
    setTenantFlags(flagsOut.items || []);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        setLoading(true);
        const out = await superAdminApi.getOccTenantsHealth();
        if (!mounted) return;
        setSummary(out);
        setSelectedTenant((current) => current || out.items?.[0]?.tenantId || '');
      } catch (err) {
        logger.error('Erro ao carregar OCC', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!selectedTenant) return () => { mounted = false; };
    (async () => {
      try {
        const [metricsOut, alertsOut, auditOut, flagsOut] = await Promise.all([
          superAdminApi.getOccTenantMetrics(selectedTenant),
          superAdminApi.getOccTenantAlerts(selectedTenant, { limit: 20 }),
          superAdminApi.getOccTenantUraAudit(selectedTenant, { limit: 20 }),
          superAdminApi.getOccTenantFeatureFlags(selectedTenant),
        ]);
        if (!mounted) return;
        setTenantMetrics(metricsOut.item || null);
        setTenantAlerts(alertsOut.items || []);
        setTenantAudit(auditOut.items || []);
        setTenantFlags(flagsOut.items || []);
      } catch (err) {
        logger.error('Erro ao carregar detalhe OCC', err);
      }
    })();
    return () => { mounted = false; };
  }, [selectedTenant]);

  const snapshot = tenantMetrics?.snapshot_payload_json || null;
  const supportCockpitFlag = tenantFlags.find((flag) => flag.featureKey === 'support_cockpit_enabled') || null;
  const {
    summary: crmOperationalSummary,
    loading: crmSummaryLoading,
    error: crmSummaryError,
    reload: reloadCrmSummary,
  } = useCrmTimelineSummary({
    tenantId: selectedTenant,
    enabled: Boolean(selectedTenant),
    recentWindowHours: 72,
  });
  const operationalSignals = useOperationalSignals({
    tenantId: selectedTenant,
    scope: 'tenant',
    enabled: Boolean(selectedTenant),
    activeOnly: true,
    limit: 100,
  });
  const operationalRecommendations = useOperationalRecommendations({
    tenantId: selectedTenant,
    scope: 'tenant',
    enabled: Boolean(selectedTenant),
    limit: 100,
  });
  const playbooksCatalog = usePlaybooks({
    scope: 'tenant',
    enabled: true,
    limit: 100,
  });
  const playbookExecution = usePlaybookExecution();
  const operationalOutcomes = useOperationalOutcomes({
    tenantId: selectedTenant,
    enabled: Boolean(selectedTenant),
    limit: 20,
    status: outcomeFilters.status,
    sourceType: outcomeFilters.sourceType,
    outcomeType: outcomeFilters.outcomeType,
    signalId: outcomeFilters.signalId,
    recommendationId: outcomeFilters.recommendationId,
    playbookExecutionId: outcomeFilters.playbookExecutionId,
    from: outcomeFilters.from,
    to: outcomeFilters.to,
  });

  const occPlaybookSuggestions = useMemo(() => {
    const catalogItems = Array.isArray(playbooksCatalog.items) ? playbooksCatalog.items : [];
    const recommendations = Array.isArray(operationalRecommendations.items) ? operationalRecommendations.items : [];
    const signals = Array.isArray(operationalSignals.items) ? operationalSignals.items : [];
    const playbookBySignal = new Map(
      catalogItems
        .filter((item) => item && item.triggerSignal)
        .map((item) => [String(item.triggerSignal), item]),
    );
    const signalById = new Map(signals.map((signal) => [String(signal.id), signal]));

    const dedup = new Map();

    for (const recommendation of recommendations) {
      const signalType = String(
        recommendation?.source_signal_type
        || recommendation?.sourceSignalType
        || recommendation?.context_json?.signalContext?.type
        || ''
      ).trim();
      const playbook = playbookBySignal.get(signalType);
      if (!playbook) continue;
      const signal = signalById.get(String(recommendation?.source_signal_id || recommendation?.sourceSignalId || '')) || null;
      const key = `${playbook.id}:${signal?.id || recommendation?.id || signalType}`;
      if (dedup.has(key)) continue;
      dedup.set(key, {
        id: key,
        playbook,
        signal,
        recommendation,
      });
    }

    for (const signal of signals) {
      const playbook = playbookBySignal.get(String(signal?.type || ''));
      if (!playbook) continue;
      const key = `${playbook.id}:${signal?.id || signal?.type}`;
      if (dedup.has(key)) continue;
      dedup.set(key, {
        id: key,
        playbook,
        signal,
        recommendation: null,
      });
    }

    return Array.from(dedup.values());
  }, [operationalRecommendations.items, operationalSignals.items, playbooksCatalog.items]);

  async function handleExecutePlaybookSuggestion(suggestion) {
    const playbook = suggestion?.playbook;
    if (!playbook?.id || !selectedTenant) return;

    const contactId = String(
      suggestion?.signal?.contact_id
      || suggestion?.signal?.contactId
      || suggestion?.recommendation?.contact_id
      || suggestion?.recommendation?.contactId
      || ''
    ).trim();

    const out = await playbookExecution.startExecution({
      playbookId: playbook.id,
      tenantId: selectedTenant,
      contactId,
      signalId: suggestion?.signal?.id || null,
      recommendationId: suggestion?.recommendation?.id || null,
      accountId: suggestion?.recommendation?.context_json?.accountId || null,
      phoneNumber: suggestion?.recommendation?.context_json?.phoneNumber || null,
      metadata: {
        source: 'occ',
      },
    });

    if (out?.ok) {
      setActivePlaybook(playbook);
      setPlaybookModalOpen(true);
    }
  }

  async function handleOccExecuteStep(step) {
    if (!activePlaybook?.id || !playbookExecution.execution?.id || !selectedTenant) return;
    await playbookExecution.runStep({
      playbookId: activePlaybook.id,
      tenantId: selectedTenant,
      executionId: playbookExecution.execution.id,
      stepId: step.id,
      context: {},
    });
  }

  async function handleOccExecuteNext() {
    if (!activePlaybook?.id || !playbookExecution.execution?.id || !selectedTenant) return;
    await playbookExecution.runNextStep({
      playbookId: activePlaybook.id,
      tenantId: selectedTenant,
      executionId: playbookExecution.execution.id,
      context: {},
    });
  }

  const tenantRows = useMemo(() => (summary?.items || []).map((item) => ({
    ...item,
    fallbackRate: item.snapshot?.ura?.totalMessages
      ? Number((((item.snapshot?.ura?.fallbackCount || 0) / Math.max(1, item.snapshot.ura.totalMessages)) * 100).toFixed(1))
      : 0,
  })), [summary]);

  const tenantColumns = [
    {
      id: 'tenant',
      header: 'Tenant',
      render: (row) => (
        <div>
          <div className="font-medium text-text-primary">{row.tenantName || row.tenantId}</div>
          <div className="text-xs text-text-tertiary">{row.tenantId}</div>
        </div>
      ),
    },
    {
      id: 'ura',
      header: 'URA',
      render: (row) => (
        <div>
          <div className={`text-sm font-medium ${riskTone(row.snapshot?.health?.uraStatus)}`}>
            fallback {row.fallbackRate || 0}%
          </div>
          <div className="text-xs text-text-secondary">conf. {row.snapshot?.ura?.averageConfidence || 0}</div>
        </div>
      ),
    },
    {
      id: 'scheduling',
      header: 'Scheduling',
      render: (row) => (
        <div>
          <div className={`text-sm font-medium ${riskTone(row.snapshot?.health?.schedulingStatus)}`}>
            conflitos {row.snapshot?.scheduling?.conflictsDetected || 0}
          </div>
          <div className="text-xs text-text-secondary">ocup. {row.snapshot?.fitness?.occupancyRate || 0}%</div>
        </div>
      ),
    },
    {
      id: 'beauty',
      header: 'Beauty',
      render: (row) => `${row.snapshot?.beauty?.bookingsToday || 0} bookings • ${row.snapshot?.beauty?.freeWindowsDetected || 0} janelas`,
    },
    {
      id: 'fitness',
      header: 'Fitness',
      render: (row) => `${row.snapshot?.fitness?.classesToday || 0} aulas • idle ${row.snapshot?.fitness?.resourceIdleRate || 0}%`,
    },
    {
      id: 'ai',
      header: 'IA',
      render: (row) => (
        <div>
          <div className={`text-sm font-medium ${riskTone(row.snapshot?.health?.aiStatus)}`}>
            {row.snapshot?.ai?.averageLatency || 0} ms
          </div>
          <div className="text-xs text-text-secondary">falhas {row.snapshot?.ai?.providerFailures || 0}</div>
        </div>
      ),
    },
    {
      id: 'risk',
      header: 'Risco',
      render: (row) => (
        <span className={`inline-flex items-center px-2 py-1 rounded-full border text-xs ${riskBadge(row.snapshot?.health?.schedulingStatus || row.snapshot?.health?.uraStatus)}`}>
          {row.snapshot?.health?.schedulingStatus || row.snapshot?.health?.uraStatus || 'green'}
        </span>
      ),
    },
  ];

  const alertColumns = [
    { id: 'alertType', header: 'Tipo', accessor: (row) => row.alertType },
    {
      id: 'severity',
      header: 'Severidade',
      render: (row) => <span className={`inline-flex items-center px-2 py-1 rounded-full border text-xs ${riskBadge(row.severity)}`}>{row.severity}</span>,
    },
    { id: 'entityType', header: 'Entidade', accessor: (row) => row.entityType || '—' },
    { id: 'description', header: 'Descrição', accessor: (row) => row.description || '—' },
  ];

  const auditColumns = [
    { id: 'intent', header: 'Intent', accessor: (row) => row.intent || 'fallback' },
    { id: 'secondaryIntent', header: 'Intent secundária', accessor: (row) => row.secondaryIntent || '—' },
    { id: 'confidence', header: 'Confidence', accessor: (row) => row.confidence ?? 0 },
    { id: 'departmentId', header: 'Departamento', accessor: (row) => row.departmentId || '—' },
    { id: 'queueName', header: 'Fila', accessor: (row) => row.queueName || row.queueId || '—' },
    { id: 'providerStatus', header: 'Provider', accessor: (row) => row.providerStatus || '—' },
  ];

  const flagColumns = [
    { id: 'featureKey', header: 'Feature', accessor: (row) => row.featureKey },
    {
      id: 'enabled',
      header: 'Status',
      render: (row) => (
        <span className={`inline-flex items-center px-2 py-1 rounded-full border text-xs ${row.enabled ? riskBadge('green') : 'bg-bg-secondary text-text-secondary border-border-default'}`}>
          {row.enabled ? 'Habilitada' : 'Desabilitada'}
        </span>
      ),
    },
    {
      id: 'config',
      header: 'Config',
      render: (row) => (
        <span className="text-xs text-text-secondary">
          {row.config && Object.keys(row.config).length > 0 ? JSON.stringify(row.config) : '—'}
        </span>
      ),
    },
  ];

  async function handleToggleFlag(flag) {
    if (!selectedTenant || !flag?.featureKey) return;
    try {
      setSavingFlag(flag.featureKey);
      await superAdminApi.updateOccTenantFeatureFlag(selectedTenant, flag.featureKey, {
        enabled: !flag.enabled,
        config: flag.config || {},
      });
      await loadTenantDetail(selectedTenant);
      await loadSummary();
    } catch (err) {
      logger.error('Erro ao atualizar feature flag OCC', err);
    } finally {
      setSavingFlag('');
    }
  }

  return (
    <PlatformDashboardPage>
      <PlatformDashboardHeader
        title="Operational Control Center"
        description="Observabilidade, auditoria e governança operacional por tenant."
        actions={(
          <>
            <button type="button" className="btn-default px-4 py-2 text-sm" onClick={() => loadSummary()}>
              Atualizar resumo
            </button>
            {selectedTenant ? (
              <button
                type="button"
                className="btn-default px-4 py-2 text-sm"
                onClick={() => {
                  loadTenantDetail(selectedTenant);
                  reloadCrmSummary();
                  operationalSignals.reload();
                  operationalRecommendations.reload();
                  operationalOutcomes.reload();
                }}
              >
                Atualizar tenant
              </button>
            ) : null}
          </>
        )}
      />

      {loading ? (
        <PlatformDashboardSection title="Carregamento">
          <PlatformDashboardLoadingState label="Carregando OCC..." />
        </PlatformDashboardSection>
      ) : (
        <>
          <PlatformDashboardSection title="Resumo Global" icon="📡">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <PlatformKpiCard label="Tenants ativos" value={summary?.summary?.tenantsActive || 0} />
              <PlatformKpiCard label="Tenants com alertas" value={summary?.summary?.tenantsWithAlerts || 0} valueClassName="text-status-warning" />
              <PlatformKpiCard label="URA degradada" value={summary?.summary?.tenantsWithUraDegraded || 0} valueClassName="text-status-error" />
              <PlatformKpiCard label="Scheduling degradado" value={summary?.summary?.tenantsWithSchedulingDegraded || 0} valueClassName="text-status-error" />
            </div>
          </PlatformDashboardSection>

          <PlatformDashboardSection title="Tenants Monitorados" icon="🏢">
            {tenantRows.length === 0 ? (
              <PlatformDashboardEmptyState title="Sem tenants monitorados" description="Nenhum tenant ativo possui snapshot OCC disponível." />
            ) : (
              <PlatformGrid
                columns={tenantColumns}
                rows={tenantRows}
                getRowKey={(row) => row.tenantId}
                onRowClick={(row) => setSelectedTenant(row.tenantId)}
                rowClassName={(row) => selectedTenant === row.tenantId ? 'pg-tr--selected' : ''}
                emptyState={{ title: 'Sem tenants', description: 'Nenhum tenant encontrado.' }}
              />
            )}
          </PlatformDashboardSection>

          <PlatformDashboardSection title="Tenant Selecionado" icon="🧭">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-text-primary">Tenant</label>
              <select className="input-field max-w-sm" value={selectedTenant} onChange={(e) => setSelectedTenant(e.target.value)}>
                <option value="">Selecione</option>
                {tenantRows.map((item) => (
                  <option key={item.tenantId} value={item.tenantId}>
                    {item.tenantName || item.tenantId}
                  </option>
                ))}
              </select>
            </div>
          </PlatformDashboardSection>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <PlatformDashboardSection title="Snapshot Atual" icon="📈">
              {snapshot ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <PlatformKpiCard label="Fallback URA" value={`${snapshot.ura?.fallbackCount || 0} (${snapshot.ura?.averageConfidence || 0})`} hint="volume e confidence media" />
                  <PlatformKpiCard label="Schedules hoje" value={snapshot.scheduling?.schedulesToday || 0} hint={`conflitos ${snapshot.scheduling?.conflictsDetected || 0}`} />
                  <PlatformKpiCard label="Beauty" value={snapshot.beauty?.bookingsToday || 0} hint={`${snapshot.beauty?.freeWindowsDetected || 0} janelas livres`} />
                  <PlatformKpiCard label="Fitness" value={`${snapshot.fitness?.occupancyRate || 0}%`} hint={`idle ${snapshot.fitness?.resourceIdleRate || 0}%`} />
                  <PlatformKpiCard label="IA latência" value={`${snapshot.ai?.averageLatency || 0} ms`} hint={`falhas ${snapshot.ai?.providerFailures || 0}`} />
                  <PlatformKpiCard label="RAG usage" value={`${snapshot.ai?.ragUsedRate || 0}%`} hint={`requests ${snapshot.ai?.classificationRequests || 0}`} />
                  <CRMTimelineSummaryCard
                    title="CRM Operacional"
                    summary={crmOperationalSummary}
                    loading={crmSummaryLoading}
                    error={crmSummaryError}
                    enabled={supportCockpitFlag?.enabled === true}
                    subtitle={supportCockpitFlag?.enabled === true
                      ? 'support_cockpit_enabled ativo para o tenant.'
                      : 'support_cockpit_enabled inativo para o tenant (monitoramento OCC mantém leitura).'}
                  />
                </div>
              ) : (
                <PlatformDashboardEmptyState title="Sem snapshot" description="Selecione um tenant com snapshot OCC coletado." />
              )}
            </PlatformDashboardSection>

            <PlatformDashboardSection title="Feature Flags" icon="🎛️">
              <PlatformGrid
                columns={flagColumns}
                rows={tenantFlags}
                getRowKey={(row) => row.featureKey}
                rowActions={(row) => [{
                  label: savingFlag === row.featureKey ? 'Salvando...' : row.enabled ? 'Desabilitar' : 'Habilitar',
                  onClick: () => handleToggleFlag(row),
                  disabled: savingFlag === row.featureKey,
                }]}
                emptyState={{ title: 'Sem flags', description: 'Nenhuma flag disponível para o tenant selecionado.' }}
              />
            </PlatformDashboardSection>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <OperationalSignalsCard
              title="Sinais Operacionais"
              subtitle="Sinais ativos detectados no tenant selecionado."
              tenantId={selectedTenant}
              quickActionsScope="admin"
              enabled={Boolean(selectedTenant)}
              signals={operationalSignals.items}
              loading={operationalSignals.loading}
              error={operationalSignals.error}
              onRefresh={operationalSignals.reload}
              onGenerate={operationalSignals.generate}
              onStatusChange={operationalSignals.updateStatus}
            />

            <OperationalRecommendationsCard
              title="Recomendações Operacionais"
              subtitle="Ações sugeridas com base nos sinais operacionais do tenant."
              tenantId={selectedTenant}
              quickActionsScope="admin"
              enabled={Boolean(selectedTenant)}
              recommendations={operationalRecommendations.items}
              loading={operationalRecommendations.loading}
              error={operationalRecommendations.error}
              onRefresh={operationalRecommendations.reload}
              onGenerate={operationalRecommendations.generate}
              onStatusChange={operationalRecommendations.updateStatus}
            />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <PlaybookSuggestionCard
              title="Playbooks Operacionais"
              subtitle="Fluxos guiados sugeridos a partir dos sinais e recomendações do tenant."
              enabled={Boolean(selectedTenant)}
              suggestions={occPlaybookSuggestions}
              loading={playbooksCatalog.loading || playbookExecution.loading}
              error={playbooksCatalog.error || playbookExecution.error}
              onExecute={handleExecutePlaybookSuggestion}
              emptyMessage="Nenhum playbook sugerido para os sinais/recomendações atuais."
            />
          </div>

          <PlatformDashboardSection title="Outcomes recentes" icon="✅">
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <select
                className="input-field"
                value={outcomeFilters.status}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, status: e.target.value }))}
              >
                <option value="">Todos os status</option>
                <option value="success">Sucesso</option>
                <option value="failed">Falha</option>
              </select>
              <select
                className="input-field"
                value={outcomeFilters.sourceType}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, sourceType: e.target.value }))}
              >
                <option value="">Todas as origens</option>
                <option value="signal">Signal</option>
                <option value="recommendation">Recommendation</option>
                <option value="playbook">Playbook</option>
              </select>
              <input
                className="input-field"
                placeholder="Filtrar por tipo de outcome"
                value={outcomeFilters.outcomeType}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, outcomeType: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="Filtrar por signal"
                value={outcomeFilters.signalId}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, signalId: e.target.value }))}
              />
              <input
                className="input-field"
                placeholder="Filtrar por recommendation"
                value={outcomeFilters.recommendationId}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, recommendationId: e.target.value }))}
              />
            </div>
            <div className="mb-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
              <input
                className="input-field"
                placeholder="Filtrar por playbook"
                value={outcomeFilters.playbookExecutionId}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, playbookExecutionId: e.target.value }))}
              />
              <input
                className="input-field"
                type="date"
                value={outcomeFilters.from}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, from: e.target.value }))}
              />
              <input
                className="input-field"
                type="date"
                value={outcomeFilters.to}
                onChange={(e) => setOutcomeFilters((current) => ({ ...current, to: e.target.value }))}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setOutcomeFilters({
                  status: '',
                  sourceType: '',
                  outcomeType: '',
                  signalId: '',
                  recommendationId: '',
                  playbookExecutionId: '',
                  from: '',
                  to: '',
                })}
              >
                Limpar filtros
              </button>
            </div>
            <OutcomeList
              items={operationalOutcomes.items}
              loading={operationalOutcomes.loading}
              error={operationalOutcomes.error}
              subtitle="Resultados recentes de quick actions e playbooks executados no tenant."
            />
          </PlatformDashboardSection>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <PlatformDashboardSection title="Alertas Operacionais" icon="🚨">
              <PlatformGrid
                columns={alertColumns}
                rows={tenantAlerts}
                getRowKey={(row) => row.id}
                emptyState={{ title: 'Nenhum alerta ativo', description: 'Nao ha alertas operacionais abertos para este tenant.' }}
              />
            </PlatformDashboardSection>

            <PlatformDashboardSection title="Auditoria URA" icon="🧠">
              <PlatformGrid
                columns={auditColumns}
                rows={tenantAudit}
                getRowKey={(row) => row.id}
                emptyState={{ title: 'Sem auditoria recente', description: 'Nenhuma decisão URA recente foi registrada.' }}
              />
            </PlatformDashboardSection>
          </div>
        </>
      )}

      <PlaybookExecutionModal
        open={playbookModalOpen}
        playbook={activePlaybook}
        execution={playbookExecution.execution}
        loading={playbookExecution.loading}
        error={playbookExecution.error}
        onClose={() => {
          setPlaybookModalOpen(false);
          playbookExecution.reset();
        }}
        onExecuteStep={handleOccExecuteStep}
        onExecuteNext={handleOccExecuteNext}
      />
    </PlatformDashboardPage>
  );
}
