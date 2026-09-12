import React, { useMemo, useState } from 'react';
import { searchFitnessStudents, getFitnessStudentDetail, registerFitnessCheckIn, registerFitnessCheckOut, createFitnessStudent } from '../api/verticalPilot';
import { useToast } from '../components/Toast';
import { useAskAiEntityContext } from '../askAi/useAskAiEntityContext';
import { ENTITY_TYPES } from '../askAi/contextProvider';

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

  // A ficha aberta é a entidade sobre a qual o copiloto deve responder
  // ("qual a situação financeira deste aluno?" → dados vivos reais).
  useAskAiEntityContext({
    entityType: ENTITY_TYPES.FITNESS_STUDENT,
    entityId: selected,
  });

  // Formulário de cadastro de novo aluno (fecha o gap: antes não havia UI
  // para criar aluno — a criação só existia via API).
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    document: '',
    planName: 'Plano Mensal',
    monthlyAmount: '129.90',
  });

  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreateStudent() {
    if (!form.name || !form.name.trim()) {
      showToast('Informe o nome do aluno', 'error');
      return;
    }
    setSaving(true);
    try {
      const now = Date.now();
      const subjectId = `stu-${now}`;
      const membershipId = `mem-${now}`;
      await createFitnessStudent({
        subjectId,
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        document: form.document.trim() || null,
        membershipId,
        planName: form.planName.trim() || 'Plano Mensal',
        monthlyAmount: Number(form.monthlyAmount) || 129.9,
        billingStatus: 'active',
        status: 'active',
      });
      showToast('Aluno criado com sucesso', 'success');
      setShowForm(false);
      setForm({ name: '', phone: '', email: '', document: '', planName: 'Plano Mensal', monthlyAmount: '129.90' });
      setQuery('');
      await runSearch();
    } catch (err) {
      showToast(err?.message || 'Falha ao criar aluno', 'error');
    } finally {
      setSaving(false);
    }
  }

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
        <h1>Alunos Fitness</h1>
        <p className="text-sm text-text-secondary">Busca operacional de alunos com acesso, membership, billing e histórico de presença.</p>
      </div>

      <div className="support-controls" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          className="support-input"
          placeholder="Nome, documento, telefone ou código"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch();
          }}
        />
        <button className="support-button" onClick={runSearch} disabled={loading}>{loading ? 'Buscando...' : 'Buscar'}</button>
        <button className="support-button" onClick={() => setShowForm(true)}>+ Novo Aluno</button>
      </div>

      {showForm && (
        <div className="support-details-panel" style={{ marginTop: '1rem' }}>
          <h3>Novo Aluno</h3>
          <div className="support-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem', marginTop: '0.75rem' }}>
            <div>
              <label className="text-xs text-text-secondary">Nome *</label>
              <input className="support-input" value={form.name} onChange={(e) => updateForm('name', e.target.value)} placeholder="Nome completo" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">Telefone</label>
              <input className="support-input" value={form.phone} onChange={(e) => updateForm('phone', e.target.value)} placeholder="+5511..." />
            </div>
            <div>
              <label className="text-xs text-text-secondary">E-mail</label>
              <input className="support-input" value={form.email} onChange={(e) => updateForm('email', e.target.value)} placeholder="email@exemplo.com" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">Documento (CPF)</label>
              <input className="support-input" value={form.document} onChange={(e) => updateForm('document', e.target.value)} placeholder="000.000.000-00" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">Plano</label>
              <input className="support-input" value={form.planName} onChange={(e) => updateForm('planName', e.target.value)} placeholder="Plano Mensal" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">Mensalidade (R$)</label>
              <input className="support-input" value={form.monthlyAmount} onChange={(e) => updateForm('monthlyAmount', e.target.value)} placeholder="129.90" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="support-button" onClick={handleCreateStudent} disabled={saving}>{saving ? 'Criando...' : 'Criar aluno'}</button>
            <button className="support-button" onClick={() => setShowForm(false)} disabled={saving}>Cancelar</button>
          </div>
        </div>
      )}

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
