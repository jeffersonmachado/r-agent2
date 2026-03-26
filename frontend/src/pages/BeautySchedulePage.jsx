import React, { useEffect, useState } from 'react';
import { getBeautyAgenda, markBeautyNoShow, markBeautyServiceCompleted } from '../api/verticalPilot';
import { useToast } from '../components/Toast';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return '-';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleString();
}

export function BeautySchedulePage() {
  const { showToast, ToastContainer } = useToast();
  const [date, setDate] = useState(todayIso());
  const [professionalId, setProfessionalId] = useState('');
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  async function loadAgenda() {
    setLoading(true);
    try {
      const out = await getBeautyAgenda({ date, professionalId: professionalId || undefined, limit: 200 });
      setItems(Array.isArray(out?.items) ? out.items : []);
      setSummary(out?.summary || null);
      if (selected) {
        const nextSelected = (out?.items || []).find((item) => item.scheduleId === selected.scheduleId) || null;
        setSelected(nextSelected);
      }
    } catch (_) {
      showToast('Erro ao carregar agenda beauty', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function noShow(item) {
    try {
      await markBeautyNoShow({ subjectId: item.subjectId, customerId: item.customerId, scheduleId: item.scheduleId, channel: 'whatsapp', metadata: { source: 'beauty_schedule_page' } });
      showToast('No-show registrado', 'success');
      await loadAgenda();
    } catch (_) {
      showToast('Falha ao registrar no-show', 'error');
    }
  }

  async function complete(item) {
    try {
      await markBeautyServiceCompleted({ subjectId: item.subjectId, customerId: item.customerId, scheduleId: item.scheduleId, metadata: { source: 'beauty_schedule_page' } });
      showToast('Servico marcado como concluido', 'success');
      await loadAgenda();
    } catch (_) {
      showToast('Falha ao concluir servico', 'error');
    }
  }

  useEffect(() => {
    loadAgenda();
  }, [date, professionalId]);

  useEffect(() => {
    const timer = setInterval(loadAgenda, 15000);
    return () => clearInterval(timer);
  }, [date, professionalId]);

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Beauty Schedule</h1>
        <p className="text-sm text-text-secondary">Agenda operacional com resumo do dia, no-show e encerramento real do atendimento.</p>
      </div>
      <div className="support-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input className="support-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className="support-input" placeholder="professionalId opcional" value={professionalId} onChange={(e) => setProfessionalId(e.target.value)} />
        <button className="support-button" onClick={loadAgenda} disabled={loading}>{loading ? 'Atualizando...' : 'Atualizar'}</button>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        <div className="support-details-panel"><strong>Total</strong><div>{summary?.total ?? items.length}</div></div>
        <div className="support-details-panel"><strong>Pendentes</strong><div>{summary?.pendente ?? 0}</div></div>
        <div className="support-details-panel"><strong>Confirmados</strong><div>{summary?.confirmado ?? 0}</div></div>
        <div className="support-details-panel"><strong>Em atendimento</strong><div>{summary?.emAtendimento ?? 0}</div></div>
        <div className="support-details-panel"><strong>Concluidos</strong><div>{summary?.concluido ?? 0}</div></div>
        <div className="support-details-panel"><strong>No-show</strong><div>{summary?.noShow ?? 0}</div></div>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1.2fr 0.9fr', gap: '1rem', marginTop: '1rem' }}>
        <div className="support-details-panel">
          <h3>Agenda do dia</h3>
          {!items.length ? <p className="text-sm text-text-secondary">Nenhum agendamento encontrado para esse recorte.</p> : (
            <table className="support-table">
              <thead>
                <tr>
                  <th>Horario</th>
                  <th>Cliente</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.scheduleId}>
                    <td>{formatDate(item.startAt)}</td>
                    <td>
                      <div>{item.customerName || item.customerId || item.subjectId}</div>
                      <div className="text-xs text-text-secondary">{item.serviceName || item.professionalName || '-'}</div>
                    </td>
                    <td>{item.status}</td>
                    <td>
                      <button className="support-button" onClick={() => setSelected(item)}>Abrir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="support-details-panel">
          <h3>Operacao</h3>
          {!selected ? <p className="text-sm text-text-secondary">Selecione um agendamento para operar.</p> : (
            <>
              <p><strong>Cliente:</strong> {selected.customerName || selected.customerId || selected.subjectId}</p>
              <p><strong>Horario:</strong> {formatDate(selected.startAt)}</p>
              <p><strong>Status:</strong> {selected.status}</p>
              <p><strong>Servico:</strong> {selected.serviceName || '-'}</p>
              <p><strong>Profissional:</strong> {selected.professionalName || selected.ownerId || '-'}</p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button className="support-button" onClick={() => complete(selected)}>Concluir</button>
                <button className="support-button" onClick={() => noShow(selected)}>Registrar no-show</button>
              </div>
            </>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
