import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getStorefrontOrder } from '../api/storefront';

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

function getOrderIdFromPath() {
  const raw = window.location.pathname || '';
  const m = raw.match(/\/storefront\/order\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function StorefrontOrderStatusPage() {
  const token = useMemo(() => getQueryParam('token') || '', []);
  const orderId = useMemo(() => getOrderIdFromPath(), []);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const inFlightRef = useRef(false);

  const load = async () => {
    // Guarda de overlap: não dispara novo fetch se o anterior não terminou
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      inFlightRef.current = false;
      return;
    }
    if (!orderId) {
      setError('orderId ausente na URL.');
      inFlightRef.current = false;
      return;
    }
    try {
      const result = await getStorefrontOrder(token, orderId);
      setData(result);
    } catch (err) {
      const msg =
        err?.body?.message ||
        err?.body?.error ||
        err?.message ||
        'Erro ao carregar pedido';
      setError(String(msg));
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const order = data?.order || null;
  const delivery = data?.delivery || null;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Status do pedido</h1>
      <p style={{ marginTop: 0, color: '#6b7280' }}>
        Atualiza automaticamente a cada 15s.
      </p>

      {error ? (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem' }}>
          <strong>Erro:</strong> {error}
        </div>
      ) : null}

      {order ? (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: '1rem' }}>
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <div><strong>Pedido:</strong> {order.order_number}</div>
            <div><strong>Status:</strong> {order.status}</div>
            {delivery ? <div><strong>Entrega:</strong> {delivery.status}</div> : null}
          </div>
          <hr style={{ margin: '1rem 0' }} />
          <div>
            <strong>Itens</strong>
            <ul>
              {(order.items || []).map((it, idx) => (
                <li key={idx}>
                  {it.qty}x {it.name}{it.notes ? ` (${it.notes})` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div style={{ color: '#6b7280' }}>Carregando...</div>
      )}
    </div>
  );
}

