import React, { useMemo, useState } from 'react';
import { createStorefrontOrder } from '../api/storefront';
import { useRouter } from '../hooks/useRouter';

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

export function StorefrontOrderPage() {
  const { navigate } = useRouter();
  const token = useMemo(() => getQueryParam('token') || '', []);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [itemsText, setItemsText] = useState('1x Pizza Margherita\n1x Refrigerante');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const parseItems = () => {
    const lines = String(itemsText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    return lines.map((line) => {
      const m = line.match(/^(\d+)\s*x\s*(.+)$/i);
      if (m) return { qty: Number(m[1]), name: m[2].trim() };
      return { qty: 1, name: line };
    });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('Token ausente na URL. Ex.: /storefront/order?token=...');
      return;
    }
    const items = parseItems();
    if (items.length === 0) {
      setError('Informe pelo menos um item.');
      return;
    }
    setLoading(true);
    try {
      const result = await createStorefrontOrder(token, {
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        deliveryType: 'delivery',
        deliveryAddress: { address: address.trim() || null },
        items,
        notes: notes.trim() || null,
      });
      const orderId = result?.order?.id;
      if (orderId) {
        navigate(`/storefront/order/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`);
        return;
      }
      setError('Pedido criado, mas não foi possível obter o ID.');
    } catch (err) {
      const msg =
        err?.body?.message ||
        err?.body?.error ||
        err?.message ||
        'Erro ao criar pedido';
      setError(String(msg));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '2rem' }}>
      <h1 style={{ marginBottom: '0.25rem' }}>Fazer pedido</h1>
      <p style={{ marginTop: 0, color: '#6b7280' }}>
        Storefront v1 (token via URL).
      </p>

      {error ? (
        <div style={{ background: '#fee2e2', border: '1px solid #fecaca', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem' }}>
          <strong>Erro:</strong> {error}
        </div>
      ) : null}

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem' }}>
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <label>Nome (opcional)</label>
          <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Seu nome" />
        </div>

        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <label>Telefone/WhatsApp (opcional)</label>
          <input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+5511999999999" />
        </div>

        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <label>Endereço (opcional)</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número, bairro" />
        </div>

        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <label>Itens (um por linha, ex.: 2x Pizza)</label>
          <textarea
            rows={6}
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
          />
        </div>

        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <label>Observações (opcional)</label>
          <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: '0.75rem 1rem',
            background: '#111827',
            color: 'white',
            borderRadius: 10,
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? 'Enviando...' : 'Criar pedido'}
        </button>
      </form>
    </div>
  );
}

