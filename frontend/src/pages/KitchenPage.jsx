import React, { useEffect, useState } from 'react';
import { listOrders, updateOrderStatus } from '../api/orders';

export function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listOrders({ status: 'confirmed', limit: 50, offset: 0 });
      setOrders(res?.orders || []);
    } catch (e) {
      setError(e?.message || 'Erro ao listar pedidos da cozinha');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const startPreparing = async (orderId) => {
    try {
      await updateOrderStatus(orderId, 'preparing');
      await load();
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao atualizar status');
    }
  };

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Cozinha</h1>
        <div className="support-controls">
          <button onClick={load} disabled={loading}>Recarregar</button>
        </div>
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
              <button onClick={() => startPreparing(o.id)}>Iniciar preparo</button>
            </div>
          </div>
        ))}
        {!loading && orders.length === 0 ? <p style={{ color: '#6b7280' }}>Nenhum pedido aguardando preparo.</p> : null}
      </div>
    </div>
  );
}

