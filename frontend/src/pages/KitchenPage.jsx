import React, { useEffect, useState } from 'react';
import { listOrders, updateOrderStatus } from '../api/orders';
import { useToast } from '../components/Toast';
import { CrudPageBase } from '../modules/crud-base';

export function KitchenPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const { showToast, ToastContainer } = useToast();

  const load = async () => {
    setLoading(true);
    try {
      const res = await listOrders({ status: 'confirmed', limit: 50, offset: 0 });
      setOrders(res?.orders || []);
    } catch (e) {
      showToast(e?.message || 'Erro ao listar pedidos da cozinha', 'error');
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
      showToast('Pedido movido para preparo.', 'success');
      await load();
    } catch (e) {
      showToast(e?.body?.message || e?.message || 'Erro ao atualizar status', 'error');
    }
  };

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>Cozinha</h1>
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

      <div style={{ padding: '0 1rem 1rem' }}>
        {loading ? <p>Carregando...</p> : null}
        {orders.map((o) => (
          <div key={o.id} style={{ border: '1px solid var(--color-border-default)', borderRadius: 10, padding: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>{o.order_number}</strong>
                <div style={{ color: 'var(--color-text-secondary)' }}>{o.status}</div>
              </div>
              <button onClick={() => startPreparing(o.id)}>Iniciar preparo</button>
            </div>
          </div>
        ))}
        {!loading && orders.length === 0 ? <p style={{ color: 'var(--color-text-secondary)' }}>Nenhum pedido aguardando preparo.</p> : null}
      </div>
      <ToastContainer />
    </CrudPageBase>
  );
}

