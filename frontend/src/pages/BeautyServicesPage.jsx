import React, { useEffect, useState } from 'react';
import { listBeautyServices } from '../api/beautyBusiness';
import { useToast } from '../components/Toast';

export function BeautyServicesPage() {
  const { showToast, ToastContainer } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const out = await listBeautyServices();
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (_) {
      showToast('Erro ao carregar servicos beauty', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Servicos de Beleza</h1>
        <p className="text-sm text-text-secondary">Catálogo operacional de serviços usados em campanhas, agenda e cobrança.</p>
      </div>
      <div className="support-controls">
        <button className="support-button" onClick={loadData} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
      </div>
      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        {!items.length ? <p className="text-sm text-text-secondary">Nenhum serviço cadastrado.</p> : (
          <table className="support-table">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Servico</th>
                <th>Duracao</th>
                <th>Preco</th>
                <th>Promocional</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.code}>
                  <td>{item.code}</td>
                  <td>{item.name}</td>
                  <td>{item.durationMinutes} min</td>
                  <td>{item.price}</td>
                  <td>{item.promotionalPrice ?? '-'}</td>
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
