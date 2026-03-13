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
} from '../api/marketing';
import { buildApiUrl } from '../api/client';
import { Button } from '../styles/Button';

const STAGE_ORDER = ['visitor', 'lead', 'mql', 'sql', 'customer'];

function toSafeString(value) {
  return value == null ? '' : String(value).trim();
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
      const linksResp = await listMarketingLinks();
      setLinks(linksResp?.items || []);
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

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="support-page">
      <ToastContainer />
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>🧲 Marketing v1</h1>
        </div>
        <div className="support-controls">
          <Button onClick={loadAll} style={{ backgroundColor: '#6366f1', color: 'white' }}>
            🔄 Atualizar
          </Button>
        </div>
      </div>

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
        <p style={{ color: '#6b7280', marginBottom: '20px' }}>
          Gestão de forms, leads, scoring, campanhas e jornada/funil operacional.
        </p>

        <div style={{ display: 'grid', gap: '16px' }}>
          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Links rastreáveis</h2>
            <p style={{ color: '#6b7280', marginBottom: '12px' }}>
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
            <button onClick={handleCreateLink} disabled={loading} style={{ marginTop: '12px' }}>
              Criar link
            </button>

            <div style={{ marginTop: '16px', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Nome</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Código</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Destino</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Cliques</th>
                    <th style={{ textAlign: 'left', padding: '6px' }}>Short URL</th>
                  </tr>
                </thead>
                <tbody>
                  {(links || []).map((link) => {
                    const shortUrl = buildApiUrl(`/mkt/l/${encodeURIComponent(link.code)}`);
                    return (
                      <tr key={link.id}>
                        <td style={{ padding: '6px' }}>{link.name}</td>
                        <td style={{ padding: '6px' }}>{link.code}</td>
                        <td style={{ padding: '6px' }}>{link.target_url || link.targetUrl}</td>
                        <td style={{ padding: '6px' }}>{link.click_count ?? 0}</td>
                        <td style={{ padding: '6px' }}>
                          <a href={shortUrl} target="_blank" rel="noreferrer">{shortUrl}</a>
                        </td>
                      </tr>
                    );
                  })}
                  {(!links || links.length === 0) && (
                    <tr>
                      <td colSpan={5} style={{ padding: '6px', color: '#6b7280' }}>Nenhum link cadastrado</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Funil de Leads</h2>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {Object.keys(leadStatsMap).length === 0 ? (
                <span style={{ color: '#6b7280' }}>Sem dados</span>
              ) : (
                Object.values(leadStatsMap).map((row) => (
                  <div key={row.stage || Math.random()} style={{ padding: '8px 12px', border: '1px solid #eee', borderRadius: '6px' }}>
                    <strong>{row.stage || 'unknown'}</strong>
                    <div>Leads: {row.count}</div>
                    <div>Score médio: {Number(row.avg_score || 0).toFixed(1)}</div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Funil visual avançado</h2>
            {funnelRows.length === 0 ? (
              <span style={{ color: '#6b7280' }}>Sem dados para o funil.</span>
            ) : (
              <div style={{ display: 'grid', gap: '10px' }}>
                {funnelRows.map((row) => (
                  <div key={row.stage} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 220px', gap: '10px', alignItems: 'center' }}>
                    <div style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '12px' }}>{row.stage}</div>
                    <div style={{ background: '#f3f4f6', borderRadius: '999px', overflow: 'hidden', height: '18px' }}>
                      <div
                        style={{
                          width: `${row.widthPct}%`,
                          background: 'linear-gradient(90deg, #3b82f6 0%, #06b6d4 100%)',
                          height: '100%',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: '12px', color: '#374151' }}>
                      {row.count} lead(s)
                      {row.conversionRate != null && ` | ${row.conversionRate.toFixed(1)}% do estágio anterior`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Jornada por origem/campanha</h2>
            {journeyRows.length === 0 ? (
              <span style={{ color: '#6b7280' }}>Sem leads com metadados de jornada.</span>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px' }}>Origem</th>
                      <th style={{ textAlign: 'left', padding: '6px' }}>Campanha</th>
                      <th style={{ textAlign: 'left', padding: '6px' }}>Leads</th>
                      <th style={{ textAlign: 'left', padding: '6px' }}>Score médio</th>
                      <th style={{ textAlign: 'left', padding: '6px' }}>Conversão cliente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journeyRows.slice(0, 20).map((row) => (
                      <tr key={`${row.source}-${row.campaign}`}>
                        <td style={{ padding: '6px' }}>{row.source}</td>
                        <td style={{ padding: '6px' }}>{row.campaign}</td>
                        <td style={{ padding: '6px' }}>{row.leads}</td>
                        <td style={{ padding: '6px' }}>{row.avgScore.toFixed(1)}</td>
                        <td style={{ padding: '6px' }}>{row.conversionToCustomer.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Alertas de jornada/campanha</h2>
            {journeyAlerts.length === 0 ? (
              <span style={{ color: '#6b7280' }}>Sem alertas críticos no momento.</span>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {journeyAlerts.map((alert, idx) => (
                  <div
                    key={`${alert.title}-${idx}`}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderLeft: `4px solid ${alert.level === 'high' ? '#ef4444' : '#f59e0b'}`,
                      padding: '10px',
                      borderRadius: '6px',
                      background: '#fafafa',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{alert.title}</div>
                    <div style={{ fontSize: '12px', color: '#4b5563' }}>{alert.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Forms</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input placeholder="slug" value={formData.slug} onChange={(e) => setFormData((s) => ({ ...s, slug: e.target.value }))} />
              <input placeholder="nome" value={formData.name} onChange={(e) => setFormData((s) => ({ ...s, name: e.target.value }))} />
              <select value={formData.status} onChange={(e) => setFormData((s) => ({ ...s, status: e.target.value }))}>
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
              <button onClick={handleCreateForm} disabled={loading}>Salvar</button>
            </div>
            <table style={{ width: '100%', fontSize: '13px' }}>
              <thead>
                <tr>
                  <th align="left">Slug</th>
                  <th align="left">Nome</th>
                  <th align="left">Status</th>
                </tr>
              </thead>
              <tbody>
                {forms.map((f) => (
                  <tr key={f.id || f.slug}>
                    <td>{f.slug}</td>
                    <td>{f.name}</td>
                    <td>{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Leads</h2>
            <table style={{ width: '100%', fontSize: '13px' }}>
              <thead>
                <tr>
                  <th align="left">Nome</th>
                  <th align="left">Email</th>
                  <th align="left">Score</th>
                  <th align="left">Stage</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>{l.name || '-'}</td>
                    <td>{l.email || '-'}</td>
                    <td>{l.score}</td>
                    <td>{l.stage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Scoring Rules</h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input placeholder="nome" value={ruleData.name} onChange={(e) => setRuleData((s) => ({ ...s, name: e.target.value }))} />
              <input placeholder="eventType" value={ruleData.eventType} onChange={(e) => setRuleData((s) => ({ ...s, eventType: e.target.value }))} />
              <input placeholder="delta" type="number" value={ruleData.delta} onChange={(e) => setRuleData((s) => ({ ...s, delta: e.target.value }))} />
              <button onClick={handleCreateRule} disabled={loading}>Salvar</button>
            </div>
            <table style={{ width: '100%', fontSize: '13px' }}>
              <thead>
                <tr>
                  <th align="left">Nome</th>
                  <th align="left">EventType</th>
                  <th align="left">Delta</th>
                  <th align="left">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {scoringRules.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.event_type || r.eventType}</td>
                    <td>{r.delta}</td>
                    <td>{r.enabled ? 'sim' : 'nao'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section style={{ background: '#fff', padding: '16px', borderRadius: '8px' }}>
            <h2 style={{ marginBottom: '8px' }}>Campanhas de Email</h2>
            <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
              <input placeholder="nome" value={campaignData.name} onChange={(e) => setCampaignData((s) => ({ ...s, name: e.target.value }))} />
              <input placeholder="assunto" value={campaignData.subject} onChange={(e) => setCampaignData((s) => ({ ...s, subject: e.target.value }))} />
              <textarea placeholder="corpo texto" rows={4} value={campaignData.bodyText} onChange={(e) => setCampaignData((s) => ({ ...s, bodyText: e.target.value }))} />
              <input placeholder="minScore (opcional)" type="number" value={campaignData.minScore} onChange={(e) => setCampaignData((s) => ({ ...s, minScore: e.target.value }))} />
              <button onClick={handleCreateCampaign} disabled={loading}>Criar campanha (draft)</button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <input placeholder="ID da campanha" value={sendCampaignId} onChange={(e) => setSendCampaignId(e.target.value)} />
              <button onClick={handleSendCampaign} disabled={loading}>Enviar</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
