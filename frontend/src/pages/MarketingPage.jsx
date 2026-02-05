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
} from '../api/marketing';

export function MarketingPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [forms, setForms] = useState([]);
  const [leadStats, setLeadStats] = useState([]);
  const [leads, setLeads] = useState([]);
  const [scoringRules, setScoringRules] = useState([]);

  const [leadFilters, setLeadFilters] = useState({ stage: '', minScore: '' });
  const [formData, setFormData] = useState({ slug: '', name: '', status: 'active' });
  const [ruleData, setRuleData] = useState({ name: '', eventType: '', delta: 1 });
  const [campaignData, setCampaignData] = useState({ name: '', subject: '', bodyText: '', minScore: '' });
  const [sendCampaignId, setSendCampaignId] = useState('');

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
      <div style={{ padding: '24px' }}>
        <h1 style={{ fontSize: '22px', marginBottom: '12px' }}>Marketing v1</h1>
        <p style={{ color: '#6b7280', marginBottom: '20px' }}>
          Gestão básica de forms, leads, scoring e campanhas.
        </p>

        <div style={{ display: 'grid', gap: '16px' }}>
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
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <input placeholder="stage" value={leadFilters.stage} onChange={(e) => setLeadFilters((s) => ({ ...s, stage: e.target.value }))} />
              <input placeholder="minScore" type="number" value={leadFilters.minScore} onChange={(e) => setLeadFilters((s) => ({ ...s, minScore: e.target.value }))} />
              <button onClick={handleFilterLeads} disabled={loading}>Filtrar</button>
            </div>
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
