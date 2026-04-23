import React, { useState } from 'react';
import { searchBeautyCustomers, getBeautyCustomerDetail, sendBeautyFollowUp, sendBeautyReactivation } from '../api/verticalPilot';
import { useToast } from '../components/Toast';

function formatDate(value) {
  if (!value) return '-';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleString();
}

function levelBadge(level) {
  if (level === 'high') return 'bg-rose-500/15 text-rose-200 border border-rose-500/30';
  if (level === 'medium') return 'bg-amber-500/15 text-amber-200 border border-amber-500/30';
  return 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30';
}

export function BeautyCustomersPage() {
  const { showToast, ToastContainer } = useToast();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);

  async function search() {
    setLoading(true);
    try {
      const out = await searchBeautyCustomers({ q: query, limit: 50 });
      setItems(Array.isArray(out?.items) ? out.items : []);
    } catch (_) {
      showToast('Erro ao buscar clientes', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(subjectId) {
    setDetailLoading(true);
    try {
      const out = await getBeautyCustomerDetail(subjectId, { limit: 200 });
      setDetail(out || null);
    } catch (_) {
      showToast('Erro ao carregar detalhe', 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  async function followUp() {
    if (!detail?.customer?.subjectId && !detail?.customer?.customerId) return;
    try {
      await sendBeautyFollowUp({
        subjectId: detail?.customer?.subjectId,
        customerId: detail?.customer?.customerId,
        channel: 'whatsapp',
        note: 'Follow-up manual da tela Beauty Customers',
      });
      showToast('Follow-up enviado', 'success');
      await openDetail(detail?.customer?.subjectId);
    } catch (_) {
      showToast('Falha no follow-up', 'error');
    }
  }

  async function reactivate() {
    if (!detail?.customer?.subjectId) return;
    try {
      await sendBeautyReactivation({
        subjectId: detail.customer.subjectId,
        customerId: detail.customer.customerId,
        channel: 'whatsapp',
        metadata: { triggeredBy: 'beauty_customers_page' },
      });
      showToast('Reativacao enviada', 'success');
      await openDetail(detail.customer.subjectId);
    } catch (_) {
      showToast('Falha ao enviar reativacao', 'error');
    }
  }

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Clientes de Beleza</h1>
        <p className="text-sm text-text-secondary">Consulta de clientes, jornada, bundle, no-show, follow-up e reativacao.</p>
      </div>
      <div className="support-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          className="support-input"
          placeholder="Nome, documento, telefone ou codigo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search();
          }}
        />
        <button className="support-button" onClick={search} disabled={loading}>{loading ? 'Buscando...' : 'Buscar'}</button>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr 1.1fr', gap: '1rem', marginTop: '1rem' }}>
        <div className="support-details-panel">
          <h3>Clientes</h3>
          {!items.length ? <p className="text-sm text-text-secondary">Nenhum cliente encontrado.</p> : (
            <table className="support-table">
              <thead><tr><th>Cliente</th><th>Ultimo evento</th><th /></tr></thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.subjectId || item.customerId}>
                    <td>
                      <div>{item.name || item.subjectId}</div>
                      <div className="text-xs text-text-secondary">{item.phone || item.document || item.customerId || '-'}</div>
                    </td>
                    <td>{formatDate(item.lastEventAt)}</td>
                    <td><button className="support-button" onClick={() => openDetail(item.subjectId)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="support-details-panel">
          <h3>Atendimento</h3>
          {detailLoading ? <p>Carregando...</p> : !detail ? <p className="text-sm text-text-secondary">Selecione um cliente para abrir a jornada.</p> : (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <span className={`px-2 py-1 rounded-full text-xs ${levelBadge(detail?.indicators?.noShowRiskLevel)}`}>No-show {detail?.indicators?.noShowRiskLevel || 'low'}</span>
                <span className={`px-2 py-1 rounded-full text-xs ${detail?.automation?.followUpSent ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-200 border border-amber-500/30'}`}>
                  Follow-up {detail?.automation?.followUpSent ? 'enviado' : 'pendente'}
                </span>
              </div>
              <p><strong>Cliente:</strong> {detail?.customer?.name}</p>
              <p><strong>Telefone:</strong> {detail?.customer?.phone || '-'}</p>
              <p><strong>Proximo agendamento:</strong> {formatDate(detail?.nextAppointment?.startAt)}</p>
              <p><strong>Bundle:</strong> {detail?.bundle?.remaining ?? '-'} restantes de {detail?.bundle?.total ?? '-'}</p>
              <p><strong>Elegivel para retorno:</strong> {detail?.indicators?.eligibleForReturn ? 'sim' : 'nao'}</p>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button className="support-button" onClick={followUp}>Enviar follow-up</button>
                <button className="support-button" onClick={reactivate}>Reativar</button>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <strong>Agenda recente</strong>
                {!detail?.recentAppointments?.length ? <p className="text-sm text-text-secondary">Sem agenda recente.</p> : (
                  <table className="support-table" style={{ marginTop: '0.5rem' }}>
                    <thead><tr><th>Quando</th><th>Status</th><th>Servico</th></tr></thead>
                    <tbody>
                      {detail.recentAppointments.slice(0, 5).map((item) => (
                        <tr key={item.scheduleId}>
                          <td>{formatDate(item.startAt)}</td>
                          <td>{item.status}</td>
                          <td>{item.serviceName || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginTop: '1rem' }}>
                <strong>Timeline / jornada</strong>
                {!detail?.journeyEvents?.length ? <p className="text-sm text-text-secondary">Sem eventos recentes.</p> : (
                  <table className="support-table" style={{ marginTop: '0.5rem' }}>
                    <thead><tr><th>Quando</th><th>Evento</th><th>Status</th></tr></thead>
                    <tbody>
                      {detail.journeyEvents.slice(0, 6).map((item, index) => (
                        <tr key={`${item.timestamp}-${item.eventType}-${index}`}>
                          <td>{formatDate(item.timestamp)}</td>
                          <td>{item.eventType}</td>
                          <td>{item.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <ToastContainer />
    </div>
  );
}
