import React, { useEffect, useMemo, useState } from 'react';
import { getPanelState } from '../api/physicalQueuePublic';

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

export function PanelPage() {
  const token = useMemo(() => getQueryParam('token') || '', []);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);

  const load = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    try {
      const res = await getPanelState(token);
      setState(res);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao carregar painel');
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastCalled = state?.lastCalled || null;
  const waiting = state?.waiting || [];

  return (
    <div style={{ minHeight: '100vh', padding: '2rem' }}>
      <h1 style={{ fontSize: 42, marginBottom: 8 }}>Painel de Chamada</h1>
      {error ? <p style={{ color: '#ef4444' }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem' }}>
          <div style={{ color: '#6b7280' }}>Chamando agora</div>
          <div style={{ fontSize: 96, fontWeight: 800 }}>
            {lastCalled ? lastCalled.ticket_number : '—'}
          </div>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem' }}>
          <div style={{ color: '#6b7280', marginBottom: 8 }}>Aguardando</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {waiting.slice(0, 16).map((t) => (
              <div key={t.id} style={{ padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: 18 }}>
                {t.ticket_number}
              </div>
            ))}
            {waiting.length === 0 ? <div style={{ color: '#6b7280' }}>Sem fila no momento.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

