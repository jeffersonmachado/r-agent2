import React, { useEffect, useState } from 'react';
import { createBeautyCampaign, listBeautyCampaigns, sendBeautyCampaign } from '../api/beautyBusiness';
import { useToast } from '../components/Toast';

export function BeautyCampaignsPage() {
  const { showToast, ToastContainer } = useToast();
  const [items, setItems] = useState([]);
  const [name, setName] = useState('Promo Unhas QA');
  const [subject, setSubject] = useState('Promoção de unhas da semana');
  const [bodyText, setBodyText] = useState('Agende sua promoção de unhas com preço especial.');
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const out = await listBeautyCampaigns({ limit: 100 });
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (_) {
      showToast('Erro ao carregar campanhas beauty', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function createCampaign() {
    try {
      await createBeautyCampaign({ name, subject, bodyText, minScore: 0 });
      showToast('Campanha criada', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao criar campanha', 'error');
    }
  }

  async function publishCampaign(item) {
    try {
      await sendBeautyCampaign(item.id);
      showToast('Campanha publicada/simulada', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao publicar campanha', 'error');
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Beauty Campaigns</h1>
        <p className="text-sm text-text-secondary">Campanhas da vertical beauty com criação rápida e publicação controlada.</p>
      </div>

      <div className="support-controls" style={{ display: 'grid', gap: '0.5rem', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <input className="support-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da campanha" />
        <input className="support-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Assunto" />
        <input className="support-input" value={bodyText} onChange={(e) => setBodyText(e.target.value)} placeholder="Texto da oferta" />
        <button className="support-button" onClick={createCampaign}>Criar campanha</button>
      </div>

      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        <button className="support-button" onClick={loadData} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
        {!items.length ? <p className="text-sm text-text-secondary" style={{ marginTop: '0.75rem' }}>Nenhuma campanha cadastrada.</p> : (
          <table className="support-table" style={{ marginTop: '0.75rem' }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Campanha</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>
                    <div>{item.name}</div>
                    <div className="text-xs text-text-secondary">{item.subject}</div>
                  </td>
                  <td>{item.status}</td>
                  <td><button className="support-button" onClick={() => publishCampaign(item)}>Publicar</button></td>
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
