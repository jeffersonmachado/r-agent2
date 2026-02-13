import React, { useMemo, useState } from 'react';
import {
  abandonPhysicalTicket,
  callNext,
  finishPhysicalTicket,
  pausePhysicalService,
  resumePhysicalService,
  skipPhysicalTicket,
  startPhysicalService,
  transferPhysicalTicket,
} from '../api/physicalQueuePublic';

function getQueryParam(name) {
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

export function StationPage() {
  const token = useMemo(() => getQueryParam('token') || '', []);
  const [stationId, setStationId] = useState('A1');
  const [transferToQueueId, setTransferToQueueId] = useState('');
  const [current, setCurrent] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const onCallNext = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    setLoading(true);
    try {
      const res = await callNext(token, { stationId });
      setCurrent(res?.ticket || null);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao chamar próximo');
    } finally {
      setLoading(false);
    }
  };

  const onFinish = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    if (!current?.id) return;
    setLoading(true);
    try {
      await finishPhysicalTicket(token, { ticketId: current.id });
      setCurrent(null);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao finalizar');
    } finally {
      setLoading(false);
    }
  };

  const onStart = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    if (!current?.id) return;
    setLoading(true);
    try {
      const res = await startPhysicalService(token, { ticketId: current.id, stationId });
      setCurrent(res?.ticket || current);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao iniciar atendimento');
    } finally {
      setLoading(false);
    }
  };

  const onSkip = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    if (!current?.id) return;
    setLoading(true);
    try {
      await skipPhysicalTicket(token, { ticketId: current.id, stationId, reason: 'skip' });
      setCurrent(null);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao pular');
    } finally {
      setLoading(false);
    }
  };

  const onPause = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    if (!current?.id) return;
    setLoading(true);
    try {
      const res = await pausePhysicalService(token, { ticketId: current.id, stationId, reason: 'pause' });
      setCurrent(res?.ticket || current);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao pausar');
    } finally {
      setLoading(false);
    }
  };

  const onResume = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    if (!current?.id) return;
    setLoading(true);
    try {
      const res = await resumePhysicalService(token, { ticketId: current.id, stationId });
      setCurrent(res?.ticket || current);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao retomar');
    } finally {
      setLoading(false);
    }
  };

  const onTransfer = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    if (!current?.id) return;
    if (!transferToQueueId.trim()) {
      setError('Informe o ID da fila de destino.');
      return;
    }
    setLoading(true);
    try {
      await transferPhysicalTicket(token, { ticketId: current.id, toQueueId: transferToQueueId.trim() });
      setCurrent(null);
      setTransferToQueueId('');
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao transferir');
    } finally {
      setLoading(false);
    }
  };

  const onAbandon = async () => {
    setError(null);
    if (!token) {
      setError('Token ausente na URL.');
      return;
    }
    if (!current?.id) return;
    setLoading(true);
    try {
      await abandonPhysicalTicket(token, { ticketId: current.id, stationId, reason: 'no_show' });
      setCurrent(null);
    } catch (e) {
      setError(e?.body?.message || e?.message || 'Erro ao abandonar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: 520 }}>
        <h1 style={{ fontSize: 32, marginBottom: 8 }}>Estação</h1>
        <p style={{ marginTop: 0, color: '#6b7280' }}>Chamar próximo e finalizar (token via URL).</p>

        {error ? (
          <div style={{ background: '#fee2e2', border: '1px solid #fecaca', padding: '0.75rem', borderRadius: 8, marginBottom: '1rem' }}>
            <strong>Erro:</strong> {error}
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <label>
            Estação/Guichê
            <input
              value={stationId}
              onChange={(e) => setStationId(e.target.value)}
              style={{ width: '100%', padding: '0.75rem', borderRadius: 10, border: '1px solid #e5e7eb', marginTop: 6 }}
            />
          </label>

          <button
            onClick={onCallNext}
            disabled={loading}
            style={{ padding: '0.75rem', borderRadius: 12, border: 'none', background: '#111827', color: 'white', cursor: 'pointer' }}
          >
            Chamar próximo
          </button>

          {current ? (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem', textAlign: 'center' }}>
              <div style={{ color: '#6b7280' }}>Atendendo</div>
              <div style={{ fontSize: 64, fontWeight: 800 }}>{current.ticket_number}</div>
              <div style={{ marginTop: '0.25rem', color: '#6b7280' }}>
                Status: <strong>{current.status || '—'}</strong>
              </div>
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                <button
                  onClick={onStart}
                  disabled={loading}
                  style={{ padding: '0.75rem', borderRadius: 12, border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer', width: '100%' }}
                >
                  Iniciar atendimento
                </button>
                <button
                  onClick={onPause}
                  disabled={loading}
                  style={{ padding: '0.75rem', borderRadius: 12, border: '1px solid #f59e0b', background: 'white', color: '#92400e', cursor: 'pointer', width: '100%' }}
                >
                  Pausar atendimento
                </button>
                <button
                  onClick={onResume}
                  disabled={loading}
                  style={{ padding: '0.75rem', borderRadius: 12, border: '1px solid #10b981', background: 'white', color: '#065f46', cursor: 'pointer', width: '100%' }}
                >
                  Retomar atendimento
                </button>
                <button
                  onClick={onSkip}
                  disabled={loading}
                  style={{ padding: '0.75rem', borderRadius: 12, border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer', width: '100%' }}
                >
                  Pular (voltar para fila)
                </button>
                <button
                  onClick={onAbandon}
                  disabled={loading}
                  style={{ padding: '0.75rem', borderRadius: 12, border: '1px solid #ef4444', background: 'white', color: '#b91c1c', cursor: 'pointer', width: '100%' }}
                >
                  Abandonou (não compareceu)
                </button>
                <div style={{ display: 'grid', gap: '0.5rem', textAlign: 'left' }}>
                  <label>
                    Transferir para fila (ID)
                    <input
                      value={transferToQueueId}
                      onChange={(e) => setTransferToQueueId(e.target.value)}
                      placeholder="Ex: pq-..."
                      style={{ width: '100%', padding: '0.75rem', borderRadius: 10, border: '1px solid #e5e7eb', marginTop: 6 }}
                    />
                  </label>
                  <button
                    onClick={onTransfer}
                    disabled={loading}
                    style={{ padding: '0.75rem', borderRadius: 12, border: 'none', background: '#f59e0b', color: 'white', cursor: 'pointer', width: '100%' }}
                  >
                    Transferir
                  </button>
                </div>
              </div>
              <button
                onClick={onFinish}
                disabled={loading}
                style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: 12, border: 'none', background: '#10b981', color: 'white', cursor: 'pointer', width: '100%' }}
              >
                Finalizar
              </button>
            </div>
          ) : (
            <div style={{ color: '#6b7280', textAlign: 'center' }}>Sem senha atual.</div>
          )}
        </div>
      </div>
    </div>
  );
}
