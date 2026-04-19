import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import logger from '../utils/logger';
import {
  listMarketingForms,
  upsertMarketingForm,
  listMarketingLeads,
  getMarketingLeadStats,
  listMarketingScoringRules,
  upsertMarketingScoringRule,
  createMarketingEmailCampaign,
  sendMarketingEmailCampaign,
  listMarketingLinks,
  createMarketingLink,
  getMarketingGoogleAdsSettings,
  saveMarketingGoogleAdsSettings,
  listMarketingGoogleAdsConversions,
  createMarketingGoogleAdsConversion,
  uploadMarketingGoogleAdsConversions,
  syncMarketingGoogleAdsKeywordPerformance,
  listMarketingGoogleAdsKeywordPerformance,
  listMarketingGoogleAdsSearchTermPerformance,
  getMarketingGoogleAdsRoi,
  getMarketingGoogleAdsAttributionExceptions,
  analyzeMarketingGoogleAdsKeywords,
  applyMarketingGoogleAdsKeywordAction,
  syncMarketingGoogleAdsRecommendations,
  listMarketingGoogleAdsRecommendations,
  updateMarketingGoogleAdsRecommendation,
  applyMarketingGoogleAdsRecommendation,
} from '../api/marketing';
import { buildApiUrl } from '../api/client';
import { Button } from '../styles/Button';
import { CrudPageBase } from '../modules/crud-base';

const STAGE_ORDER = ['visitor', 'lead', 'mql', 'sql', 'customer'];
const SURFACE_STYLE = {
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-default)',
  borderRadius: '12px',
  padding: '16px',
  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.12)',
};
const CARD_STYLE = {
  padding: '8px 12px',
  border: '1px solid var(--color-border-default)',
  borderRadius: '8px',
  background: 'var(--color-bg-primary)',
};
const MUTED_TEXT_STYLE = {
  color: 'var(--color-text-secondary)',
};
const TABLE_STYLE = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '13px',
};
const TABLE_CELL_STYLE = {
  padding: '6px',
  borderBottom: '1px solid var(--color-border-default)',
  color: 'var(--color-text-primary)',
};

function toSafeString(value) {
  return value == null ? '' : String(value).trim();
}

function formatDateInput(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function getDefaultAdsWindow() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
  };
}

function formatMetricNumber(value, digits = 0) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatDateTime(value) {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString('pt-BR');
}

function getAttributionAlertStyles(severity) {
  if (severity === 'critical') {
    return {
      background: 'rgba(220, 38, 38, 0.12)',
      border: '1px solid rgba(220, 38, 38, 0.35)',
      color: '#fecaca',
      label: 'Crítico',
    };
  }
  if (severity === 'warning') {
    return {
      background: 'rgba(245, 158, 11, 0.14)',
      border: '1px solid rgba(245, 158, 11, 0.35)',
      color: '#fde68a',
      label: 'Alerta',
    };
  }
  return {
    background: 'rgba(34, 197, 94, 0.12)',
    border: '1px solid rgba(34, 197, 94, 0.28)',
    color: '#bbf7d0',
    label: 'Estável',
  };
}

function normalizeActionLabel(action) {
  const map = {
    include_keyword: 'Incluir keyword',
    add_negative_keyword: 'Adicionar negativa',
    remove_or_pause_keyword: 'Pausar keyword',
    pause_keyword: 'Pausar keyword',
  };
  return map[toSafeString(action)] || toSafeString(action) || 'Ação';
}

function buildKeywordActionPayload(recommendation, dryRun) {
  const action = toSafeString(recommendation?.action);
  const normalizedAction = action === 'remove_or_pause_keyword' ? 'pause_keyword' : action;
  const payload = {
    action: normalizedAction,
    campaignId: toSafeString(recommendation?.campaignId),
    adGroupId: toSafeString(recommendation?.adGroupId),
    dryRun: dryRun === true,
  };

  if (normalizedAction === 'include_keyword' || normalizedAction === 'add_negative_keyword') {
    payload.keywordText = toSafeString(recommendation?.term || recommendation?.keywordText);
    payload.matchType = toSafeString(recommendation?.matchType || 'PHRASE') || 'PHRASE';
  }

  if (normalizedAction === 'pause_keyword') {
    payload.keywordId = toSafeString(recommendation?.keywordId);
  }

  return payload;
}

function canApplyRecommendation(recommendation) {
  const payload = buildKeywordActionPayload(recommendation, false);
  if (!payload.action || !payload.campaignId || !payload.adGroupId) return false;
  if (payload.action === 'pause_keyword') return Boolean(payload.keywordId);
  return Boolean(payload.keywordText);
}

function resolveLeadJourney(lead) {
  const attrs = lead && typeof lead.attributes === 'object' ? lead.attributes : {};
  const source =
    toSafeString(attrs.utm_source) ||
    toSafeString(attrs.source) ||
    toSafeString(lead?.source) ||
    'desconhecido';
  const campaign =
    toSafeString(attrs.utm_campaign) ||
    toSafeString(attrs.campaign) ||
    toSafeString(lead?.campaign) ||
    'sem-campanha';
  return {
    source: source.toLowerCase(),
    campaign: campaign.toLowerCase(),
  };
}

