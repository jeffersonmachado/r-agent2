import React, { useEffect, useMemo, useState } from 'react';
import { createPhysicalTicket, resolvePublicToken } from '../api/physicalQueuePublic';

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

export function KioskPage() {
  const token = useMemo(() => getQueryParam('token') || '', []);
  const [priority, setPriority] = useState(0);
  const [biometricMode, setBiometricMode] = useState(null);
  const [customerIdInput, setCustomerIdInput] = useState('');
  const [lastTicket, setLastTicket] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      if (!token) return;
      try {
        const res = await resolvePublicToken(token);
        const meta = res?.token?.meta || {};
        const mode = meta?.biometricMode ? String(meta.biometricMode) : null;
        setBiometricMode(mode);
      } catch (e) {
        // best-effort: totem pode operar sem meta
        setBiometricMode(null);
      }
    })();
  }, [token]);

  async function callBioBridge(path, payload) {
    const url = `http://127.0.0.1:17923${path}`;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail || data?.message || `HTTP ${res.status}`;
        const err = new Error(String(msg));
        // @ts-ignore
        err.status = res.status;
        // @ts-ignore
        err.body = data;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(id);
    }
  }

  const takeTicket = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    setLoading(true);
    try {
      const mode = biometricMode;
      let biometricRef = null;

      if (mode === 'verify-1to1') {
        if (!customerIdInput.trim()) {
          setError('Informe CPF/telefone para validar com biometria.');
          return;
        }
        const resolved = await resolvePublicToken(token);
        const tokenId = resolved?.token?.id;
        const locationId = resolved?.token?.locationId || null;
        const bio = await callBioBridge('/verify', {
          tokenId,
          locationId,
          mode: 'verify-1to1',
          customerIdInput: customerIdInput.trim(),
        });
        biometricRef = bio?.biometricRef || null;
      } else if (mode === 'dedupe-only' || mode === 'identify-1n') {
        const resolved = await resolvePublicToken(token);
        const tokenId = resolved?.token?.id;
        const locationId = resolved?.token?.locationId || null;
        const bio = await callBioBridge('/scan', {
          tokenId,
          locationId,
          mode: mode,
        });
        biometricRef = bio?.biometricRef || null;
      }

      const payload = {
        priority,
        biometricMode: mode,
        biometricRef,
        customerIdInput: customerIdInput.trim() || null,
      };

      const res = await createPhysicalTicket(token, payload);
      setLastTicket(res?.ticket || null);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao gerar senha');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Totem</h1>
        <p style={{ marginTop: 0, color: '#6b7280' }}>
          Filas físicas v1 (token via URL){biometricMode ? ` • biometria: ${biometricMode}` : ''}.
        </p>

        {error ? (
          <div style={{ background: '#fee2e2', border: '1px solid #fecaca', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem' }}>
            <strong>Erro:</strong> {error}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {biometricMode === 'verify-1to1' ? (
            <label>
              CPF/Telefone
              <input
                value={customerIdInput}
                onChange={(e) => setCustomerIdInput(e.target.value)}
                placeholder="Ex: 11999999999"
                style={{ width: '100%', padding: '0.75rem', borderRadius: 10, border: '1px solid #e5e7eb', marginTop: 6 }}
              />
            </label>
          ) : null}

          <label>
            Prioridade (0 padrão)
            <input
              type="number"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              style={{ width: '100%', padding: '0.75rem', borderRadius: 10, border: '1px solid #e5e7eb', marginTop: 6 }}
            />
          </label>

          <button
            onClick={takeTicket}
            disabled={loading}
            style={{
              padding: '1rem',
              borderRadius: 12,
              border: 'none',
              background: '#111827',
              color: 'white',
              fontSize: 18,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Gerando...' : (biometricMode ? 'Validar e gerar senha' : 'Gerar senha')}
          </button>

          {lastTicket ? (
            <div style={{ textAlign: 'center', padding: '1rem', border: '1px solid #e5e7eb', borderRadius: 12 }}>
              <div style={{ color: '#6b7280' }}>Sua senha</div>
              <div style={{ fontSize: 64, fontWeight: 700 }}>{lastTicket.ticket_number}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

