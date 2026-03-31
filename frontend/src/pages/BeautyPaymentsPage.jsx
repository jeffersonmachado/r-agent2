import React, { useEffect, useState } from 'react';
import { confirmBeautyPayment, listBeautyPayments } from '../api/beautyBusiness';
import { useToast } from '../components/Toast';

function formatDate(value) {
  if (!value) return '-';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleString();
}

export function BeautyPaymentsPage() {
  const { showToast, ToastContainer } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const out = await listBeautyPayments({ limit: 100 });
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (_) {
      showToast('Erro ao carregar cobrancas beauty', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function confirmPayment(item) {
    try {
      await confirmBeautyPayment({
        provider: item.provider || 'sandbox',
        id: item.external_transaction_id,
        status: 'CONFIRMED',
        payment: {
          id: item.external_transaction_id,
          status: 'CONFIRMED',
        },
      });
      showToast('Pagamento confirmado via sandbox/webhook', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao confirmar pagamento', 'error');
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Beauty Payments</h1>
        <p className="text-sm text-text-secondary">Acompanhamento de cobrancas, status e confirmacao controlada de pagamento.</p>
      </div>
      <div className="support-controls">
        <button className="support-button" onClick={loadData} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
      </div>
      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        {!items.length ? <p className="text-sm text-text-secondary">Nenhuma cobranca beauty encontrada.</p> : (
          <table className="support-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Cliente</th>
                <th>Status</th>
                <th>Valor</th>
                <th>Atualizado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div>{item.id}</div>
                    <div className="text-xs text-text-secondary">{item.external_transaction_id || '-'}</div>
                  </td>
                  <td>{item.customer_id || item.subject_id || '-'}</td>
                  <td>{item.status}</td>
                  <td>{item.amount}</td>
                  <td>{formatDate(item.updated_at || item.created_at)}</td>
                  <td><button className="support-button" onClick={() => confirmPayment(item)} disabled={item.status === 'confirmed'}>Confirmar</button></td>
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