export function MarketingPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [forms, setForms] = useState([]);
  const [leadStats, setLeadStats] = useState([]);
  const [leads, setLeads] = useState([]);
  const [scoringRules, setScoringRules] = useState([]);
  const [links, setLinks] = useState([]);
  const [googleAdsSettings, setGoogleAdsSettings] = useState({
    enabled: false,
    customerId: '',
    loginCustomerId: '',
    defaultConversionActionId: '',
    defaultConversionName: 'customer',
    defaultCurrencyCode: 'BRL',
    dryRun: true,
    autoUpload: false,
    developerToken: '',
    clientId: '',
    clientSecret: '',
    refreshToken: '',
    hasDeveloperToken: false,
    hasClientId: false,
    hasClientSecret: false,
    hasRefreshToken: false,
  });
  const [googleAdsConversions, setGoogleAdsConversions] = useState([]);
  const [googleAdsConversionData, setGoogleAdsConversionData] = useState({
    leadId: '',
    clickIdType: 'gclid',
    clickId: '',
    conversionName: 'customer',
    conversionActionId: '',
    conversionValue: '',
    currencyCode: 'BRL',
  });
  const [googleAdsInsightFilters, setGoogleAdsInsightFilters] = useState(getDefaultAdsWindow);
  const [googleAdsKeywordPerformance, setGoogleAdsKeywordPerformance] = useState([]);
  const [googleAdsSearchTermPerformance, setGoogleAdsSearchTermPerformance] = useState([]);
  const [googleAdsKeywordAnalysis, setGoogleAdsKeywordAnalysis] = useState(null);
  const [googleAdsSyncResult, setGoogleAdsSyncResult] = useState(null);
  const [applyingRecommendationKey, setApplyingRecommendationKey] = useState('');
  const [googleAdsPersistedRecommendations, setGoogleAdsPersistedRecommendations] = useState([]);
  const [googleAdsRoiEntity, setGoogleAdsRoiEntity] = useState('campaign');
  const [googleAdsRoiData, setGoogleAdsRoiData] = useState(null);
  const [googleAdsAttributionExceptions, setGoogleAdsAttributionExceptions] = useState(null);
  const [googleAdsAttributionWindowDays, setGoogleAdsAttributionWindowDays] = useState(7);

  const [leadFilters, setLeadFilters] = useState({ stage: '', minScore: '' });
  const [formData, setFormData] = useState({ slug: '', name: '', status: 'active' });
  const [ruleData, setRuleData] = useState({ name: '', eventType: '', delta: 1 });
  const [campaignData, setCampaignData] = useState({ name: '', subject: '', bodyText: '', minScore: '' });
  const [sendCampaignId, setSendCampaignId] = useState('');
  const [linkData, setLinkData] = useState({
    name: '',
    targetUrl: '',
    source: '',
    campaign: '',
    medium: '',
    content: '',
    term: '',
    code: '',
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadAll();
    }
  }, [authLoading, isAuthenticated]);

  const leadStatsMap = useMemo(() => {
    const map = {};
    (leadStats || []).forEach((row) => {
      if (!row) return;
      map[row.stage || 'unknown'] = row;
    });
    return map;
  }, [leadStats]);

  const funnelRows = useMemo(() => {
    const countByStage = {};
    (leadStats || []).forEach((row) => {
      const key = toSafeString(row?.stage).toLowerCase() || 'unknown';
      countByStage[key] = Number(row?.count || 0);
    });

    const discoveredStages = Object.keys(countByStage).filter((s) => !STAGE_ORDER.includes(s));
    const ordered = [...STAGE_ORDER, ...discoveredStages];
    const rows = ordered
      .map((stage) => ({
        stage,
        count: Number(countByStage[stage] || 0),
      }))
      .filter((row) => row.count > 0);

    const maxCount = rows.reduce((max, row) => Math.max(max, row.count), 0);
    return rows.map((row, idx) => {
      const prev = idx > 0 ? rows[idx - 1].count : null;
      const conversionRate = prev && prev > 0 ? (row.count / prev) * 100 : null;
      return {
        ...row,
        conversionRate,
        widthPct: maxCount > 0 ? Math.max((row.count / maxCount) * 100, 8) : 0,
      };
    });
  }, [leadStats]);

  const journeyRows = useMemo(() => {
    const grouped = new Map();
    (leads || []).forEach((lead) => {
      const journey = resolveLeadJourney(lead);
      const key = `${journey.source}__${journey.campaign}`;
      const current = grouped.get(key) || {
        source: journey.source,
        campaign: journey.campaign,
        leads: 0,
        avgScoreTotal: 0,
        customerCount: 0,
      };
      current.leads += 1;
      current.avgScoreTotal += Number(lead?.score || 0);
      if (toSafeString(lead?.stage).toLowerCase() === 'customer') current.customerCount += 1;
      grouped.set(key, current);
    });

    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        avgScore: row.leads > 0 ? row.avgScoreTotal / row.leads : 0,
        conversionToCustomer: row.leads > 0 ? (row.customerCount / row.leads) * 100 : 0,
      }))
      .sort((a, b) => b.leads - a.leads);
  }, [leads]);

  const journeyAlerts = useMemo(() => {
    const byCode = new Map();
    (links || []).forEach((link) => {
      const source = toSafeString(link?.source).toLowerCase();
      const campaign = toSafeString(link?.campaign).toLowerCase();
      const key = `${source || 'desconhecido'}__${campaign || 'sem-campanha'}`;
      byCode.set(key, (byCode.get(key) || 0) + Number(link?.click_count || 0));
    });

    const alerts = [];
    const highClickNoLeads = [];
    byCode.forEach((clicks, key) => {
      if (clicks < 20) return;
      const hasLead = journeyRows.some((row) => `${row.source}__${row.campaign}` === key);
      if (!hasLead) highClickNoLeads.push({ key, clicks });
    });

    if (highClickNoLeads.length > 0) {
      alerts.push({
        level: 'high',
        title: 'Alto clique sem geração de leads',
        detail: highClickNoLeads
          .slice(0, 3)
          .map((item) => `${item.key.replace('__', ' / ')}: ${item.clicks} cliques`)
          .join(' | '),
      });
    }

    const lowConversion = journeyRows
      .filter((row) => row.leads >= 5 && row.conversionToCustomer < 5)
      .slice(0, 3);
    if (lowConversion.length > 0) {
      alerts.push({
        level: 'medium',
        title: 'Jornadas com baixa conversão para cliente',
        detail: lowConversion
          .map((row) => `${row.source}/${row.campaign}: ${row.conversionToCustomer.toFixed(1)}%`)
          .join(' | '),
      });
    }

    return alerts;
  }, [journeyRows, links]);

  const attributionAlertUi = useMemo(
    () => getAttributionAlertStyles(googleAdsAttributionExceptions?.alert?.severity),
    [googleAdsAttributionExceptions?.alert?.severity],
  );

  async function loadAll() {
    setLoading(true);
    try {
      const [f, s, r, l] = await Promise.all([
        listMarketingForms(),
        getMarketingLeadStats(),
        listMarketingScoringRules(),
        listMarketingLeads(),
      ]);
      setForms(f?.items || []);
      setLeadStats(s?.items || []);
      setScoringRules(r?.items || []);
      setLeads(l?.items || []);
      const [linksResp, googleAdsSettingsResp, googleAdsConversionsResp] = await Promise.all([
        listMarketingLinks(),
        getMarketingGoogleAdsSettings(),
        listMarketingGoogleAdsConversions({ limit: 50 }),
      ]);
      setLinks(linksResp?.items || []);
      const nextGoogleAdsSettings = { ...googleAdsSettings, ...(googleAdsSettingsResp?.value || {}) };
      setGoogleAdsSettings((prev) => ({ ...prev, ...(googleAdsSettingsResp?.value || {}) }));
      setGoogleAdsConversions(googleAdsConversionsResp?.items || []);
      const recommendationsResp = await listMarketingGoogleAdsRecommendations({ limit: 20 });
      setGoogleAdsPersistedRecommendations(recommendationsResp?.items || []);
      if (nextGoogleAdsSettings.enabled === true) {
        await loadGoogleAdsInsights({ silent: true });
        await loadGoogleAdsRoi({ silent: true, entity: googleAdsRoiEntity });
        await loadGoogleAdsAttributionExceptions({ silent: true });
      }
    } catch (err) {
      logger.error('Erro ao carregar marketing:', err);
      showToast('Erro ao carregar Marketing', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateForm() {
    if (!formData.slug || !formData.name) {
      showToast('Preencha slug e nome do form', 'error');
      return;
    }
    setLoading(true);
    try {
      const out = await upsertMarketingForm({
        slug: formData.slug,
        name: formData.name,
        status: formData.status || 'active',
        fields: {},
        settings: {},
      });
      if (!out?.ok) {
        showToast('Falha ao salvar form', 'error');
        return;
      }
      setFormData({ slug: '', name: '', status: 'active' });
      await loadAll();
      showToast('Form salvo com sucesso!', 'success');
    } catch (err) {
      logger.error('Erro ao salvar form:', err);
      showToast('Erro ao salvar form', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateRule() {
    if (!ruleData.name || !ruleData.eventType) {
      showToast('Preencha nome e eventType', 'error');
      return;
    }
    setLoading(true);
    try {
      const out = await upsertMarketingScoringRule({
        name: ruleData.name,
        eventType: ruleData.eventType,
        delta: Number(ruleData.delta || 0),
        enabled: true,
      });
      if (!out?.ok) {
        showToast('Falha ao salvar regra', 'error');
        return;
      }
      setRuleData({ name: '', eventType: '', delta: 1 });
      await loadAll();
      showToast('Regra salva com sucesso!', 'success');
    } catch (err) {
      logger.error('Erro ao salvar regra:', err);
      showToast('Erro ao salvar regra', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCampaign() {
    if (!campaignData.name || !campaignData.subject || !campaignData.bodyText) {
      showToast('Preencha nome, assunto e corpo do email', 'error');
      return;
    }
    setLoading(true);
    try {
      const out = await createMarketingEmailCampaign({
        name: campaignData.name,
        subject: campaignData.subject,
        bodyText: campaignData.bodyText,
        minScore: campaignData.minScore ? Number(campaignData.minScore) : null,
      });
      if (!out?.ok) {
        showToast('Falha ao criar campanha', 'error');
        return;
      }
      setCampaignData({ name: '', subject: '', bodyText: '', minScore: '' });
      showToast('Campanha criada (draft)', 'success');
    } catch (err) {
      logger.error('Erro ao criar campanha:', err);
      showToast('Erro ao criar campanha', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendCampaign() {
    if (!sendCampaignId) {
      showToast('Informe o ID da campanha', 'error');
      return;
    }
    setLoading(true);
    try {
      const out = await sendMarketingEmailCampaign(sendCampaignId, 2000);
      if (!out?.ok && out?.error) {
        showToast(`Falha ao enviar: ${out.error}`, 'error');
        return;
      }
      showToast(`Campanha enfileirada (${out?.queued || 0})`, 'success');
    } catch (err) {
      logger.error('Erro ao enviar campanha:', err);
      showToast('Erro ao enviar campanha', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateLink() {
    if (!linkData.name || !linkData.targetUrl) {
      showToast('Preencha nome e URL do link', 'error');
      return;
    }
    setLoading(true);
    try {
      const out = await createMarketingLink({
        name: linkData.name,
        targetUrl: linkData.targetUrl,
        source: linkData.source || null,
        campaign: linkData.campaign || null,
        medium: linkData.medium || null,
        content: linkData.content || null,
        term: linkData.term || null,
        code: linkData.code || null,
      });
      if (!out?.ok) {
        showToast('Falha ao criar link', 'error');
        return;
      }
      setLinkData({ name: '', targetUrl: '', source: '', campaign: '', medium: '', content: '', term: '', code: '' });
      const linksResp = await listMarketingLinks();
      setLinks(linksResp?.items || []);
      showToast('Link criado com sucesso!', 'success');
    } catch (err) {
      logger.error('Erro ao criar link:', err);
      showToast('Erro ao criar link', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleFilterLeads() {
    setLoading(true);
    try {
      const out = await listMarketingLeads({
        stage: leadFilters.stage || null,
        minScore: leadFilters.minScore ? Number(leadFilters.minScore) : null,
      });
      setLeads(out?.items || []);
    } catch (err) {
      logger.error('Erro ao filtrar leads:', err);
      showToast('Erro ao filtrar leads', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveGoogleAdsSettings() {
    setLoading(true);
    try {
      const payload = {
        enabled: googleAdsSettings.enabled === true,
        customerId: googleAdsSettings.customerId || '',
        loginCustomerId: googleAdsSettings.loginCustomerId || '',
        defaultConversionActionId: googleAdsSettings.defaultConversionActionId || '',
        defaultConversionName: googleAdsSettings.defaultConversionName || 'customer',
        defaultCurrencyCode: googleAdsSettings.defaultCurrencyCode || 'BRL',
        dryRun: googleAdsSettings.dryRun !== false,
        autoUpload: googleAdsSettings.autoUpload === true,
        developerToken: googleAdsSettings.developerToken || '',
        clientId: googleAdsSettings.clientId || '',
        clientSecret: googleAdsSettings.clientSecret || '',
        refreshToken: googleAdsSettings.refreshToken || '',
      };
      const out = await saveMarketingGoogleAdsSettings(payload);
      if (!out?.ok) {
        showToast(`Falha ao salvar Google Ads: ${out?.error || 'erro'}`, 'error');
        return;
      }
      setGoogleAdsSettings((prev) => ({
        ...prev,
        ...(out?.value || {}),
        developerToken: '',
        clientId: '',
        clientSecret: '',
        refreshToken: '',
      }));
      showToast('Configuração do Google Ads salva', 'success');
    } catch (err) {
      logger.error('Erro ao salvar Google Ads settings:', err);
      showToast('Erro ao salvar Google Ads settings', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGoogleAdsConversion() {
    if (!googleAdsConversionData.conversionName || (!googleAdsConversionData.leadId && !googleAdsConversionData.clickId)) {
      showToast('Informe conversionName e leadId ou clickId', 'error');
      return;
    }
    setLoading(true);
    try {
      const out = await createMarketingGoogleAdsConversion({
        leadId: googleAdsConversionData.leadId || null,
        clickIdType: googleAdsConversionData.clickIdType || 'gclid',
        clickId: googleAdsConversionData.clickId || null,
        conversionName: googleAdsConversionData.conversionName,
        conversionActionId: googleAdsConversionData.conversionActionId || null,
        conversionValue: googleAdsConversionData.conversionValue ? Number(googleAdsConversionData.conversionValue) : null,
        currencyCode: googleAdsConversionData.currencyCode || 'BRL',
      });
      if (!out?.ok) {
        showToast(`Falha ao criar conversão: ${out?.error || 'erro'}`, 'error');
        return;
      }
      const conversionsResp = await listMarketingGoogleAdsConversions({ limit: 50 });
      setGoogleAdsConversions(conversionsResp?.items || []);
      setGoogleAdsConversionData((prev) => ({ ...prev, leadId: '', clickId: '', conversionValue: '' }));
      showToast('Conversão offline criada', 'success');
    } catch (err) {
      logger.error('Erro ao criar conversão Google Ads:', err);
      showToast('Erro ao criar conversão Google Ads', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleUploadGoogleAdsConversions() {
    setLoading(true);
    try {
      const out = await uploadMarketingGoogleAdsConversions(50);
      if (!out?.ok) {
        showToast(`Falha no upload: ${out?.error || 'erro'}`, 'error');
        return;
      }
      const conversionsResp = await listMarketingGoogleAdsConversions({ limit: 50 });
      setGoogleAdsConversions(conversionsResp?.items || []);
      showToast(`Upload concluído: ${out.uploaded || 0} enviado(s), ${out.failed || 0} falha(s)`, 'success');
    } catch (err) {
      logger.error('Erro ao enviar conversões Google Ads:', err);
      showToast('Erro ao enviar conversões Google Ads', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadGoogleAdsInsights({ silent = false } = {}) {
    const filters = {
      startDate: googleAdsInsightFilters.startDate || null,
      endDate: googleAdsInsightFilters.endDate || null,
    };
    try {
      const [keywordsOut, searchTermsOut, analysisOut] = await Promise.all([
        listMarketingGoogleAdsKeywordPerformance({ ...filters, limit: 20, sortBy: 'cost', sortOrder: 'desc' }),
        listMarketingGoogleAdsSearchTermPerformance({ ...filters, limit: 20, sortBy: 'cost', sortOrder: 'desc' }),
        analyzeMarketingGoogleAdsKeywords({ ...filters }),
      ]);
      setGoogleAdsKeywordPerformance(keywordsOut?.items || []);
      setGoogleAdsSearchTermPerformance(searchTermsOut?.items || []);
      setGoogleAdsKeywordAnalysis(analysisOut?.ok ? analysisOut : null);
      if (!silent) {
        showToast('Análise de Google Ads atualizada', 'success');
      }
    } catch (err) {
      logger.error('Erro ao carregar análise de Google Ads:', err);
      if (!silent) {
        showToast('Erro ao carregar análise de Google Ads', 'error');
      }
    }
  }

  async function loadGoogleAdsRoi({ silent = true, entity = googleAdsRoiEntity } = {}) {
    try {
      const out = await getMarketingGoogleAdsRoi({
        startDate: googleAdsInsightFilters.startDate || null,
        endDate: googleAdsInsightFilters.endDate || null,
        entity,
        sortBy: 'conversionValue',
        sortOrder: 'desc',
        limit: 20,
      });
      setGoogleAdsRoiData(out?.ok ? out : null);
      if (!silent) {
        showToast('ROI de Google Ads atualizado', 'success');
      }
    } catch (err) {
      logger.error('Erro ao carregar ROI de Google Ads:', err);
      if (!silent) {
        showToast('Erro ao carregar ROI de Google Ads', 'error');
      }
    }
  }

  async function loadGoogleAdsAttributionExceptions({ silent = true, windowDays = googleAdsAttributionWindowDays } = {}) {
    try {
      const out = await getMarketingGoogleAdsAttributionExceptions({ windowDays, limit: 20 });
      setGoogleAdsAttributionExceptions(out?.ok ? out : null);
      if (!silent) {
        showToast('Exceções de atribuição atualizadas', 'success');
      }
    } catch (err) {
      logger.error('Erro ao carregar exceções de atribuição Google Ads:', err);
      if (!silent) {
        showToast('Erro ao carregar exceções de atribuição', 'error');
      }
    }
  }

  async function loadGoogleAdsPersistedRecommendations({ silent = true } = {}) {
    try {
      const out = await listMarketingGoogleAdsRecommendations({ limit: 20 });
      setGoogleAdsPersistedRecommendations(out?.items || []);
      if (!silent) {
        showToast('Fila de recomendações atualizada', 'success');
      }
    } catch (err) {
      logger.error('Erro ao carregar recomendações persistidas Google Ads:', err);
      if (!silent) {
        showToast('Erro ao carregar fila de recomendações', 'error');
      }
    }
  }

  async function handleSyncGoogleAdsInsights() {
    setLoading(true);
    try {
      const out = await syncMarketingGoogleAdsKeywordPerformance({
        startDate: googleAdsInsightFilters.startDate || null,
        endDate: googleAdsInsightFilters.endDate || null,
      });
      if (!out?.ok) {
        showToast(`Falha ao sincronizar keywords: ${out?.error || 'erro'}`, 'error');
        return;
      }
      setGoogleAdsSyncResult(out);
      await loadGoogleAdsInsights({ silent: true });
      await loadGoogleAdsRoi({ silent: true, entity: googleAdsRoiEntity });
      showToast(`Sync concluído: ${out.keywordSynced || 0} keywords, ${out.searchTermSynced || 0} termos`, 'success');
    } catch (err) {
      logger.error('Erro ao sincronizar keywords Google Ads:', err);
      showToast('Erro ao sincronizar keywords Google Ads', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleAnalyzeGoogleAdsInsights() {
    setLoading(true);
    try {
      await loadGoogleAdsInsights({ silent: false });
      await loadGoogleAdsRoi({ silent: true, entity: googleAdsRoiEntity });
    } finally {
      setLoading(false);
    }
  }

  async function handleApplyGoogleAdsRecommendation(recommendation) {
    const payload = buildKeywordActionPayload(recommendation, googleAdsSettings.dryRun !== false);
    const actionKey = [payload.action, payload.campaignId, payload.adGroupId, payload.keywordId || payload.keywordText].join(':');
    if (!canApplyRecommendation(recommendation)) {
      showToast('Recomendação sem dados suficientes para aplicação', 'error');
      return;
    }
    setApplyingRecommendationKey(actionKey);
    try {
      const out = await applyMarketingGoogleAdsKeywordAction(payload);
      if (!out?.ok) {
        showToast(`Falha ao aplicar ação: ${out?.error || 'erro'}`, 'error');
        return;
      }
      await loadGoogleAdsInsights({ silent: true });
      showToast(payload.dryRun ? 'Validação enviada ao Google Ads' : 'Ação aplicada no Google Ads', 'success');
    } catch (err) {
      logger.error('Erro ao aplicar recomendação Google Ads:', err);
      showToast('Erro ao aplicar recomendação Google Ads', 'error');
    } finally {
      setApplyingRecommendationKey('');
    }
  }

  async function handlePersistGoogleAdsRecommendations() {
    setLoading(true);
    try {
      const out = await syncMarketingGoogleAdsRecommendations({
        startDate: googleAdsInsightFilters.startDate || null,
        endDate: googleAdsInsightFilters.endDate || null,
      });
      if (!out?.ok) {
        showToast(`Falha ao persistir recomendações: ${out?.error || 'erro'}`, 'error');
        return;
      }
      await loadGoogleAdsPersistedRecommendations({ silent: true });
      showToast(`Fila atualizada: ${out.created || 0} criada(s), ${out.skipped || 0} já existentes`, 'success');
    } catch (err) {
      logger.error('Erro ao persistir recomendações Google Ads:', err);
      showToast('Erro ao persistir recomendações Google Ads', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleDecisionPersistedRecommendation(recommendationId, status) {
    const actionKey = `decision:${recommendationId}:${status}`;
    setApplyingRecommendationKey(actionKey);
    try {
      const out = await updateMarketingGoogleAdsRecommendation(recommendationId, { status });
      if (!out?.ok) {
        showToast(`Falha ao atualizar recomendação: ${out?.error || 'erro'}`, 'error');
        return;
      }
      await loadGoogleAdsPersistedRecommendations({ silent: true });
      showToast(status === 'approved' ? 'Recomendação aprovada' : 'Recomendação rejeitada', 'success');
    } catch (err) {
      logger.error('Erro ao decidir recomendação Google Ads:', err);
      showToast('Erro ao atualizar recomendação Google Ads', 'error');
    } finally {
      setApplyingRecommendationKey('');
    }
  }

  async function handleApplyPersistedRecommendation(recommendationId) {
    const actionKey = `apply:${recommendationId}`;
    setApplyingRecommendationKey(actionKey);
    try {
      const out = await applyMarketingGoogleAdsRecommendation(recommendationId, { dryRun: googleAdsSettings.dryRun !== false });
      if (!out?.ok) {
        showToast(`Falha ao aplicar recomendação persistida: ${out?.error || 'erro'}`, 'error');
        return;
      }
      await Promise.all([
        loadGoogleAdsPersistedRecommendations({ silent: true }),
        loadGoogleAdsInsights({ silent: true }),
        loadGoogleAdsRoi({ silent: true, entity: googleAdsRoiEntity }),
        loadGoogleAdsAttributionExceptions({ silent: true }),
      ]);
      showToast(googleAdsSettings.dryRun !== false ? 'Validação da recomendação concluída' : 'Recomendação aplicada com sucesso', 'success');
    } catch (err) {
      logger.error('Erro ao aplicar recomendação persistida Google Ads:', err);
      showToast('Erro ao aplicar recomendação persistida Google Ads', 'error');
    } finally {
      setApplyingRecommendationKey('');
    }
  }

  if (authLoading) {
    return (
      <CrudPageBase>
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <CrudPageBase>
      <ToastContainer />
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🧲 Marketing v1</h1>
        </div>
        <div className="support-controls">
          <Button onClick={loadAll} variant="primary">
            🔄 Atualizar
          </Button>
        </div>
      </div>

      {googleAdsSettings.enabled === true && googleAdsAttributionExceptions?.alert?.triggered === true && (
        <div style={{
          marginBottom: '16px',
          padding: '14px 16px',
          borderRadius: '12px',
          ...attributionAlertUi,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <strong style={{ display: 'block', marginBottom: '4px' }}>
                Google Ads: {attributionAlertUi.label} de atribuição ausente
              </strong>
              <span>
                Crescimento de {formatMetricNumber(googleAdsAttributionExceptions?.alert?.growthFactor || 0, 2)}x na janela de {formatMetricNumber(googleAdsAttributionExceptions?.alert?.windowDays || googleAdsAttributionWindowDays)} dia(s),
                com {formatMetricNumber(googleAdsAttributionExceptions?.alert?.currentCount || 0)} ocorrência(s) recente(s).
              </span>
            </div>
            <button onClick={() => loadGoogleAdsAttributionExceptions({ silent: false })} className="btn-default px-4 py-2 text-sm">
              Atualizar alerta
            </button>
          </div>
        </div>
      )}

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Stage</label>
            <input
              value={leadFilters.stage}
              onChange={(e) => setLeadFilters((s) => ({ ...s, stage: e.target.value }))}
              placeholder="lead, mql, sql..."
            />
          </div>
          <div>
            <label className="block mb-2 text-sm font-medium text-text-primary">Score mínimo</label>
            <input
              type="number"
              value={leadFilters.minScore}
              onChange={(e) => setLeadFilters((s) => ({ ...s, minScore: e.target.value }))}
              placeholder="0"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={handleFilterLeads} disabled={loading} className="w-full" variant="primary">
              Filtrar Leads
            </Button>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => {
                setLeadFilters({ stage: '', minScore: '' });
                loadAll();
              }}
              disabled={loading && !leadFilters.stage && !leadFilters.minScore}
              className="w-full"
            >
              Limpar Filtros
            </Button>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px', paddingTop: 0 }}>
        <p style={{ ...MUTED_TEXT_STYLE, marginBottom: '20px' }}>
          Gestão de forms, leads, scoring, campanhas e jornada/funil operacional.
        </p>

        <div style={{ display: 'grid', gap: '16px' }}>
          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Google Ads</h2>
            <p style={{ ...MUTED_TEXT_STYLE, marginBottom: '12px' }}>
              Configure credenciais, crie conversões offline e dispare upload manual.
            </p>
            <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={googleAdsSettings.enabled === true} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, enabled: e.target.checked }))} />
                Integração habilitada
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={googleAdsSettings.dryRun !== false} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, dryRun: e.target.checked }))} />
                Validate only (dry-run)
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={googleAdsSettings.autoUpload === true} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, autoUpload: e.target.checked }))} />
                Auto upload
              </label>
              <input value={googleAdsSettings.customerId || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, customerId: e.target.value }))} placeholder="Customer ID" />
              <input value={googleAdsSettings.loginCustomerId || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, loginCustomerId: e.target.value }))} placeholder="Login Customer ID" />
              <input value={googleAdsSettings.defaultConversionActionId || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, defaultConversionActionId: e.target.value }))} placeholder="Default Conversion Action ID" />
              <input value={googleAdsSettings.defaultConversionName || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, defaultConversionName: e.target.value }))} placeholder="Default Conversion Name" />
              <input value={googleAdsSettings.defaultCurrencyCode || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, defaultCurrencyCode: e.target.value }))} placeholder="Currency Code" />
              <input value={googleAdsSettings.developerToken || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, developerToken: e.target.value }))} placeholder={googleAdsSettings.hasDeveloperToken ? 'Developer Token salvo' : 'Developer Token'} />
              <input value={googleAdsSettings.clientId || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, clientId: e.target.value }))} placeholder={googleAdsSettings.hasClientId ? 'Client ID salvo' : 'Client ID'} />
              <input type="password" value={googleAdsSettings.clientSecret || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, clientSecret: e.target.value }))} placeholder={googleAdsSettings.hasClientSecret ? 'Client Secret salvo' : 'Client Secret'} />
              <input type="password" value={googleAdsSettings.refreshToken || ''} onChange={(e) => setGoogleAdsSettings((s) => ({ ...s, refreshToken: e.target.value }))} placeholder={googleAdsSettings.hasRefreshToken ? 'Refresh Token salvo' : 'Refresh Token'} />
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
              <button onClick={handleSaveGoogleAdsSettings} disabled={loading} className="btn-primary px-4 py-2 text-sm">Salvar Google Ads</button>
              <button onClick={handleUploadGoogleAdsConversions} disabled={loading} className="btn-default px-4 py-2 text-sm">Enviar pendências</button>
            </div>

            <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--color-border-default)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, marginBottom: '6px' }}>Performance e recomendações</h3>
                  <p style={{ ...MUTED_TEXT_STYLE, margin: 0 }}>
                    Sincronize keywords e termos pesquisados, analise o portfólio e aplique recomendações direto daqui.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <input type="date" value={googleAdsInsightFilters.startDate} onChange={(e) => setGoogleAdsInsightFilters((s) => ({ ...s, startDate: e.target.value }))} />
                  <input type="date" value={googleAdsInsightFilters.endDate} onChange={(e) => setGoogleAdsInsightFilters((s) => ({ ...s, endDate: e.target.value }))} />
                  <button onClick={handleSyncGoogleAdsInsights} disabled={loading || googleAdsSettings.enabled !== true} className="btn-default px-4 py-2 text-sm">Sincronizar</button>
                  <button onClick={handleAnalyzeGoogleAdsInsights} disabled={loading || googleAdsSettings.enabled !== true} className="btn-primary px-4 py-2 text-sm">Analisar</button>
                  <button onClick={handlePersistGoogleAdsRecommendations} disabled={loading || googleAdsSettings.enabled !== true} className="btn-default px-4 py-2 text-sm">Salvar recomendações</button>
                </div>
              </div>

              {googleAdsSyncResult?.ok && (
                <div style={{ ...CARD_STYLE, marginTop: '12px' }}>
                  Último sync: {formatMetricNumber(googleAdsSyncResult.keywordSynced)} keywords e {formatMetricNumber(googleAdsSyncResult.searchTermSynced)} termos entre {googleAdsSyncResult.startDate} e {googleAdsSyncResult.endDate}.
                </div>
              )}

              {googleAdsKeywordAnalysis?.ai?.summary && (
                <div style={{ ...CARD_STYLE, marginTop: '12px' }}>
                  <strong>Resumo IA</strong>
                  <div style={{ marginTop: '6px', color: 'var(--color-text-secondary)' }}>{googleAdsKeywordAnalysis.ai.summary}</div>
                </div>
              )}

              <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: '12px' }}>
                <div style={CARD_STYLE}>
                  <div style={MUTED_TEXT_STYLE}>Keywords analisadas</div>
                  <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsKeywordAnalysis?.totals?.keywords || 0)}</strong>
                </div>
                <div style={CARD_STYLE}>
                  <div style={MUTED_TEXT_STYLE}>Search terms analisados</div>
                  <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsKeywordAnalysis?.totals?.searchTerms || 0)}</strong>
                </div>
                <div style={CARD_STYLE}>
                  <div style={MUTED_TEXT_STYLE}>Custo de keywords</div>
                  <strong style={{ fontSize: '22px' }}>R$ {formatMetricNumber(googleAdsKeywordAnalysis?.totals?.keywordCost || 0, 2)}</strong>
                </div>
                <div style={CARD_STYLE}>
                  <div style={MUTED_TEXT_STYLE}>Valor de conversão</div>
                  <strong style={{ fontSize: '22px' }}>R$ {formatMetricNumber(googleAdsKeywordAnalysis?.totals?.keywordConversionValue || 0, 2)}</strong>
                </div>
              </div>

              <div style={{ marginTop: '16px', overflowX: 'auto' }}>
                <h3 style={{ marginBottom: '8px' }}>Recomendações</h3>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Ação</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Termo / keyword</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Confiança</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Justificativa</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Operação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(googleAdsKeywordAnalysis?.recommendations || []).map((item, index) => {
                      const actionPayload = buildKeywordActionPayload(item, googleAdsSettings.dryRun !== false);
                      const actionKey = [actionPayload.action, actionPayload.campaignId, actionPayload.adGroupId, actionPayload.keywordId || actionPayload.keywordText || index].join(':');
                      return (
                        <tr key={actionKey}>
                          <td style={TABLE_CELL_STYLE}>{normalizeActionLabel(item.action)}</td>
                          <td style={TABLE_CELL_STYLE}>{item.term || item.keywordText || item.keywordId || '-'}</td>
                          <td style={TABLE_CELL_STYLE}>{formatMetricNumber(Number(item.confidence || 0) * 100, 0)}%</td>
                          <td style={TABLE_CELL_STYLE}>{item.rationale || '-'}</td>
                          <td style={TABLE_CELL_STYLE}>
                            <button
                              onClick={() => handleApplyGoogleAdsRecommendation(item)}
                              disabled={loading || applyingRecommendationKey === actionKey || !canApplyRecommendation(item)}
                              className="btn-default px-3 py-1 text-sm"
                            >
                              {applyingRecommendationKey === actionKey ? 'Aplicando...' : (googleAdsSettings.dryRun !== false ? 'Validar' : 'Aplicar')}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {(!googleAdsKeywordAnalysis?.recommendations || googleAdsKeywordAnalysis.recommendations.length === 0) && (
                      <tr>
                        <td colSpan={5} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Nenhuma recomendação disponível para a janela informada</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: '16px', overflowX: 'auto' }}>
                <h3 style={{ marginBottom: '8px' }}>Fila persistida</h3>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Título</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Status</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Prioridade</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(googleAdsPersistedRecommendations || []).map((item) => {
                      const canApply = item.status === 'approved' || item.status === 'open';
                      return (
                        <tr key={item.id}>
                          <td style={TABLE_CELL_STYLE}>
                            <div>{item.title || 'Recomendação'}</div>
                            <div style={{ ...MUTED_TEXT_STYLE, fontSize: '12px' }}>{item.description || '-'}</div>
                          </td>
                          <td style={TABLE_CELL_STYLE}>{item.status || '-'}</td>
                          <td style={TABLE_CELL_STYLE}>{item.priority || '-'}</td>
                          <td style={TABLE_CELL_STYLE}>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              <button
                                onClick={() => handleDecisionPersistedRecommendation(item.id, 'approved')}
                                disabled={loading || item.status === 'approved' || applyingRecommendationKey === `decision:${item.id}:approved`}
                                className="btn-default px-3 py-1 text-sm"
                              >
                                Aprovar
                              </button>
                              <button
                                onClick={() => handleDecisionPersistedRecommendation(item.id, 'rejected')}
                                disabled={loading || item.status === 'rejected' || applyingRecommendationKey === `decision:${item.id}:rejected`}
                                className="btn-default px-3 py-1 text-sm"
                              >
                                Rejeitar
                              </button>
                              <button
                                onClick={() => handleApplyPersistedRecommendation(item.id)}
                                disabled={loading || !canApply || applyingRecommendationKey === `apply:${item.id}`}
                                className="btn-primary px-3 py-1 text-sm"
                              >
                                {applyingRecommendationKey === `apply:${item.id}` ? 'Aplicando...' : (googleAdsSettings.dryRun !== false ? 'Validar' : 'Aplicar')}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {(!googleAdsPersistedRecommendations || googleAdsPersistedRecommendations.length === 0) && (
                      <tr>
                        <td colSpan={4} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Nenhuma recomendação persistida ainda</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: '16px' }}>
                <div>
                  <h3 style={{ marginBottom: '8px' }}>Top keywords por custo</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={TABLE_STYLE}>
                      <thead>
                        <tr>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Keyword</th>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Cliques</th>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Custo</th>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Conv.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(googleAdsKeywordPerformance || []).slice(0, 8).map((item) => (
                          <tr key={`${item.keywordId}-${item.matchType}`}> 
                            <td style={TABLE_CELL_STYLE}>{item.keywordText || '-'}</td>
                            <td style={TABLE_CELL_STYLE}>{formatMetricNumber(item.clicks || 0)}</td>
                            <td style={TABLE_CELL_STYLE}>R$ {formatMetricNumber(item.cost || 0, 2)}</td>
                            <td style={TABLE_CELL_STYLE}>{formatMetricNumber(item.conversions || 0, 2)}</td>
                          </tr>
                        ))}
                        {(!googleAdsKeywordPerformance || googleAdsKeywordPerformance.length === 0) && (
                          <tr>
                            <td colSpan={4} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Sem dados de keywords sincronizados</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div>
                  <h3 style={{ marginBottom: '8px' }}>Top search terms por custo</h3>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={TABLE_STYLE}>
                      <thead>
                        <tr>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Search term</th>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Cliques</th>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Custo</th>
                          <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Conv.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(googleAdsSearchTermPerformance || []).slice(0, 8).map((item, index) => (
                          <tr key={`${item.searchTerm || 'term'}-${index}`}> 
                            <td style={TABLE_CELL_STYLE}>{item.searchTerm || '-'}</td>
                            <td style={TABLE_CELL_STYLE}>{formatMetricNumber(item.clicks || 0)}</td>
                            <td style={TABLE_CELL_STYLE}>R$ {formatMetricNumber(item.cost || 0, 2)}</td>
                            <td style={TABLE_CELL_STYLE}>{formatMetricNumber(item.conversions || 0, 2)}</td>
                          </tr>
                        ))}
                        {(!googleAdsSearchTermPerformance || googleAdsSearchTermPerformance.length === 0) && (
                          <tr>
                            <td colSpan={4} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Sem dados de search terms sincronizados</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--color-border-default)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ margin: 0, marginBottom: '6px' }}>ROI e ROAS</h3>
                    <p style={{ ...MUTED_TEXT_STYLE, margin: 0 }}>
                      Breakdown financeiro do Google Ads por campanha, grupo, keyword ou search term com base no custo sincronizado e no valor de conversão.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <select value={googleAdsRoiEntity} onChange={(e) => setGoogleAdsRoiEntity(e.target.value)}>
                      <option value="campaign">Campanha</option>
                      <option value="ad_group">Ad group</option>
                      <option value="keyword">Keyword</option>
                      <option value="search_term">Search term</option>
                    </select>
                    <select value={googleAdsAttributionWindowDays} onChange={(e) => setGoogleAdsAttributionWindowDays(Number(e.target.value) || 7)}>
                      <option value={1}>1 dia</option>
                      <option value={3}>3 dias</option>
                      <option value={7}>7 dias</option>
                    </select>
                    <button onClick={() => loadGoogleAdsRoi({ silent: false, entity: googleAdsRoiEntity })} disabled={loading || googleAdsSettings.enabled !== true} className="btn-default px-4 py-2 text-sm">Atualizar ROI</button>
                    <button onClick={() => loadGoogleAdsAttributionExceptions({ silent: false })} disabled={loading || googleAdsSettings.enabled !== true} className="btn-default px-4 py-2 text-sm">Atualizar exceções</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: '12px' }}>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>ROAS keywords</div>
                    <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsRoiData?.summary?.keywords?.roas || 0, 2)}</strong>
                  </div>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>ROI keywords</div>
                    <strong style={{ fontSize: '22px' }}>{formatMetricNumber((googleAdsRoiData?.summary?.keywords?.roi || 0) * 100, 0)}%</strong>
                  </div>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>Custo keywords</div>
                    <strong style={{ fontSize: '22px' }}>R$ {formatMetricNumber(googleAdsRoiData?.summary?.keywords?.cost || 0, 2)}</strong>
                  </div>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>Valor keywords</div>
                    <strong style={{ fontSize: '22px' }}>R$ {formatMetricNumber(googleAdsRoiData?.summary?.keywords?.conversionValue || 0, 2)}</strong>
                  </div>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>Receita real reconciliada</div>
                    <strong style={{ fontSize: '22px' }}>R$ {formatMetricNumber(googleAdsRoiData?.summary?.reconciled?.internalRevenue || 0, 2)}</strong>
                  </div>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>ROAS reconciliado</div>
                    <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsRoiData?.summary?.reconciled?.reconciledRoas || 0, 2)}</strong>
                  </div>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>ROI reconciliado</div>
                    <strong style={{ fontSize: '22px' }}>{formatMetricNumber((googleAdsRoiData?.summary?.reconciled?.reconciledRoi || 0) * 100, 0)}%</strong>
                  </div>
                  <div style={CARD_STYLE}>
                    <div style={MUTED_TEXT_STYLE}>Pedidos atribuídos</div>
                    <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsRoiData?.summary?.reconciled?.attributedOrders || 0)}</strong>
                  </div>
                </div>

                <div style={{ marginTop: '16px', overflowX: 'auto' }}>
                  <table style={TABLE_STYLE}>
                    <thead>
                      <tr>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Entidade</th>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Custo</th>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Valor</th>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Margem</th>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>ROAS</th>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>ROI</th>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Receita real</th>
                        <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>ROAS real</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(googleAdsRoiData?.items || []).map((item, index) => {
                        const label = item.searchTerm || item.keywordText || item.adGroupName || item.campaignName || item.campaignId || `item-${index}`;
                        return (
                          <tr key={`${googleAdsRoiEntity}-${label}-${index}`}>
                            <td style={TABLE_CELL_STYLE}>{label}</td>
                            <td style={TABLE_CELL_STYLE}>R$ {formatMetricNumber(item.cost || 0, 2)}</td>
                            <td style={TABLE_CELL_STYLE}>R$ {formatMetricNumber(item.conversionValue || 0, 2)}</td>
                            <td style={TABLE_CELL_STYLE}>R$ {formatMetricNumber(item.margin || 0, 2)}</td>
                            <td style={TABLE_CELL_STYLE}>{formatMetricNumber(item.roas || 0, 2)}</td>
                            <td style={TABLE_CELL_STYLE}>{formatMetricNumber((item.roi || 0) * 100, 0)}%</td>
                            <td style={TABLE_CELL_STYLE}>R$ {formatMetricNumber(item.internalRevenue || 0, 2)} ({formatMetricNumber(item.attributedOrders || 0)})</td>
                            <td style={TABLE_CELL_STYLE}>{formatMetricNumber(item.reconciledRoas || 0, 2)}</td>
                          </tr>
                        );
                      })}
                      {(!googleAdsRoiData?.items || googleAdsRoiData.items.length === 0) && (
                        <tr>
                          <td colSpan={8} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Sem dados de ROI para a entidade selecionada</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ ...SURFACE_STYLE, marginTop: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                      <h3 style={{ margin: 0, marginBottom: '6px' }}>Exceções de atribuição</h3>
                      <p style={{ ...MUTED_TEXT_STYLE, margin: 0 }}>
                        Pedidos sem `marketingAttribution` detectados no event ledger nos últimos {googleAdsAttributionExceptions?.windowDays || googleAdsAttributionWindowDays} dias.
                      </p>
                    </div>
                    <div style={{
                      padding: '8px 12px',
                      borderRadius: '999px',
                      fontSize: '12px',
                      fontWeight: 700,
                      ...attributionAlertUi,
                    }}>
                      {attributionAlertUi.label}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginTop: '12px' }}>
                    <div style={CARD_STYLE}>
                      <div style={MUTED_TEXT_STYLE}>Sem atribuição no período</div>
                      <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsAttributionExceptions?.summary?.recentMissing || 0)}</strong>
                    </div>
                    <div style={CARD_STYLE}>
                      <div style={MUTED_TEXT_STYLE}>Pedidos distintos</div>
                      <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsAttributionExceptions?.summary?.distinctOrdersRecent || 0)}</strong>
                    </div>
                    <div style={CARD_STYLE}>
                      <div style={MUTED_TEXT_STYLE}>Acumulado histórico</div>
                      <strong style={{ fontSize: '22px' }}>{formatMetricNumber(googleAdsAttributionExceptions?.summary?.totalMissing || 0)}</strong>
                    </div>
                    <div style={CARD_STYLE}>
                      <div style={MUTED_TEXT_STYLE}>Última ocorrência</div>
                      <strong style={{ fontSize: '14px' }}>{formatDateTime(googleAdsAttributionExceptions?.summary?.lastOccurredAt)}</strong>
                    </div>
                  </div>

                  <div style={{ ...CARD_STYLE, marginTop: '12px' }}>
                    <div style={{ ...MUTED_TEXT_STYLE, marginBottom: '4px' }}>Status do alerta automático</div>
                    <strong>
                      {googleAdsAttributionExceptions?.alert?.triggered
                        ? `${attributionAlertUi.label}: crescimento ${formatMetricNumber(googleAdsAttributionExceptions?.alert?.growthFactor || 0, 2)}x`
                        : 'Sem crescimento anormal no momento'}
                    </strong>
                    <div style={{ ...MUTED_TEXT_STYLE, marginTop: '4px' }}>
                      Janela: {formatMetricNumber(googleAdsAttributionExceptions?.alert?.windowDays || 0)} dia(s)
                      {' '}| Atual: {formatMetricNumber(googleAdsAttributionExceptions?.alert?.currentCount || 0)}
                      {' '}| Anterior: {formatMetricNumber(googleAdsAttributionExceptions?.alert?.previousCount || 0)}
                      {' '}| Limiar: {formatMetricNumber(googleAdsAttributionExceptions?.alert?.thresholds?.minRecentMissing || 0)} eventos e {formatMetricNumber(googleAdsAttributionExceptions?.alert?.thresholds?.growthFactorThreshold || 0, 2)}x
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: '16px', gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)', marginTop: '16px' }}>
                    <div>
                      <h4 style={{ marginTop: 0, marginBottom: '8px' }}>Por origem</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {(googleAdsAttributionExceptions?.bySource || []).map((item) => (
                          <div key={item.source} style={CARD_STYLE}>
                            <strong>{item.source}</strong>
                            <div style={MUTED_TEXT_STYLE}>Período: {formatMetricNumber(item.recent)} | Histórico: {formatMetricNumber(item.total)}</div>
                          </div>
                        ))}
                        {(!googleAdsAttributionExceptions?.bySource || googleAdsAttributionExceptions.bySource.length === 0) && (
                          <div style={CARD_STYLE}>Nenhuma origem com exceção registrada.</div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h4 style={{ marginTop: 0, marginBottom: '8px' }}>Últimos pedidos afetados</h4>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={TABLE_STYLE}>
                          <thead>
                            <tr>
                              <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Quando</th>
                              <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Pedido</th>
                              <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Origem</th>
                              <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Correlation</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(googleAdsAttributionExceptions?.items || []).map((item) => (
                              <tr key={item.id}>
                                <td style={TABLE_CELL_STYLE}>{formatDateTime(item.occurredAt)}</td>
                                <td style={TABLE_CELL_STYLE}>{item.payload?.orderNumber || item.orderId || '-'}</td>
                                <td style={TABLE_CELL_STYLE}>{item.source || '-'}</td>
                                <td style={TABLE_CELL_STYLE}>{item.correlationId || '-'}</td>
                              </tr>
                            ))}
                            {(!googleAdsAttributionExceptions?.items || googleAdsAttributionExceptions.items.length === 0) && (
                              <tr>
                                <td colSpan={4} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Nenhuma exceção recente.</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', marginTop: '16px' }}>
              <input value={googleAdsConversionData.leadId} onChange={(e) => setGoogleAdsConversionData((s) => ({ ...s, leadId: e.target.value }))} placeholder="Lead ID" />
              <select value={googleAdsConversionData.clickIdType} onChange={(e) => setGoogleAdsConversionData((s) => ({ ...s, clickIdType: e.target.value }))}>
                <option value="gclid">gclid</option>
                <option value="gbraid">gbraid</option>
                <option value="wbraid">wbraid</option>
              </select>
              <input value={googleAdsConversionData.clickId} onChange={(e) => setGoogleAdsConversionData((s) => ({ ...s, clickId: e.target.value }))} placeholder="Click ID (opcional se houver leadId)" />
              <input value={googleAdsConversionData.conversionName} onChange={(e) => setGoogleAdsConversionData((s) => ({ ...s, conversionName: e.target.value }))} placeholder="Conversion Name" />
              <input value={googleAdsConversionData.conversionActionId} onChange={(e) => setGoogleAdsConversionData((s) => ({ ...s, conversionActionId: e.target.value }))} placeholder="Conversion Action ID (opcional)" />
              <input value={googleAdsConversionData.conversionValue} onChange={(e) => setGoogleAdsConversionData((s) => ({ ...s, conversionValue: e.target.value }))} placeholder="Valor" />
              <input value={googleAdsConversionData.currencyCode} onChange={(e) => setGoogleAdsConversionData((s) => ({ ...s, currencyCode: e.target.value }))} placeholder="Moeda" />
            </div>
            <button onClick={handleCreateGoogleAdsConversion} disabled={loading} className="btn-primary px-4 py-2 text-sm" style={{ marginTop: '12px' }}>
              Criar conversão offline
            </button>

            <div style={{ marginTop: '16px', overflowX: 'auto' }}>
              <table style={TABLE_STYLE}>
                <thead>
                  <tr>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Lead</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Tipo</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Click ID</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Conversão</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(googleAdsConversions || []).map((item) => (
                    <tr key={item.id}>
                      <td style={TABLE_CELL_STYLE}>{item.lead_id || '-'}</td>
                      <td style={TABLE_CELL_STYLE}>{item.click_id_type}</td>
                      <td style={TABLE_CELL_STYLE}>{item.click_id}</td>
                      <td style={TABLE_CELL_STYLE}>{item.conversion_name}</td>
                      <td style={TABLE_CELL_STYLE}>{item.status}</td>
                    </tr>
                  ))}
                  {(!googleAdsConversions || googleAdsConversions.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Nenhuma conversão offline cadastrada</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Links rastreáveis</h2>
            <p style={{ ...MUTED_TEXT_STYLE, marginBottom: '12px' }}>
              Gere links com UTM e acompanhe cliques.
            </p>
            <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <input
                value={linkData.name}
                onChange={(e) => setLinkData({ ...linkData, name: e.target.value })}
                placeholder="Nome do link"
              />
              <input
                value={linkData.targetUrl}
                onChange={(e) => setLinkData({ ...linkData, targetUrl: e.target.value })}
                placeholder="URL destino (https://...)"
              />
              <input
                value={linkData.source}
                onChange={(e) => setLinkData({ ...linkData, source: e.target.value })}
                placeholder="utm_source"
              />
              <input
                value={linkData.campaign}
                onChange={(e) => setLinkData({ ...linkData, campaign: e.target.value })}
                placeholder="utm_campaign"
              />
              <input
                value={linkData.medium}
                onChange={(e) => setLinkData({ ...linkData, medium: e.target.value })}
                placeholder="utm_medium"
              />
              <input
                value={linkData.content}
                onChange={(e) => setLinkData({ ...linkData, content: e.target.value })}
                placeholder="utm_content"
              />
              <input
                value={linkData.term}
                onChange={(e) => setLinkData({ ...linkData, term: e.target.value })}
                placeholder="utm_term"
              />
              <input
                value={linkData.code}
                onChange={(e) => setLinkData({ ...linkData, code: e.target.value })}
                placeholder="Código (opcional)"
              />
            </div>
            <button onClick={handleCreateLink} disabled={loading} className="btn-primary px-4 py-2 text-sm" style={{ marginTop: '12px' }}>
              Criar link
            </button>

            <div style={{ marginTop: '16px', overflowX: 'auto' }}>
              <table style={TABLE_STYLE}>
                <thead>
                  <tr>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Nome</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Código</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Destino</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Cliques</th>
                    <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Short URL</th>
                  </tr>
                </thead>
                <tbody>
                  {(links || []).map((link) => {
                    const shortUrl = buildApiUrl(`/mkt/l/${encodeURIComponent(link.code)}`);
                    return (
                      <tr key={link.id}>
                        <td style={TABLE_CELL_STYLE}>{link.name}</td>
                        <td style={TABLE_CELL_STYLE}>{link.code}</td>
                        <td style={TABLE_CELL_STYLE}>{link.target_url || link.targetUrl}</td>
                        <td style={TABLE_CELL_STYLE}>{link.click_count ?? 0}</td>
                        <td style={TABLE_CELL_STYLE}>
                          <a href={shortUrl} target="_blank" rel="noreferrer">{shortUrl}</a>
                        </td>
                      </tr>
                    );
                  })}
                  {(!links || links.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ ...TABLE_CELL_STYLE, ...MUTED_TEXT_STYLE }}>Nenhum link cadastrado</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Funil de Leads</h2>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {Object.keys(leadStatsMap).length === 0 ? (
                <span style={MUTED_TEXT_STYLE}>Sem dados</span>
              ) : (
                Object.values(leadStatsMap).map((row) => (
                  <div key={row.stage || Math.random()} style={CARD_STYLE}>
                    <strong>{row.stage || 'unknown'}</strong>
                    <div>Leads: {row.count}</div>
                    <div>Score médio: {Number(row.avg_score || 0).toFixed(1)}</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Funil visual avançado</h2>
            {funnelRows.length === 0 ? (
              <span style={MUTED_TEXT_STYLE}>Sem dados para o funil.</span>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {funnelRows.map((row) => (
                  <div key={row.stage} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 220px', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '12px' }}>{row.stage}</div>
                    <div style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-default)', borderRadius: '999px', overflow: 'hidden', height: '18px' }}>
                      <div
                        style={{
                          width: `${row.widthPct}%`,
                          background: 'linear-gradient(90deg, var(--color-accent-primary) 0%, rgba(94, 106, 210, 0.45) 100%)',
                          height: '100%',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                      {row.count} lead(s)
                      {row.conversionRate != null && ` | ${row.conversionRate.toFixed(1)}% do estágio anterior`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Jornada por origem/campanha</h2>
            {journeyRows.length === 0 ? (
              <span style={MUTED_TEXT_STYLE}>Sem leads com metadados de jornada.</span>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={TABLE_STYLE}>
                  <thead>
                    <tr>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Origem</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Campanha</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Leads</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Score médio</th>
                      <th style={{ ...TABLE_CELL_STYLE, textAlign: 'left' }}>Conversão cliente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journeyRows.slice(0, 20).map((row) => (
                      <tr key={`${row.source}-${row.campaign}`}>
                        <td style={TABLE_CELL_STYLE}>{row.source}</td>
                        <td style={TABLE_CELL_STYLE}>{row.campaign}</td>
                        <td style={TABLE_CELL_STYLE}>{row.leads}</td>
                        <td style={TABLE_CELL_STYLE}>{row.avgScore.toFixed(1)}</td>
                        <td style={TABLE_CELL_STYLE}>{row.conversionToCustomer.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Alertas de jornada/campanha</h2>
            {journeyAlerts.length === 0 ? (
              <span style={MUTED_TEXT_STYLE}>Sem alertas críticos no momento.</span>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {journeyAlerts.map((alert, idx) => (
                  <div
                    key={`${alert.title}-${idx}`}
                    style={{
                      border: `1px solid ${alert.level === 'high' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
                      borderLeft: `4px solid ${alert.level === 'high' ? 'var(--color-status-error)' : 'var(--color-status-warning)'}`,
                      padding: '10px',
                      borderRadius: '6px',
                      background: 'var(--color-bg-primary)',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{alert.title}</div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{alert.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Forms</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input placeholder="slug" value={formData.slug} onChange={(e) => setFormData((s) => ({ ...s, slug: e.target.value }))} />
              <input placeholder="nome" value={formData.name} onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))} />
              <select value={formData.status} onChange={(e) => setFormData((s) => ({ ...s, status: e.target.value }))}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
              <button onClick={handleCreateForm} disabled={loading} className="btn-primary px-4 py-2 text-sm">Salvar</button>
            </div>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th align="left" style={TABLE_CELL_STYLE}>Slug</th>
                  <th align="left" style={TABLE_CELL_STYLE}>Nome</th>
                  <th align="left" style={TABLE_CELL_STYLE}>Status</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((f) => (
                  <tr key={f.id || f.slug}>
                    <td style={TABLE_CELL_STYLE}>{f.slug}</td>
                    <td style={TABLE_CELL_STYLE}>{f.name}</td>
                    <td style={TABLE_CELL_STYLE}>{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Leads</h2>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th align="left" style={TABLE_CELL_STYLE}>Nome</th>
                  <th align="left" style={TABLE_CELL_STYLE}>Email</th>
                  <th align="left" style={TABLE_CELL_STYLE}>Score</th>
                  <th align="left" style={TABLE_CELL_STYLE}>Stage</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td style={TABLE_CELL_STYLE}>{l.name || '-'}</td>
                    <td style={TABLE_CELL_STYLE}>{l.email || '-'}</td>
                    <td style={TABLE_CELL_STYLE}>{l.score}</td>
                    <td style={TABLE_CELL_STYLE}>{l.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Scoring Rules</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input placeholder="nome" value={ruleData.name} onChange={(e) => setRuleData((s) => ({ ...s, name: e.target.value }))} />
              <input placeholder="eventType" value={ruleData.eventType} onChange={(e) => setRuleData((s) => ({ ...s, eventType: e.target.value }))} />
              <input placeholder="delta" type="number" value={ruleData.delta} onChange={(e) => setRuleData((s) => ({ ...s, delta: e.target.value }))} />
              <button onClick={handleCreateRule} disabled={loading} className="btn-primary px-4 py-2 text-sm">Salvar</button>
            </div>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th align="left" style={TABLE_CELL_STYLE}>Nome</th>
                  <th align="left" style={TABLE_CELL_STYLE}>EventType</th>
                  <th align="left" style={TABLE_CELL_STYLE}>Delta</th>
                  <th align="left" style={TABLE_CELL_STYLE}>Enabled</th>
                </tr>
              </thead>
              <tbody>
                {scoringRules.map((r) => (
                  <tr key={r.id}>
                    <td style={TABLE_CELL_STYLE}>{r.name}</td>
                    <td style={TABLE_CELL_STYLE}>{r.event_type || r.eventType}</td>
                    <td style={TABLE_CELL_STYLE}>{r.delta}</td>
                    <td style={TABLE_CELL_STYLE}>{r.enabled ? 'sim' : 'nao'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={SURFACE_STYLE}>
            <h2 style={{ marginBottom: '8px' }}>Campanhas de Email</h2>
            <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
              <input placeholder="nome" value={campaignData.name} onChange={(e) => setCampaignData((s) => ({ ...s, name: e.target.value }))} />
              <input placeholder="assunto" value={campaignData.subject} onChange={(e) => setCampaignData((s) => ({ ...s, subject: e.target.value }))} />
              <textarea placeholder="corpo texto" rows={4} value={campaignData.bodyText} onChange={(e) => setCampaignData((s) => ({ ...s, bodyText: e.target.value }))} />
              <input placeholder="minScore (opcional)" type="number" value={campaignData.minScore} onChange={(e) => setCampaignData((s) => ({ ...s, minScore: e.target.value }))} />
              <button onClick={handleCreateCampaign} disabled={loading} className="btn-primary px-4 py-2 text-sm">Criar campanha (draft)</button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input placeholder="ID da campanha" value={sendCampaignId} onChange={(e) => setSendCampaignId(e.target.value)} />
              <button onClick={handleSendCampaign} disabled={loading} className="btn-default px-4 py-2 text-sm">Enviar</button>
            </div>
          </section>
        </div>
      </div>
    </CrudPageBase>
  );
}
