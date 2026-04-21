import React, { useEffect, useMemo, useState } from 'react';
import { listFitnessMemberships, chargeFitnessMembership } from '../api/verticalOperations';
import { useToast } from '../components/Toast';

function formatDate(value) {
  if (!value) return '-';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleString();
}

export function FitnessMembershipsPage() {
  const { showToast, ToastContainer } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [billingStatus, setBillingStatus] = useState('');

  async function loadData() {
    setLoading(true);
    try {
      const out = await listFitnessMemberships({ limit: 200, billingStatus: billingStatus || undefined });
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (_) {
      showToast('Erro ao carregar memberships', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function gerarCobranca(item) {
    try {
      await chargeFitnessMembership(item.id, {
        amount: Number(item.metadata?.monthlyAmount || item.metadata?.price || 99.9),
        dueDate: item.due_date || new Date(Date.now() + 24 * 3600000).toISOString(),
        cycle: 'MONTHLY',
        customerId: item.customer_id || null,
        subjectId: item.subject_id,
        customerPhone: item.metadata?.phone || null,
      });
      showToast('Cobranca gerada', 'success');
      await loadData();
    } catch (_) {
      showToast('Falha ao gerar cobranca', 'error');
    }
  }

  const summary = useMemo(() => ({
    total: items.length,
    blocked: items.filter((item) => item.effectiveBillingStatus === 'blocked').length,
    active: items.filter((item) => item.effectiveBillingStatus === 'active').length,
    delinquent: items.filter((item) => ['delinquent', 'grace_period'].includes(item.effectiveBillingStatus)).length,
  }), [items]);

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 20000);
    return () => clearInterval(timer);
  }, [billingStatus]);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Fitness Memberships</h1>
        <p className="text-sm text-text-secondary">Controle operacional de memberships, status de billing e disparo de cobranca.</p>
      </div>
      <div className="support-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <select
          className="support-input"
          data-testid="status-filter"
          aria-label="Status"
          value={billingStatus}
          onChange={(e) => setBillingStatus(e.target.value)}
        >
          <option value="">Todos os billing status</option>
          <option value="active">active</option>
          <option value="delinquent">delinquent</option>
          <option value="blocked">blocked</option>
          <option value="cancelled">cancelled</option>
        </select>
        <button
          className="support-button"
          data-testid="refresh-button"
          aria-label="Atualizar memberships"
          onClick={loadData}
          disabled={loading}
        >
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
      <div className="support-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        <div className="support-details-panel"><strong>Total</strong><div>{summary.total}</div></div>
        <div className="support-details-panel"><strong>Ativos</strong><div>{summary.active}</div></div>
        <div className="support-details-panel"><strong>Em risco</strong><div>{summary.delinquent}</div></div>
        <div className="support-details-panel"><strong>Bloqueados</strong><div>{summary.blocked}</div></div>
      </div>
      <div className="support-details-panel" style={{ marginTop: '1rem' }}>
        {!items.length ? <p className="text-sm text-text-secondary">Nenhuma membership encontrada.</p> : (
          <table className="support-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Aluno</th>
                <th>Billing</th>
                <th>Vencimento</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.subject_id}</td>
                  <td>{item.billing_status} / {item.effectiveBillingStatus}</td>
                  <td>{formatDate(item.due_date)}</td>
                  <td><button className="support-button" onClick={() => gerarCobranca(item)}>Gerar cobranca</button></td>
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
