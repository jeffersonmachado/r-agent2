import React, { useEffect, useState } from 'react';
import { listOrders, updateOrderStatus } from '../api/orders';

export function DispatchPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listOrders({ status: 'ready', limit: 50, offset: 0 });
      setOrders(res?.orders || []);
    } catch (e) {
      setError(e?.message || 'Erro ao listar pedidos prontos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const dispatch = async (orderId) => {
    try {
      await updateOrderStatus(orderId, 'dispatched');
      await load();
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao atualizar status');
    }
  };

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Expedição</h1>
        <div className="support-controls">
          <button onClick={load} disabled={loading}>Recarregar</button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      {error ? (
        <div style={{ padding: '0.75rem', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, margin: '0 1rem 1rem' }}>
          <strong>Erro:</strong> {error}
        </div>
      ) : null}

      <div style={{ padding: '0 1rem 1rem' }}>
        {loading ? <p>Carregando...</p> : null}
        {orders.map((o) => (
          <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{o.order_number}</strong>
                <div style={{ color: '#6b7280' }}>{o.status}</div>
              </div>
              <button onClick={() => dispatch(o.id)}>Despachar</button>
            </div>
          </div>
        ))}
        {!loading && orders.length === 0 ? <p style={{ color: '#6b7280' }}>Nenhum pedido pronto para expedição.</p> : null}
      </div>
    </div>
  );
}

