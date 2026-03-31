import React, { useEffect, useState } from 'react';
import { convertBeautyLead, createBeautyLead, listBeautyCampaigns, listBeautyLeads, updateBeautyLead } from '../api/beautyBusiness';
import { useToast } from '../components/Toast';

function campaignNameById(items, campaignId) {
  const match = (items || []).find((item) => item.id === campaignId);
  return match?.name || campaignId || '-';
}

export function BeautyLeadsPage() {
  const { showToast, ToastContainer } = useToast();
  const [items, setItems] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('Lead QA Beauty');
  const [email, setEmail] = useState('lead-beauty-qa@example.com');
  const [phone, setPhone] = useState('+5511999990001');
  const [campaignId, setCampaignId] = useState('');

  async function loadData() {
    setLoading(true);
    try {
      const [leadsRes, campaignsRes] = await Promise.all([
        listBeautyLeads({ limit: 100 }),
        listBeautyCampaigns({ limit: 100 }),
      ]);
      const nextCampaigns = Array.isArray(campaignsRes?.items) ? campaignsRes.items : [];
      const nextItems = Array.isArray(leadsRes?.items) ? leadsRes.items : [];
      setCampaigns(nextCampaigns);
      setItems(nextItems);
      if (!campaignId && nextCampaigns[0]?.id) {
        setCampaignId(nextCampaigns[0].id);
      }
    } catch (_) {
      showToast('Erro ao carregar leads beauty', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function createLead() {
    try {
      await createBeautyLead({
        name,
        email,
        phone,
        externalId: email,
        attributesPatch: { campaignId: campaignId || null, source: 'beauty_leads_page' },
      });
      showToast('Lead criado/atualizado', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao criar lead', 'error');
    }
  }

  async function moveToQualified(item) {
    try {
      await updateBeautyLead(item.id, {
        stage: 'qualified',
        attributesPatch: { qualifiedBy: 'beauty_leads_page' },
      });
      showToast('Lead qualificado', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao qualificar lead', 'error');
    }
  }

  async function convertLead(item) {
    try {
      await convertBeautyLead({
        leadId: item.id,
        customerId: item.external_id || item.externalId || `beauty-customer-${item.id}`,
        customerName: item.name,
        campaignId: item.attributes?.campaignId || campaignId || null,
        metadata: { source: 'beauty_leads_page' },
      });
      showToast('Lead convertido em cliente', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao converter lead', 'error');
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const filteredItems = items.filter((item) => {
    if (!query.trim()) return true;
    const haystack = [
      item.id,
      item.name,
      item.email,
      item.phone,
      item.stage,
      item.external_id,
    ].join(' ').toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Beauty Leads</h1>
        <p className="text-sm text-text-secondary">Captação, qualificação e conversão operacional de leads da vertical beauty.</p>
      </div>

      <div className="support-controls" style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <input className="support-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do lead" />
        <input className="support-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
        <input className="support-input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Telefone" />
        <select className="support-input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">Sem campanha</option>
          {campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button className="support-button" onClick={createLead}>Criar lead</button>
      </div>

      <div className="support-controls" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
        <input className="support-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filtrar por nome, email, telefone ou etapa" />
        <button className="support-button" onClick={loadData} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
      </div>

      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        {!filteredItems.length ? <p className="text-sm text-text-secondary">Nenhum lead encontrado.</p> : (
          <table className="support-table">
            <thead>
              <tr>
                <th>Lead</th>
                <th>Etapa</th>
                <th>Campanha</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div>{item.name || item.id}</div>
                    <div className="text-xs text-text-secondary">{item.email || item.phone || '-'}</div>
                  </td>
                  <td>{item.stage || 'lead'}</td>
                  <td>{campaignNameById(campaigns, item.attributes?.campaignId)}</td>
                  <td style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button className="support-button" onClick={() => moveToQualified(item)}>Qualificar</button>
                    <button className="support-button" onClick={() => convertLead(item)}>Converter</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <ToastContainer />
    </div>
  );
}
