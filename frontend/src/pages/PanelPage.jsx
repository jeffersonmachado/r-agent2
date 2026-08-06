import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    try {
      const res = await getPanelState(token);
      setState(res);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao carregar painel');
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastCalled = state?.lastCalled || null;
  const waiting = state?.waiting || [];

  return (
    <div className="min-h-screen bg-bg-primary p-8 text-text-primary">
      <h1 className="mb-2 text-[42px] font-bold">Painel de Chamada</h1>
      {error ? <p className="text-status-error">{error}</p> : null}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="text-text-secondary">Chamando agora</div>
          <div className="text-[96px] font-extrabold">
            {lastCalled ? lastCalled.ticket_number : '—'}
          </div>
        </div>

        <div className="rounded-xl border border-border-default bg-bg-elevated p-4">
          <div className="mb-2 text-text-secondary">Aguardando</div>
          <div className="flex flex-wrap gap-2">
            {waiting.slice(0, 16).map((t) => (
              <div key={t.id} className="rounded-[10px] border border-border-default bg-bg-primary px-3 py-2 text-lg">
                {t.ticket_number}
              </div>
            ))}
            {waiting.length === 0 ? <div className="text-text-secondary">Sem fila no momento.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
