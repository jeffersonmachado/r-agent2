import React, { useEffect, useState } from 'react';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/authContext';
import { hasPermission } from '../utils/menuPermissions';
import {
  acceptAutonomousCampaignCandidate,
  createAutonomousWaitingListEntry,
  createKioskSession,
  deactivateAutonomousWaitingListEntry,
  detectRevenueOpportunities,
  getAutonomousAggregatedMetrics,
  getAutonomousPredictiveInsights,
  getAutonomousSchedulingRuntime,
  getAutonomousSchedulingMetrics,
  getAutonomousSchedulingPolicy,
  generateOperationalMetricSnapshot,
  kioskAvailabilityLookup,
  kioskCheckin,
  listAutonomousRecommendations,
  listAutonomousCampaignCandidates,
  listAutonomousCampaigns,
  listKioskSessions,
  listOperationalMetricSnapshots,
  listAutonomousTemplates,
  listAutonomousWaitingList,
  listRevenueOpportunities,
  previewAutonomousCoreRun,
  rejectAutonomousCampaignCandidate,
  runAutonomousGapDetection,
  updateAutonomousSchedulingPolicy,
  updateAutonomousSchedulingRuntime,
  updateAutonomousWaitingListEntry,
} from '../api/autonomousScheduling';

const DEFAULT_POLICY = {
  channel: 'whatsapp',
  enabled: true,
  autoFillEnabled: true,
  waitingListEnabled: true,
  reactivationEnabled: true,
  minNoticeMinutes: 30,
  minGapDurationMinutes: 30,
  fillHorizonHours: 48,
  maxInvitesPerCampaign: 8,
  maxInvitesPerContactDay: 2,
  maxInvitesPerContactWeek: 5,
  cooldownHoursAfterReject: 48,
  cooldownHoursAfterNoResponse: 24,
  sendWindowStart: '08:00',
  sendWindowEnd: '19:00',
  allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
  settings: {
    verticalTemplate: 'beauty',
    serviceType: '',
    allowedChannels: ['whatsapp'],
    preferredOwnerId: '',
    preferredTimeWindows: [],
    recurrenceDays: [],
  },
};

const EMPTY_WAITING_FORM = {
  contactId: '',
  serviceType: '',
  desiredChannel: 'whatsapp',
  priority: 50,
  notes: '',
};

const DEFAULT_RUNTIME = {
  autoDetectEnabled: false,
  autoCampaignEnabled: false,
  autoExpireEnabled: true,
  predictiveEnabled: true,
  revenueEnabled: true,
  kioskEnabled: false,
  snapshotGenerationEnabled: false,
  recommendationsEnabled: true,
  simulationMode: true,
  runIntervalMinutes: 10,
  maxCampaignsPerRun: 10,
  maxInvitesPerRun: 50,
  maxRecommendationsPerRun: 10,
  maxSnapshotsPerDay: 8,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  enabledChannelsJson: ['whatsapp'],
  safetyMode: 'manual',
  runtimeNotes: '',
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function asCommaList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item : `${item?.start || ''}-${item?.end || ''}`)).join(', ');
  }
  return String(value || '');
}

function normalizeCommaList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTimeWindows(value) {
  return normalizeCommaList(value).map((item) => {
    const [start, end] = item.split('-').map((entry) => String(entry || '').trim());
    return { start, end };
  }).filter((item) => item.start && item.end);
}

