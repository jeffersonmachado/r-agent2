import React, { useEffect, useState } from 'react';
import { listOrders, updateOrderStatus } from '../api/orders';

const NEXT_STATUS = {
  created: 'confirmed',
  confirmed: 'preparing',
  preparing: 'ready',
  ready: 'dispatched',
  dispatched: 'delivered',
};

export function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await listOrders({ status: statusFilter || undefined, limit: 50, offset: 0 });
      setOrders(res?.orders || []);
    } catch (e) {
      setError(e?.message || 'Erro ao listar pedidos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const advance = async (order) => {
    const next = NEXT_STATUS[order.status];
    if (!next) return;
    try {
      await updateOrderStatus(order.id, next);
      await load();
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao atualizar status');
    }
  };

  return (
    <div className="support-page">
      <div className="support-header">
        <h1>Pedidos</h1>
        <div className="support-controls" style={{ display: 'flex', gap: '0.5rem' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos</option>
            <option value="created">created</option>
            <option value="confirmed">confirmed</option>
            <option value="preparing">preparing</option>
            <option value="ready">ready</option>
            <option value="dispatched">dispatched</option>
            <option value="delivered">delivered</option>
            <option value="cancelled">cancelled</option>
          </select>
          <button onClick={load} disabled={loading}>Recarregar</button>
        </div>
      </div>

      {error ? (
        <div style={{ padding: '0.75rem', background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, margin: '0 1rem 1rem' }}>
          <strong>Erro:</strong> {error}
        </div>
      ) : null}

      <div style={{ padding: '0 1rem 1rem' }}>
        {loading ? (
          <p>Carregando...</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {orders.map((o) => (
              <div key={o.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <div>
                    <div><strong>{o.order_number}</strong></div>
                    <div style={{ color: '#6b7280' }}>{o.status}</div>
                  </div>
                  <button onClick={() => advance(o)} disabled={!NEXT_STATUS[o.status]}>
                    Avançar
                  </button>
                </div>
                <div style={{ marginTop: '0.5rem', color: '#374151' }}>
                  {(o.items || []).slice(0, 3).map((it, idx) => (
                    <div key={idx}>{it.qty}x {it.name}</div>
                  ))}
                  {(o.items || []).length > 3 ? <div style={{ color: '#6b7280' }}>+ {(o.items || []).length - 3} item(ns)</div> : null}
                </div>
              </div>
            ))}
            {orders.length === 0 ? <p style={{ color: '#6b7280' }}>Nenhum pedido.</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}

