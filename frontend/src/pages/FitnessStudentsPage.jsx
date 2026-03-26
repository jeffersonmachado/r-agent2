import React, { useMemo, useState } from 'react';
import { searchFitnessStudents, getFitnessStudentDetail, registerFitnessCheckIn, registerFitnessCheckOut } from '../api/verticalPilot';
import { useToast } from '../components/Toast';

function badgeClass(tone) {
  if (tone === 'success') return 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30';
  if (tone === 'warning') return 'bg-amber-500/15 text-amber-200 border border-amber-500/30';
  if (tone === 'error') return 'bg-rose-500/15 text-rose-200 border border-rose-500/30';
  return 'bg-slate-500/15 text-slate-200 border border-slate-500/30';
}

function formatDate(value) {
  if (!value) return '-';
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? '-' : dt.toLocaleString();
}

export function FitnessStudentsPage() {
  const { showToast, ToastContainer } = useToast();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  const summary = useMemo(() => ({
    total: items.length,
    blocked: items.filter((item) => item.accessTone === 'error').length,
    active: items.filter((item) => item.accessTone === 'success').length,
    warning: items.filter((item) => item.accessTone === 'warning').length,
  }), [items]);

  async function runSearch() {
    setLoading(true);
    try {
      const out = await searchFitnessStudents({ q: query, limit: 50 });
      setItems(Array.isArray(out?.items) ? out.items : []);
      if (selected) {
        const stillExists = (out?.items || []).some((item) => item.subjectId === selected);
        if (!stillExists) {
          setSelected(null);
          setDetail(null);
        }
      }
    } catch (_) {
      showToast('Erro ao buscar alunos Fitness', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(subjectId) {
    setSelected(subjectId);
    setDetailLoading(true);
    try {
      const out = await getFitnessStudentDetail(subjectId, { limit: 120 });
      setDetail(out || null);
    } catch (_) {
      showToast('Erro ao carregar detalhe do aluno', 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  async function checkIn() {
    if (!selected || !detail?.membership?.id) return;
    try {
      await registerFitnessCheckIn({ subjectId: selected, membershipId: detail.membership.id, metadata: { source: 'fitness_students_page' } });
      showToast('Check-in realizado', 'success');
      await openDetail(selected);
      await runSearch();
    } catch (_) {
      showToast('Falha no check-in', 'error');
    }
  }

  async function checkOut() {
    if (!selected) return;
    try {
      await registerFitnessCheckOut({ subjectId: selected, metadata: { source: 'fitness_students_page' } });
      showToast('Check-out realizado', 'success');
      await openDetail(selected);
    } catch (_) {
      showToast('Falha no check-out', 'error');
    }
  }

  return (
    <div className="support-content-wrapper" style={{ padding: '1rem' }}>
      <div className="support-header">
        <h1>Fitness Students</h1>
        <p className="text-sm text-text-secondary">Busca operacional de alunos com acesso, membership, billing e historico de presenca.</p>
      </div>

      <div className="support-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          className="support-input"
          placeholder="Nome, documento, telefone ou codigo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch();
          }}
        />
        <button className="support-button" onClick={runSearch} disabled={loading}>{loading ? 'Buscando...' : 'Buscar'}</button>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '0.75rem', marginTop: '1rem' }}>
        <div className="support-details-panel"><strong>Total</strong><div>{summary.total}</div></div>
        <div className="support-details-panel"><strong>Liberados</strong><div>{summary.active}</div></div>
        <div className="support-details-panel"><strong>Em alerta</strong><div>{summary.warning}</div></div>
        <div className="support-details-panel"><strong>Bloqueados</strong><div>{summary.blocked}</div></div>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1.1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
        <div className="support-details-panel">
          <h3>Alunos</h3>
          {!items.length ? <p className="text-sm text-text-secondary">Nenhum aluno encontrado para os filtros atuais.</p> : (
            <table className="support-table">
              <thead>
                <tr>
                  <th>Aluno</th>
                  <th>Membership</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.membershipId || item.subjectId}>
                    <td>
                      <div>{item.name || item.subjectId}</div>
                      <div className="text-xs text-text-secondary">{item.document || item.phone || item.subjectId}</div>
                    </td>
                    <td>{item.membershipId || '-'}</td>
                    <td><span className={`px-2 py-1 rounded-full text-xs ${badgeClass(item.accessTone)}`}>{item.accessLabel || item.effectiveBillingStatus}</span></td>
                    <td><button className="support-button" onClick={() => openDetail(item.subjectId)}>Abrir</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="support-details-panel">
          <h3>Detalhe operacional</h3>
          {!selected ? <p className="text-sm text-text-secondary">Selecione um aluno para abrir a operacao.</p> : detailLoading ? <p>Carregando...</p> : !detail ? <p>Sem detalhe disponivel.</p> : (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <span className={`px-2 py-1 rounded-full text-xs ${badgeClass(detail?.accessStatus?.tone)}`}>{detail?.accessStatus?.label || 'sem status'}</span>
                <span className={`px-2 py-1 rounded-full text-xs ${badgeClass(detail?.accessStatus?.allowed ? 'success' : 'error')}`}>{detail?.accessStatus?.allowed ? 'Acesso liberado' : 'Acesso bloqueado'}</span>
              </div>
              <p><strong>Aluno:</strong> {detail?.student?.name}</p>
              <p><strong>Membership:</strong> {detail?.membership?.id || '-'}</p>
              <p><strong>Billing:</strong> {detail?.membership?.effectiveBillingStatus || detail?.membership?.billing_status || '-'}</p>
              <p><strong>Frequencia 7d / 30d:</strong> {detail?.attendance?.frequency7d || 0} / {detail?.attendance?.frequency30d || 0}</p>
              <p><strong>Churn score:</strong> {detail?.churnRisk?.score ?? '-'}</p>
              {!!detail?.alerts?.length && (
                <div style={{ marginTop: '0.75rem' }}>
                  <strong>Alertas</strong>
                  <ul className="text-sm text-text-secondary" style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
                    {detail.alerts.map((alert) => <li key={alert.type}>{alert.message}</li>)}
                  </ul>
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                <button className="support-button" onClick={checkIn} disabled={!detail?.membership?.id || !detail?.accessStatus?.allowed}>Check-in</button>
                <button className="support-button" onClick={checkOut}>Check-out</button>
              </div>

              <div style={{ marginTop: '1rem' }}>
                <strong>Historico de billing</strong>
                {!detail?.billingHistory?.length ? <p className="text-sm text-text-secondary">Sem mudancas recentes.</p> : (
                  <table className="support-table" style={{ marginTop: '0.5rem' }}>
                    <thead><tr><th>Quando</th><th>Transicao</th><th>Motivo</th></tr></thead>
                    <tbody>
                      {detail.billingHistory.slice(0, 5).map((item) => (
                        <tr key={`${item.id}-${item.occurredAt}`}>
                          <td>{formatDate(item.occurredAt)}</td>
                          <td>{item.fromStatus || '-'} → {item.toStatus || '-'}</td>
                          <td>{item.reason || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div style={{ marginTop: '1rem' }}>
                <strong>Timeline util</strong>
                {!detail?.timeline?.length ? <p className="text-sm text-text-secondary">Sem eventos recentes.</p> : (
                  <table className="support-table" style={{ marginTop: '0.5rem' }}>
                    <thead><tr><th>Quando</th><th>Evento</th><th>Status</th></tr></thead>
                    <tbody>
                      {detail.timeline.slice(0, 6).map((item, index) => (
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