function MetricCard({ label, value }) {
  return (
    <div style={{ border: '1px solid var(--color-border-default)', borderRadius: '10px', padding: '12px' }}>
      <div className="text-xs text-text-tertiary">{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export function AutonomousSchedulingPage() {
  const { showToast } = useToast();
  const { agent } = useAuth();
  const canRead = hasPermission(agent, 'autonomous_scheduling', 'read');
  const canUpdate = hasPermission(agent, 'autonomous_scheduling', 'update');
  const canRun = hasPermission(agent, 'autonomous_scheduling', 'run');
  const canAccept = hasPermission(agent, 'autonomous_scheduling', 'accept');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [campaigns, setCampaigns] = useState([]);
  const [metrics, setMetrics] = useState({});
  const [aggregatedMetrics, setAggregatedMetrics] = useState([]);
  const [runtime, setRuntime] = useState(DEFAULT_RUNTIME);
  const [insights, setInsights] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [revenueOpportunities, setRevenueOpportunities] = useState([]);
  const [recommendations, setRecommendations] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [previewRun, setPreviewRun] = useState(null);
  const [kioskSessions, setKioskSessions] = useState([]);
  const [campaignCandidates, setCampaignCandidates] = useState({});
  const [waitingList, setWaitingList] = useState([]);
  const [waitingForm, setWaitingForm] = useState(EMPTY_WAITING_FORM);
  const [editingWaitingId, setEditingWaitingId] = useState(null);
  const [kioskForm, setKioskForm] = useState({
    kioskCode: 'default',
    contactId: '',
    reason: 'checkin',
    startAt: '',
    endAt: '',
    ownerId: '',
  });

  async function loadData() {
    if (!canRead) return;
    setLoading(true);
    try {
      const [policyRes, campaignsRes, waitingListRes, metricsRes, runtimeRes, aggregatedRes, insightsRes, revenueRes, templatesRes] = await Promise.all([
        getAutonomousSchedulingPolicy(),
        listAutonomousCampaigns({ limit: 20 }),
        listAutonomousWaitingList({ activeOnly: true }),
        getAutonomousSchedulingMetrics(),
        getAutonomousSchedulingRuntime(),
        getAutonomousAggregatedMetrics(),
        getAutonomousPredictiveInsights(),
        listRevenueOpportunities(),
        listAutonomousTemplates(),
      ]);
      const [recommendationsRes, snapshotsRes, kioskSessionsRes] = await Promise.all([
        listAutonomousRecommendations(),
        listOperationalMetricSnapshots({ limit: 8 }),
        listKioskSessions({ limit: 8 }),
      ]);
      const campaignItems = Array.isArray(campaignsRes?.items) ? campaignsRes.items : [];
      setPolicy({ ...DEFAULT_POLICY, ...(policyRes?.policy || {}) });
      setCampaigns(campaignItems);
      setWaitingList(Array.isArray(waitingListRes?.items) ? waitingListRes.items : []);
      setMetrics(metricsRes?.metrics || {});
      setRuntime({ ...DEFAULT_RUNTIME, ...(runtimeRes?.runtime || {}) });
      setAggregatedMetrics(Array.isArray(aggregatedRes?.items) ? aggregatedRes.items : []);
      setInsights(insightsRes?.insights || null);
      setRevenueOpportunities(Array.isArray(revenueRes?.items) ? revenueRes.items : []);
      setTemplates(Array.isArray(templatesRes?.items) ? templatesRes.items : []);
      setRecommendations(Array.isArray(recommendationsRes?.items) ? recommendationsRes.items : []);
      setSnapshots(Array.isArray(snapshotsRes?.items) ? snapshotsRes.items : []);
      setKioskSessions(Array.isArray(kioskSessionsRes?.items) ? kioskSessionsRes.items : []);
      const candidateEntries = await Promise.all(campaignItems.slice(0, 8).map(async (campaign) => [campaign.id, await listAutonomousCampaignCandidates(campaign.id)]));
      setCampaignCandidates(Object.fromEntries(candidateEntries.map(([id, out]) => [id, Array.isArray(out?.items) ? out.items : []])));
    } catch (err) {
      showToast(`Falha ao carregar Agenda Autônoma: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [canRead]);

  async function handleSave() {
    if (!canUpdate) {
      showToast('Sem permissão para editar a policy.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...policy,
        minNoticeMinutes: Number(policy.minNoticeMinutes) || DEFAULT_POLICY.minNoticeMinutes,
        minGapDurationMinutes: Number(policy.minGapDurationMinutes) || DEFAULT_POLICY.minGapDurationMinutes,
        fillHorizonHours: Number(policy.fillHorizonHours) || DEFAULT_POLICY.fillHorizonHours,
        maxInvitesPerCampaign: Number(policy.maxInvitesPerCampaign) || DEFAULT_POLICY.maxInvitesPerCampaign,
        maxInvitesPerContactDay: Number(policy.maxInvitesPerContactDay) || DEFAULT_POLICY.maxInvitesPerContactDay,
        maxInvitesPerContactWeek: Number(policy.maxInvitesPerContactWeek) || DEFAULT_POLICY.maxInvitesPerContactWeek,
        cooldownHoursAfterReject: Number(policy.cooldownHoursAfterReject) || DEFAULT_POLICY.cooldownHoursAfterReject,
        cooldownHoursAfterNoResponse: Number(policy.cooldownHoursAfterNoResponse) || DEFAULT_POLICY.cooldownHoursAfterNoResponse,
        allowedWeekdays: normalizeCommaList(policy.allowedWeekdays).map((item) => Number(item)).filter((item) => Number.isInteger(item)),
        settings: {
          ...(policy.settings || {}),
          allowedChannels: normalizeCommaList(policy.settings?.allowedChannels),
          preferredTimeWindows: parseTimeWindows(policy.settings?.preferredTimeWindows),
          recurrenceDays: normalizeCommaList(policy.settings?.recurrenceDays).map((item) => Number(item)).filter((item) => Number.isInteger(item)),
        },
      };
      const out = await updateAutonomousSchedulingPolicy(payload);
      setPolicy({ ...DEFAULT_POLICY, ...(out?.policy || payload) });
      showToast('Policy atualizada.', 'success');
    } catch (err) {
      showToast(`Falha ao salvar policy: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleRunDetection() {
    if (!canRun) {
      showToast('Sem permissão para rodar a Agenda Autônoma.', 'warning');
      return;
    }
    setRunning(true);
    try {
      const out = await runAutonomousGapDetection({});
      showToast(`Detecção concluída: ${out?.created || 0} campanha(s) criada(s).`, 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao rodar Agenda Autônoma: ${err.message}`, 'error');
    } finally {
      setRunning(false);
    }
  }

  async function handleWaitingSubmit() {
    if (!canUpdate) {
      showToast('Sem permissão para atualizar waiting list.', 'warning');
      return;
    }
    try {
      const payload = {
        ...waitingForm,
        priority: Number(waitingForm.priority) || 50,
      };
      if (editingWaitingId) {
        await updateAutonomousWaitingListEntry(editingWaitingId, payload);
      } else {
        await createAutonomousWaitingListEntry(payload);
      }
      setWaitingForm(EMPTY_WAITING_FORM);
      setEditingWaitingId(null);
      showToast('Waiting list atualizada.', 'success');
      await loadData();
    } catch (err) {
      showToast(err.message || 'Erro ao salvar waiting list', 'error');
    }
  }

  async function handleDeactivateWaiting(item) {
    if (!canUpdate) {
      showToast('Sem permissão para desativar waiting list.', 'warning');
      return;
    }
    try {
      await deactivateAutonomousWaitingListEntry(item.id);
      showToast('Entrada desativada.', 'success');
      await loadData();
    } catch (err) {
      showToast(err.message || 'Erro ao desativar entrada', 'error');
    }
  }

  async function handleCandidateAction(campaignId, candidateId, action) {
    if (!canAccept) {
      showToast('Sem permissão para operar candidatos.', 'warning');
      return;
    }
    try {
      if (action === 'accept') {
        await acceptAutonomousCampaignCandidate(campaignId, candidateId);
      } else {
        await rejectAutonomousCampaignCandidate(campaignId, candidateId);
      }
      showToast(action === 'accept' ? 'Candidato aceito.' : 'Candidato rejeitado.', 'success');
      await loadData();
    } catch (err) {
      showToast(err.message || 'Erro ao atualizar candidato', 'error');
    }
  }

  async function handleSaveRuntime() {
    if (!canUpdate) {
      showToast('Sem permissão para editar o runtime.', 'warning');
      return;
    }
    try {
      const out = await updateAutonomousSchedulingRuntime({
        ...runtime,
        runIntervalMinutes: Number(runtime.runIntervalMinutes) || DEFAULT_RUNTIME.runIntervalMinutes,
        maxCampaignsPerRun: Number(runtime.maxCampaignsPerRun) || DEFAULT_RUNTIME.maxCampaignsPerRun,
        maxInvitesPerRun: Number(runtime.maxInvitesPerRun) || DEFAULT_RUNTIME.maxInvitesPerRun,
        maxRecommendationsPerRun: Number(runtime.maxRecommendationsPerRun) || DEFAULT_RUNTIME.maxRecommendationsPerRun,
        maxSnapshotsPerDay: Number(runtime.maxSnapshotsPerDay) || DEFAULT_RUNTIME.maxSnapshotsPerDay,
        enabledChannelsJson: normalizeCommaList(runtime.enabledChannelsJson),
      });
      setRuntime({ ...DEFAULT_RUNTIME, ...(out?.runtime || runtime) });
      showToast('Runtime operacional atualizado.', 'success');
    } catch (err) {
      showToast(err.message || 'Erro ao salvar runtime', 'error');
    }
  }

  async function handleDetectRevenue() {
    if (!canRun) {
      showToast('Sem permissão para detectar oportunidades.', 'warning');
      return;
    }
    try {
      await detectRevenueOpportunities();
      showToast('Oportunidades de receita atualizadas.', 'success');
      await loadData();
    } catch (err) {
      showToast(err.message || 'Erro ao detectar oportunidades', 'error');
    }
  }

  async function handleGenerateSnapshot() {
    if (!canRun) {
      showToast('Sem permissão para gerar snapshot.', 'warning');
      return;
    }
    try {
      const out = await generateOperationalMetricSnapshot({});
      showToast(`Snapshot processado: ${out?.created || 0} item(ns).`, 'success');
      await loadData();
    } catch (err) {
      showToast(err.message || 'Erro ao gerar snapshot', 'error');
    }
  }

  async function handlePreviewRun() {
    if (!canRun) {
      showToast('Sem permissão para gerar preview run.', 'warning');
      return;
    }
    try {
      const out = await previewAutonomousCoreRun({
        serviceType: policy.settings?.serviceType || null,
      });
      setPreviewRun(out?.preview || null);
      showToast('Preview gerado sem efeitos colaterais.', 'success');
    } catch (err) {
      showToast(err.message || 'Erro ao gerar preview run', 'error');
    }
  }

  async function handleKioskAction(kind) {
    try {
      if (kind === 'session') {
        await createKioskSession({
          kioskCode: kioskForm.kioskCode,
          contactId: kioskForm.contactId || null,
        });
        showToast('Sessão de kiosk criada.', 'success');
      } else if (kind === 'checkin') {
        await kioskCheckin({
          kioskCode: kioskForm.kioskCode,
          contactId: kioskForm.contactId || null,
          reason: kioskForm.reason || 'checkin',
        });
        showToast('Check-in do kiosk realizado.', 'success');
      } else {
        const out = await kioskAvailabilityLookup({
          ownerId: kioskForm.ownerId || null,
          startAt: kioskForm.startAt,
          endAt: kioskForm.endAt,
          timezone: 'UTC',
        });
        showToast(`Disponibilidade consultada: ${(out?.slots || []).length} slot(s).`, 'success');
      }
    } catch (err) {
      showToast(err.message || 'Erro na operação de kiosk', 'error');
    }
  }

  if (!canRead) {
    return (
      <div className="support-page">
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          Você não possui permissão para acessar a Agenda Autônoma.
        </div>
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div>
          <h1>Agenda Autônoma</h1>
          <p className="text-sm text-text-secondary">Hardening operacional do preenchimento de gaps com CRM, agenda e WhatsApp do core.</p>
        </div>
        <div className="support-controls" style={{ gap: '8px' }}>
          <Button onClick={handleRunDetection} disabled={loading || running || !canRun} style={{ width: 'auto' }}>
            {running ? 'Rodando...' : 'Rodar detecção'}
          </Button>
          <Button onClick={handleGenerateSnapshot} disabled={loading || !canRun} style={{ width: 'auto' }}>
            Gerar snapshot
          </Button>
          <Button onClick={handlePreviewRun} disabled={loading || !canRun} style={{ width: 'auto' }}>
            Preview run
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || !canUpdate} style={{ width: 'auto' }}>
            {saving ? 'Salvando...' : 'Salvar policy'}
          </Button>
        </div>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '12px', marginBottom: '16px' }}>
        <MetricCard label="Campanhas abertas" value={metrics?.campaignsOpen || 0} />
        <MetricCard label="Preenchidas" value={metrics?.campaignsFilled || 0} />
        <MetricCard label="Aceites" value={metrics?.accepts || 0} />
        <MetricCard label="Expiradas" value={metrics?.campaignsExpired || 0} />
        <MetricCard label="Fill rate" value={`${metrics?.fillRate || 0}%`} />
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px', marginBottom: '16px' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
            <div style={{ fontWeight: 700 }}>Recommendations</div>
            <span className="text-xs text-text-tertiary">{recommendations.length} item(ns)</span>
          </div>
          {recommendations.length === 0 ? (
            <div className="text-sm text-text-secondary">Nenhuma recomendação ativa.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recommendations.slice(0, 4).map((item) => (
                <div key={`${item.type}-${item.relatedEntityId || item.title}`} style={{ borderTop: '1px solid var(--color-border-default)', paddingTop: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                    <strong>{item.title}</strong>
                    <span className="text-xs text-text-tertiary">{item.severity} • {Math.round(Number(item.confidence || 0) * 100)}%</span>
                  </div>
                  <div className="text-sm text-text-secondary">{item.message}</div>
                  <div className="text-xs text-text-tertiary">{item.recommendedAction}</div>
                  <div className="text-xs text-text-tertiary">{(item.reasonCodes || []).join(' • ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
            <div style={{ fontWeight: 700 }}>Snapshots</div>
            <span className="text-xs text-text-tertiary">{snapshots.length} recente(s)</span>
          </div>
          {snapshots.length === 0 ? (
            <div className="text-sm text-text-secondary">Nenhum snapshot persistido ainda.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {snapshots.slice(0, 4).map((item) => (
                <div key={item.id} style={{ borderTop: '1px solid var(--color-border-default)', paddingTop: '8px' }}>
                  <strong>{item.vertical_template || item.verticalTemplate} / {item.service_type || item.serviceType || 'all'}</strong>
                  <div className="text-sm text-text-secondary">{item.snapshot_date || item.snapshotDate} • fill {item.fill_rate || item.fillRate}% • accept {item.accept_rate || item.acceptRate}%</div>
                  <div className="text-xs text-text-tertiary">idle {item.idle_risk_score || item.idleRiskScore || '-'} • no-show {item.no_show_risk_score || item.noShowRiskScore || '-'}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ fontWeight: 700, marginBottom: '12px' }}>Preview run</div>
          {!previewRun ? (
            <div className="text-sm text-text-secondary">Use “Preview run” para simular o que o core faria sem disparar ações reais.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div className="text-sm text-text-secondary">Gaps elegíveis: <strong>{(previewRun.eligibleGaps || []).length}</strong></div>
              <div className="text-sm text-text-secondary">Campanhas elegíveis: <strong>{(previewRun.eligibleCampaigns || []).length}</strong></div>
              <div className="text-sm text-text-secondary">Recommendations: <strong>{(previewRun.recommendations || []).length}</strong></div>
              <div className="text-sm text-text-secondary">Revenue opportunities: <strong>{(previewRun.revenueOpportunities || []).length}</strong></div>
              <div className="text-xs text-text-tertiary">{(previewRun.reasons || []).map((item) => item.message).join(' • ')}</div>
            </div>
          )}
        </div>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: '16px' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ fontWeight: 700, marginBottom: '12px' }}>Policy</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
            <label className="support-form-group">
              <span className="support-form-label">Preset vertical</span>
              <select className="support-form-select" value={policy.settings?.verticalTemplate || 'beauty'} onChange={(e) => setPolicy((prev) => ({ ...prev, settings: { ...(prev.settings || {}), verticalTemplate: e.target.value } }))}>
                {(templates.length > 0 ? templates.map((item) => item.key) : ['beauty', 'fitness', 'food', 'services']).map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
              </select>
            </label>
            <label className="support-form-group">
              <span className="support-form-label">Service type</span>
              <input className="support-form-input" value={policy.settings?.serviceType || ''} onChange={(e) => setPolicy((prev) => ({ ...prev, settings: { ...(prev.settings || {}), serviceType: e.target.value } }))} />
            </label>
            <label className="support-form-group">
              <span className="support-form-label">Notice mínimo</span>
              <input className="support-form-input" type="number" value={policy.minNoticeMinutes} onChange={(e) => setPolicy((prev) => ({ ...prev, minNoticeMinutes: e.target.value }))} />
            </label>
            <label className="support-form-group">
              <span className="support-form-label">Gap mínimo</span>
              <input className="support-form-input" type="number" value={policy.minGapDurationMinutes} onChange={(e) => setPolicy((prev) => ({ ...prev, minGapDurationMinutes: e.target.value }))} />
            </label>
            <label className="support-form-group">
              <span className="support-form-label">Allowed channels</span>
              <input className="support-form-input" value={asCommaList(policy.settings?.allowedChannels)} onChange={(e) => setPolicy((prev) => ({ ...prev, settings: { ...(prev.settings || {}), allowedChannels: e.target.value } }))} />
            </label>
            <label className="support-form-group">
              <span className="support-form-label">Owner preferido</span>
              <input className="support-form-input" value={policy.settings?.preferredOwnerId || ''} onChange={(e) => setPolicy((prev) => ({ ...prev, settings: { ...(prev.settings || {}), preferredOwnerId: e.target.value } }))} />
            </label>
            <label className="support-form-group">
              <span className="support-form-label">Janelas preferidas</span>
              <input className="support-form-input" value={asCommaList(policy.settings?.preferredTimeWindows)} onChange={(e) => setPolicy((prev) => ({ ...prev, settings: { ...(prev.settings || {}), preferredTimeWindows: e.target.value } }))} />
            </label>
            <label className="support-form-group">
              <span className="support-form-label">Dias permitidos</span>
              <input className="support-form-input" value={Array.isArray(policy.allowedWeekdays) ? policy.allowedWeekdays.join(', ') : String(policy.allowedWeekdays || '')} onChange={(e) => setPolicy((prev) => ({ ...prev, allowedWeekdays: e.target.value }))} />
            </label>
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ fontWeight: 700, marginBottom: '12px' }}>Waiting list</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            <input className="support-form-input" placeholder="Contact ID" value={waitingForm.contactId} onChange={(e) => setWaitingForm((prev) => ({ ...prev, contactId: e.target.value }))} />
            <input className="support-form-input" placeholder="Service type" value={waitingForm.serviceType} onChange={(e) => setWaitingForm((prev) => ({ ...prev, serviceType: e.target.value }))} />
            <input className="support-form-input" placeholder="Canal" value={waitingForm.desiredChannel} onChange={(e) => setWaitingForm((prev) => ({ ...prev, desiredChannel: e.target.value }))} />
            <input className="support-form-input" type="number" placeholder="Prioridade" value={waitingForm.priority} onChange={(e) => setWaitingForm((prev) => ({ ...prev, priority: e.target.value }))} />
            <input className="support-form-input" style={{ gridColumn: '1 / -1' }} placeholder="Notas" value={waitingForm.notes} onChange={(e) => setWaitingForm((prev) => ({ ...prev, notes: e.target.value }))} />
          </div>
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
            <Button onClick={handleWaitingSubmit} disabled={!canUpdate} style={{ width: 'auto' }}>
              {editingWaitingId ? 'Salvar edição' : 'Adicionar'}
            </Button>
            {editingWaitingId ? (
              <Button onClick={() => { setEditingWaitingId(null); setWaitingForm(EMPTY_WAITING_FORM); }} style={{ width: 'auto' }}>
                Cancelar
              </Button>
            ) : null}
          </div>
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {loading ? <div className="text-sm text-text-secondary">Carregando...</div> : waitingList.map((item) => (
              <div key={item.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '8px', padding: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <strong>{item.contact?.name || item.contactId}</strong>
                  <span className="text-xs text-text-tertiary">prioridade {item.priority}</span>
                </div>
                <div className="text-sm text-text-secondary">{item.contact?.phone || '-'} • {item.serviceType || 'sem serviceType'}</div>
                <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                  <Button onClick={() => { setEditingWaitingId(item.id); setWaitingForm({ contactId: item.contactId, serviceType: item.serviceType || '', desiredChannel: item.desiredChannel || 'whatsapp', priority: item.priority || 50, notes: item.notes || '' }); }} style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }} disabled={!canUpdate}>Editar</Button>
                  <Button onClick={() => handleDeactivateWaiting(item)} style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }} disabled={!canUpdate}>Desativar</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px', marginTop: '16px' }}>
        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ fontWeight: 700, marginBottom: '12px' }}>Runtime operacional</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px' }}>
            <input className="support-form-input" type="number" value={runtime.runIntervalMinutes} onChange={(e) => setRuntime((prev) => ({ ...prev, runIntervalMinutes: e.target.value }))} placeholder="Intervalo" />
            <input className="support-form-input" type="number" value={runtime.maxCampaignsPerRun} onChange={(e) => setRuntime((prev) => ({ ...prev, maxCampaignsPerRun: e.target.value }))} placeholder="Campanhas/run" />
            <input className="support-form-input" type="number" value={runtime.maxInvitesPerRun} onChange={(e) => setRuntime((prev) => ({ ...prev, maxInvitesPerRun: e.target.value }))} placeholder="Convites/run" />
            <input className="support-form-input" value={asCommaList(runtime.enabledChannelsJson)} onChange={(e) => setRuntime((prev) => ({ ...prev, enabledChannelsJson: e.target.value }))} placeholder="Canais" />
            <input className="support-form-input" type="number" value={runtime.maxRecommendationsPerRun} onChange={(e) => setRuntime((prev) => ({ ...prev, maxRecommendationsPerRun: e.target.value }))} placeholder="Recommendations/run" />
            <input className="support-form-input" type="number" value={runtime.maxSnapshotsPerDay} onChange={(e) => setRuntime((prev) => ({ ...prev, maxSnapshotsPerDay: e.target.value }))} placeholder="Snapshots/dia" />
            <input className="support-form-input" value={runtime.quietHoursStart || ''} onChange={(e) => setRuntime((prev) => ({ ...prev, quietHoursStart: e.target.value }))} placeholder="Quiet start" />
            <input className="support-form-input" value={runtime.quietHoursEnd || ''} onChange={(e) => setRuntime((prev) => ({ ...prev, quietHoursEnd: e.target.value }))} placeholder="Quiet end" />
            <input className="support-form-input" value={runtime.safetyMode || ''} onChange={(e) => setRuntime((prev) => ({ ...prev, safetyMode: e.target.value }))} placeholder="Safety mode" />
            <input className="support-form-input" value={runtime.runtimeNotes || ''} onChange={(e) => setRuntime((prev) => ({ ...prev, runtimeNotes: e.target.value }))} placeholder="Notas do runtime" />
          </div>
          <div style={{ marginTop: '8px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {[
              ['autoDetectEnabled', 'Auto detect'],
              ['autoCampaignEnabled', 'Auto campaign'],
              ['autoExpireEnabled', 'Auto expire'],
              ['predictiveEnabled', 'Predictive'],
              ['revenueEnabled', 'Revenue'],
              ['kioskEnabled', 'Kiosk'],
              ['snapshotGenerationEnabled', 'Snapshots'],
              ['recommendationsEnabled', 'Recommendations'],
              ['simulationMode', 'Simulation'],
            ].map(([key, label]) => (
              <label key={key} className="text-sm text-text-primary">
                <input type="checkbox" checked={!!runtime[key]} onChange={(e) => setRuntime((prev) => ({ ...prev, [key]: e.target.checked }))} /> {label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: '10px' }}>
            <Button onClick={handleSaveRuntime} disabled={!canUpdate} style={{ width: 'auto' }}>Salvar runtime</Button>
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ fontWeight: 700, marginBottom: '12px' }}>Predictive insights</div>
          <div className="text-sm text-text-secondary">idle risk: <strong>{insights?.idleRisk || '-'}</strong></div>
          <div className="text-sm text-text-secondary">no-show risk: <strong>{insights?.noShowRisk || '-'}</strong></div>
          <div className="text-sm text-text-secondary">fill probability: <strong>{typeof insights?.fillProbability === 'number' ? `${Math.round(insights.fillProbability * 100)}%` : '-'}</strong></div>
          <div className="text-xs text-text-tertiary" style={{ marginTop: '8px' }}>{insights?.recommendedAction || 'Sem recomendação.'}</div>
          <div className="text-xs text-text-tertiary" style={{ marginTop: '6px' }}>{(insights?.reasonCodes || []).join(' • ')}</div>
          <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {(aggregatedMetrics || []).slice(0, 3).map((item, index) => (
              <div key={`${item.verticalTemplate}-${item.serviceType}-${index}`} className="text-xs text-text-secondary">
                {item.verticalTemplate}/{item.serviceType || 'all'} • fill {item.fillRate}% • accept {item.acceptRate}%
              </div>
            ))}
          </div>
        </div>

        <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '12px' }}>
            <div style={{ fontWeight: 700 }}>Revenue engine</div>
            <Button onClick={handleDetectRevenue} disabled={!canRun} style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }}>Detectar</Button>
          </div>
          {(revenueOpportunities || []).length === 0 ? (
            <div className="text-sm text-text-secondary">Nenhuma oportunidade aberta.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {revenueOpportunities.slice(0, 5).map((item) => (
                <div key={item.id} style={{ borderTop: '1px solid var(--color-border-default)', paddingTop: '8px' }}>
                  <strong>{item.type}</strong>
                  <div className="text-sm text-text-secondary">{item.service_type || 'sem serviceType'} • conf. {Math.round(Number(item.confidence || 0) * 100)}%</div>
                  <div className="text-xs text-text-tertiary">{(item.reasonCodes || []).join(' • ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg" style={{ marginTop: '16px' }}>
        <div style={{ fontWeight: 700, marginBottom: '12px' }}>Kiosk operations</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '8px' }}>
          <input className="support-form-input" placeholder="Kiosk code" value={kioskForm.kioskCode} onChange={(e) => setKioskForm((prev) => ({ ...prev, kioskCode: e.target.value }))} />
          <input className="support-form-input" placeholder="Contact ID" value={kioskForm.contactId} onChange={(e) => setKioskForm((prev) => ({ ...prev, contactId: e.target.value }))} />
          <input className="support-form-input" placeholder="Reason" value={kioskForm.reason} onChange={(e) => setKioskForm((prev) => ({ ...prev, reason: e.target.value }))} />
          <input className="support-form-input" placeholder="StartAt ISO" value={kioskForm.startAt} onChange={(e) => setKioskForm((prev) => ({ ...prev, startAt: e.target.value }))} />
          <input className="support-form-input" placeholder="EndAt ISO" value={kioskForm.endAt} onChange={(e) => setKioskForm((prev) => ({ ...prev, endAt: e.target.value }))} />
        </div>
        <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
          <Button onClick={() => handleKioskAction('session')} disabled={!canUpdate} style={{ width: 'auto' }}>Criar sessão</Button>
          <Button onClick={() => handleKioskAction('checkin')} disabled={!canUpdate} style={{ width: 'auto' }}>Check-in</Button>
          <Button onClick={() => handleKioskAction('availability')} disabled={!canRead} style={{ width: 'auto' }}>Disponibilidade</Button>
        </div>
        <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {kioskSessions.length === 0 ? (
            <div className="text-sm text-text-secondary">Nenhuma sessão recente.</div>
          ) : kioskSessions.slice(0, 4).map((item) => (
            <div key={item.id} style={{ borderTop: '1px solid var(--color-border-default)', paddingTop: '8px' }}>
              <strong>{item.kiosk_code || item.kioskCode}</strong>
              <div className="text-sm text-text-secondary">{item.status} • contato {item.contact_id || item.contactId || '-'} • ticket {item.ticket_id || item.ticketId || '-'}</div>
              <div className="text-xs text-text-tertiary">{item.status_reason || item.statusReason || '-'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-4 shadow-lg" style={{ marginTop: '16px' }}>
        <div style={{ fontWeight: 700, marginBottom: '12px' }}>Campanhas</div>
        {loading ? (
          <div className="text-sm text-text-secondary">Carregando...</div>
        ) : campaigns.length === 0 ? (
          <div className="text-sm text-text-secondary">Nenhuma campanha encontrada.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {campaigns.map((campaign) => (
              <div key={campaign.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: '10px', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <strong>{campaign.serviceType || 'agenda_autonoma'}</strong>
                    <div className="text-sm text-text-secondary">{formatDateTime(campaign.gapStartAt)} → {formatDateTime(campaign.gapEndAt)}</div>
                    <div className="text-xs text-text-tertiary">status {campaign.status} • sent {campaign.sentInvites}/{campaign.maxInvites}</div>
                  </div>
                  <div className="text-xs text-text-tertiary">{campaign.contextType}:{campaign.contextId}</div>
                </div>
                <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {(campaignCandidates[campaign.id] || []).map((candidate) => (
                    <div key={candidate.id} style={{ borderTop: '1px solid var(--color-border-default)', paddingTop: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                        <div>
                          <strong>{candidate.contact?.name || candidate.contactId}</strong>
                          <div className="text-sm text-text-secondary">{candidate.contact?.phone || '-'} • {candidate.inviteStatus}</div>
                          <div className="text-xs text-text-tertiary">score {candidate.score} • {Object.entries(candidate.scoreBreakdown || {}).slice(0, 3).map(([key, value]) => `${key}:${value}`).join(' | ')}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <Button onClick={() => handleCandidateAction(campaign.id, candidate.id, 'accept')} disabled={!canAccept} style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }}>Aceitar</Button>
                          <Button onClick={() => handleCandidateAction(campaign.id, candidate.id, 'reject')} disabled={!canAccept} style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }}>Rejeitar</Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
