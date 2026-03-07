import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/authContext';
import { hasPermission } from '../utils/menuPermissions';
import {
  createBeautyBooking,
  createBeautyProfessional,
  createBeautyService,
  getBeautyDashboard,
  listBeautyCompositions,
  resolveBeautyBundle,
  saveBeautyAssignment,
  updateBeautyCompositions,
  updateBeautyLoyalty,
  updateBeautyPreference,
  updateBeautyProfessional,
  updateBeautyService,
} from '../api/beauty';

function MetricCard({ label, value, help }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-sm">
      <div className="text-xs text-text-tertiary uppercase tracking-wide">{label}</div>
      <div className="text-3xl font-bold text-text-primary mt-2">{value}</div>
      {help ? <div className="text-sm text-text-secondary mt-2">{help}</div> : null}
    </div>
  );
}

const EMPTY_PROFESSIONAL = {
  id: null,
  name: '',
  specialty: '',
  specialties: '',
  maxDailySessions: '',
  scheduleRef: '',
  active: true,
};

const EMPTY_SERVICE = {
  id: null,
  name: '',
  category: '',
  defaultDuration: 30,
  defaultPrice: 0,
  active: true,
};

const EMPTY_ASSIGNMENT = {
  serviceId: '',
  professionalId: '',
  durationMinutes: '',
  priceAmount: '',
  active: true,
};

const EMPTY_LOYALTY = {
  contactId: '',
  visits: 0,
  points: 0,
  lastVisitAt: '',
  segment: '',
};

const EMPTY_PREFERENCE = {
  contactId: '',
  preferredProfessionalId: '',
  preferredServices: '',
  preferredDays: '',
  preferredTimeRanges: '',
};

const EMPTY_BOOKING = {
  contactId: '',
  serviceId: '',
  professionalId: '',
  startAt: '',
  notes: '',
};

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function toCsv(values = []) {
  return Array.isArray(values) ? values.join(', ') : '';
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTimeRanges(value) {
  return parseCsv(value)
    .map((item) => {
      const [start, end] = item.split('-').map((part) => String(part || '').trim());
      if (!start || !end) return null;
      return { start, end };
    })
    .filter(Boolean);
}

export function BeautyDashboard() {
  const { agent } = useAuth();
  const { showToast } = useToast();
  const canRead = hasPermission(agent, 'autonomous_scheduling', 'read') || hasPermission(agent, 'crm', 'read');
  const canUpdate = hasPermission(agent, 'autonomous_scheduling', 'update') || hasPermission(agent, 'config', 'update');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingCompositions, setLoadingCompositions] = useState(false);
  const [dashboard, setDashboard] = useState({
    summary: {},
    professionals: [],
    services: [],
    assignments: [],
    loyalty: [],
    preferences: [],
    waitingList: [],
    recentSchedules: [],
    reactivationCandidates: [],
    professionalAgenda: [],
    upsellOpportunities: [],
    predictiveInsights: null,
  });
  const [professionalForm, setProfessionalForm] = useState(EMPTY_PROFESSIONAL);
  const [serviceForm, setServiceForm] = useState(EMPTY_SERVICE);
  const [assignmentForm, setAssignmentForm] = useState(EMPTY_ASSIGNMENT);
  const [loyaltyForm, setLoyaltyForm] = useState(EMPTY_LOYALTY);
  const [preferenceForm, setPreferenceForm] = useState(EMPTY_PREFERENCE);
  const [bookingForm, setBookingForm] = useState(EMPTY_BOOKING);
  const [compositionDraft, setCompositionDraft] = useState('');
  const [bundleForm, setBundleForm] = useState({ serviceIds: '', professionalId: '' });
  const [bundlePreview, setBundlePreview] = useState(null);

  async function loadData() {
    if (!canRead) return;
    setLoading(true);
    try {
      const out = await getBeautyDashboard();
      setDashboard({
        summary: out?.summary || {},
        professionals: Array.isArray(out?.professionals) ? out.professionals : [],
        services: Array.isArray(out?.services) ? out.services : [],
        assignments: Array.isArray(out?.assignments) ? out.assignments : [],
        loyalty: Array.isArray(out?.loyalty) ? out.loyalty : [],
        preferences: Array.isArray(out?.preferences) ? out.preferences : [],
        waitingList: Array.isArray(out?.waitingList) ? out.waitingList : [],
        recentSchedules: Array.isArray(out?.recentSchedules) ? out.recentSchedules : [],
        reactivationCandidates: Array.isArray(out?.reactivationCandidates) ? out.reactivationCandidates : [],
        professionalAgenda: Array.isArray(out?.professionalAgenda) ? out.professionalAgenda : [],
        upsellOpportunities: Array.isArray(out?.upsellOpportunities) ? out.upsellOpportunities : [],
        predictiveInsights: out?.predictiveInsights || null,
      });
    } catch (err) {
      showToast(`Falha ao carregar Beauty: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [canRead]);

  useEffect(() => {
    async function loadCompositions() {
      if (!serviceForm.id) {
        setCompositionDraft('');
        return;
      }
      setLoadingCompositions(true);
      try {
        const out = await listBeautyCompositions(serviceForm.id);
        const items = Array.isArray(out?.items) ? out.items : [];
        setCompositionDraft(items.map((item) => item.childServiceId).join(', '));
      } catch (err) {
        showToast(`Falha ao carregar composição: ${err.message}`, 'error');
      } finally {
        setLoadingCompositions(false);
      }
    }
    loadCompositions();
  }, [serviceForm.id]);

  const servicesById = useMemo(
    () => new Map((dashboard.services || []).map((item) => [item.id, item])),
    [dashboard.services],
  );
  const professionalsById = useMemo(
    () => new Map((dashboard.professionals || []).map((item) => [item.id, item])),
    [dashboard.professionals],
  );

  async function handleSaveProfessional() {
    if (!canUpdate) {
      showToast('Sem permissão para editar Beauty.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: professionalForm.name,
        specialty: professionalForm.specialty,
        specialties: parseCsv(professionalForm.specialties),
        maxDailySessions: professionalForm.maxDailySessions === '' ? null : Number(professionalForm.maxDailySessions),
        scheduleRef: professionalForm.scheduleRef,
        active: professionalForm.active,
      };
      if (professionalForm.id) {
        await updateBeautyProfessional(professionalForm.id, payload);
      } else {
        await createBeautyProfessional(payload);
      }
      setProfessionalForm(EMPTY_PROFESSIONAL);
      showToast('Profissional salvo.', 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao salvar profissional: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveService() {
    if (!canUpdate) {
      showToast('Sem permissão para editar Beauty.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: serviceForm.name,
        category: serviceForm.category,
        defaultDuration: Number(serviceForm.defaultDuration) || 30,
        defaultPrice: Number(serviceForm.defaultPrice) || 0,
        active: serviceForm.active,
      };
      if (serviceForm.id) {
        await updateBeautyService(serviceForm.id, payload);
      } else {
        await createBeautyService(payload);
      }
      setServiceForm(EMPTY_SERVICE);
      setCompositionDraft('');
      showToast('Serviço salvo.', 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao salvar serviço: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAssignment() {
    if (!canUpdate) {
      showToast('Sem permissão para editar Beauty.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await saveBeautyAssignment({
        serviceId: assignmentForm.serviceId,
        professionalId: assignmentForm.professionalId,
        durationMinutes: assignmentForm.durationMinutes === '' ? null : Number(assignmentForm.durationMinutes),
        priceAmount: assignmentForm.priceAmount === '' ? null : Number(assignmentForm.priceAmount),
        active: assignmentForm.active,
      });
      setAssignmentForm(EMPTY_ASSIGNMENT);
      showToast('Vínculo salvo.', 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao salvar vínculo: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveComposition() {
    if (!canUpdate) {
      showToast('Sem permissão para editar Beauty.', 'warning');
      return;
    }
    if (!serviceForm.id) {
      showToast('Selecione um serviço principal para editar a composição.', 'warning');
      return;
    }
    setSaving(true);
    try {
      const childIds = parseCsv(compositionDraft).filter((id) => id !== serviceForm.id);
      await updateBeautyCompositions(
        serviceForm.id,
        childIds.map((childServiceId, index) => ({
          childServiceId,
          sequence: index + 1,
          optional: false,
        })),
      );
      showToast('Composição atualizada.', 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao salvar composição: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveLoyalty() {
    if (!canUpdate) {
      showToast('Sem permissão para editar Beauty.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await updateBeautyLoyalty(loyaltyForm.contactId, {
        visits: Number(loyaltyForm.visits) || 0,
        points: Number(loyaltyForm.points) || 0,
        lastVisitAt: loyaltyForm.lastVisitAt || null,
        segment: loyaltyForm.segment || null,
      });
      setLoyaltyForm(EMPTY_LOYALTY);
      showToast('Fidelidade atualizada.', 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao salvar fidelidade: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePreference() {
    if (!canUpdate) {
      showToast('Sem permissão para editar Beauty.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await updateBeautyPreference(preferenceForm.contactId, {
        preferredProfessionalId: preferenceForm.preferredProfessionalId || null,
        preferredServices: parseCsv(preferenceForm.preferredServices),
        preferredDays: parseCsv(preferenceForm.preferredDays).map((item) => Number(item)).filter((item) => Number.isInteger(item)),
        preferredTimeRanges: parseTimeRanges(preferenceForm.preferredTimeRanges),
      });
      setPreferenceForm(EMPTY_PREFERENCE);
      showToast('Preferência atualizada.', 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao salvar preferência: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handlePreviewBundle() {
    try {
      const out = await resolveBeautyBundle({
        professionalId: bundleForm.professionalId || null,
        serviceIds: parseCsv(bundleForm.serviceIds),
      });
      setBundlePreview(out?.bundle || null);
    } catch (err) {
      showToast(`Falha ao resolver pacote: ${err.message}`, 'error');
    }
  }

  async function handleCreateBooking() {
    if (!canUpdate) {
      showToast('Sem permissão para operar Beauty.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await createBeautyBooking({
        contactId: bookingForm.contactId,
        serviceId: bookingForm.serviceId,
        professionalId: bookingForm.professionalId,
        startAt: bookingForm.startAt,
        notes: bookingForm.notes || null,
        channel: 'whatsapp',
      });
      setBookingForm(EMPTY_BOOKING);
      showToast('Booking Beauty criado.', 'success');
      await loadData();
    } catch (err) {
      showToast(`Falha ao criar booking: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) {
    return (
      <div className="support-page">
        <div className="p-8 text-center text-text-secondary">Sem permissão para acessar a vertical Beauty.</div>
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '12px', flexWrap: 'wrap' }}>
          <h1>Beauty Dashboard</h1>
          <div className="text-sm text-text-secondary">Profissionais, composição de serviços, fidelidade e reativação sobre scheduling/CRM já existentes.</div>
        </div>
        <div className="support-controls">
          <Button onClick={loadData} disabled={loading}>Atualizar</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary">Carregando Beauty...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
            <MetricCard label="Profissionais Ativos" value={dashboard.summary.professionalsActive || 0} />
            <MetricCard label="Serviços Ativos" value={dashboard.summary.servicesActive || 0} />
            <MetricCard label="Vínculos" value={dashboard.summary.assignmentsTotal || 0} />
            <MetricCard label="Waiting List" value={dashboard.summary.waitingListBeauty || 0} />
            <MetricCard label="Reativações" value={(dashboard.reactivationCandidates || []).length} help="Janela baseada no template vertical Beauty." />
            <MetricCard label="Fill Probability" value={dashboard.predictiveInsights?.fillProbability || 0} help="Heurística preditiva do runtime atual." />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Profissionais</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Nome" value={professionalForm.name} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, name: e.target.value }))} />
                <input className="input-field" placeholder="Especialidade" value={professionalForm.specialty} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, specialty: e.target.value }))} />
                <input className="input-field" placeholder="Especialidades (csv)" value={professionalForm.specialties} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, specialties: e.target.value }))} />
                <input className="input-field" type="number" min="1" placeholder="Max sessões/dia" value={professionalForm.maxDailySessions} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, maxDailySessions: e.target.value }))} />
                <input className="input-field" placeholder="scheduleRef" value={professionalForm.scheduleRef} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, scheduleRef: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={professionalForm.active} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, active: e.target.checked }))} />
                  Ativo
                </label>
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={handleSaveProfessional} disabled={saving}>{professionalForm.id ? 'Atualizar' : 'Adicionar'}</Button>
                {professionalForm.id ? <Button variant="secondary" onClick={() => setProfessionalForm(EMPTY_PROFESSIONAL)}>Cancelar</Button> : null}
              </div>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.professionals || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setProfessionalForm({
                      id: item.id,
                      name: item.name || '',
                      specialty: item.specialty || '',
                      specialties: toCsv(item.specialties || []),
                      maxDailySessions: item.maxDailySessions || '',
                      scheduleRef: item.scheduleRef || '',
                      active: item.active !== false,
                    })}
                    className="w-full text-left border border-border-default rounded-lg p-4 hover:border-accent-primary"
                  >
                    <div className="font-semibold text-text-primary">{item.name}</div>
                    <div className="text-sm text-text-secondary">{item.specialty || 'Sem especialidade'} {item.scheduleRef ? `• ${item.scheduleRef}` : ''} {item.maxDailySessions ? `• max ${item.maxDailySessions}/dia` : ''}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Serviços</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Nome" value={serviceForm.name} onChange={(e) => setServiceForm((prev) => ({ ...prev, name: e.target.value }))} />
                <input className="input-field" placeholder="Categoria" value={serviceForm.category} onChange={(e) => setServiceForm((prev) => ({ ...prev, category: e.target.value }))} />
                <input className="input-field" type="number" min="1" placeholder="Duração padrão" value={serviceForm.defaultDuration} onChange={(e) => setServiceForm((prev) => ({ ...prev, defaultDuration: e.target.value }))} />
                <input className="input-field" type="number" min="0" step="0.01" placeholder="Preço padrão" value={serviceForm.defaultPrice} onChange={(e) => setServiceForm((prev) => ({ ...prev, defaultPrice: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input type="checkbox" checked={serviceForm.active} onChange={(e) => setServiceForm((prev) => ({ ...prev, active: e.target.checked }))} />
                  Ativo
                </label>
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={handleSaveService} disabled={saving}>{serviceForm.id ? 'Atualizar' : 'Adicionar'}</Button>
                {serviceForm.id ? <Button variant="secondary" onClick={() => { setServiceForm(EMPTY_SERVICE); setCompositionDraft(''); }}>Cancelar</Button> : null}
              </div>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.services || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setServiceForm({
                      id: item.id,
                      name: item.name || '',
                      category: item.category || '',
                      defaultDuration: item.defaultDuration || 30,
                      defaultPrice: item.defaultPrice || 0,
                      active: item.active !== false,
                    })}
                    className="w-full text-left border border-border-default rounded-lg p-4 hover:border-accent-primary"
                  >
                    <div className="font-semibold text-text-primary">{item.name}</div>
                    <div className="text-sm text-text-secondary">
                      {(item.category || 'Sem categoria')} • {item.defaultDuration || 0} min • {formatCurrency(item.defaultPrice)}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Vínculos Serviço x Profissional</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <select className="input-field" value={assignmentForm.professionalId} onChange={(e) => setAssignmentForm((prev) => ({ ...prev, professionalId: e.target.value }))}>
                  <option value="">Selecione um profissional</option>
                  {(dashboard.professionals || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select className="input-field" value={assignmentForm.serviceId} onChange={(e) => setAssignmentForm((prev) => ({ ...prev, serviceId: e.target.value }))}>
                  <option value="">Selecione um serviço</option>
                  {(dashboard.services || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <input className="input-field" type="number" min="1" placeholder="Duração customizada" value={assignmentForm.durationMinutes} onChange={(e) => setAssignmentForm((prev) => ({ ...prev, durationMinutes: e.target.value }))} />
                <input className="input-field" type="number" min="0" step="0.01" placeholder="Preço customizado" value={assignmentForm.priceAmount} onChange={(e) => setAssignmentForm((prev) => ({ ...prev, priceAmount: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={handleSaveAssignment} disabled={saving}>Salvar vínculo</Button>
              </div>
              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.assignments || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">
                      {professionalsById.get(item.professionalId)?.name || item.professionalId} → {servicesById.get(item.serviceId)?.name || item.serviceId}
                    </div>
                    <div className="text-sm text-text-secondary">
                      {item.durationMinutes ? `${item.durationMinutes} min` : 'Duração padrão'} • {item.priceAmount != null ? formatCurrency(item.priceAmount) : 'Preço padrão'}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Composição de Serviço</h2>
              <div className="text-sm text-text-secondary mb-3">
                Selecione um serviço acima e informe os IDs dos serviços-filho na ordem de execução.
              </div>
              <textarea
                className="input-field min-h-28"
                placeholder="svc-manicure, svc-pedicure"
                value={compositionDraft}
                onChange={(e) => setCompositionDraft(e.target.value)}
                disabled={!serviceForm.id || loadingCompositions}
              />
              <div className="flex gap-3 mt-4 mb-4">
                <Button onClick={handleSaveComposition} disabled={saving || !serviceForm.id}>
                  Salvar composição
                </Button>
              </div>
              <div className="space-y-2 text-sm">
                {parseCsv(compositionDraft).map((serviceId) => (
                  <div key={serviceId} className="border border-border-default rounded-lg p-3 text-text-primary">
                    {servicesById.get(serviceId)?.name || serviceId}
                  </div>
                ))}
                {!serviceForm.id ? <div className="text-text-secondary">Nenhum serviço selecionado.</div> : null}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Fidelidade</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Contact ID" value={loyaltyForm.contactId} onChange={(e) => setLoyaltyForm((prev) => ({ ...prev, contactId: e.target.value }))} />
                <input className="input-field" type="number" min="0" placeholder="Visitas" value={loyaltyForm.visits} onChange={(e) => setLoyaltyForm((prev) => ({ ...prev, visits: e.target.value }))} />
                <input className="input-field" type="number" min="0" placeholder="Pontos" value={loyaltyForm.points} onChange={(e) => setLoyaltyForm((prev) => ({ ...prev, points: e.target.value }))} />
                <input className="input-field" type="datetime-local" value={loyaltyForm.lastVisitAt} onChange={(e) => setLoyaltyForm((prev) => ({ ...prev, lastVisitAt: e.target.value }))} />
                <input className="input-field" placeholder="Segmento" value={loyaltyForm.segment} onChange={(e) => setLoyaltyForm((prev) => ({ ...prev, segment: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={handleSaveLoyalty} disabled={saving}>Salvar fidelidade</Button>
                <Button variant="secondary" onClick={() => setLoyaltyForm(EMPTY_LOYALTY)}>Limpar</Button>
              </div>
              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.loyalty || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setLoyaltyForm({
                      contactId: item.contactId || '',
                      visits: item.visits || 0,
                      points: item.points || 0,
                      lastVisitAt: item.lastVisitAt ? String(item.lastVisitAt).slice(0, 16) : '',
                      segment: item.segment || '',
                    })}
                    className="w-full text-left border border-border-default rounded-lg p-4 hover:border-accent-primary"
                  >
                    <div className="font-semibold text-text-primary">{item.contactId}</div>
                    <div className="text-sm text-text-secondary">
                      {item.visits} visitas • {item.points} pontos • {item.segment || 'sem segmento'}
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Preferências do Cliente</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Contact ID" value={preferenceForm.contactId} onChange={(e) => setPreferenceForm((prev) => ({ ...prev, contactId: e.target.value }))} />
                <select className="input-field" value={preferenceForm.preferredProfessionalId} onChange={(e) => setPreferenceForm((prev) => ({ ...prev, preferredProfessionalId: e.target.value }))}>
                  <option value="">Profissional preferido</option>
                  {(dashboard.professionals || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <input className="input-field" placeholder="Serviços preferidos (IDs)" value={preferenceForm.preferredServices} onChange={(e) => setPreferenceForm((prev) => ({ ...prev, preferredServices: e.target.value }))} />
                <input className="input-field" placeholder="Dias preferidos (0-6)" value={preferenceForm.preferredDays} onChange={(e) => setPreferenceForm((prev) => ({ ...prev, preferredDays: e.target.value }))} />
                <input className="input-field md:col-span-2" placeholder="Faixas horárias (09:00-12:00, 14:00-18:00)" value={preferenceForm.preferredTimeRanges} onChange={(e) => setPreferenceForm((prev) => ({ ...prev, preferredTimeRanges: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={handleSavePreference} disabled={saving}>Salvar preferência</Button>
                <Button variant="secondary" onClick={() => setPreferenceForm(EMPTY_PREFERENCE)}>Limpar</Button>
              </div>
              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.preferences || []).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPreferenceForm({
                      contactId: item.contactId || '',
                      preferredProfessionalId: item.preferredProfessionalId || '',
                      preferredServices: toCsv(item.preferredServices),
                      preferredDays: toCsv(item.preferredDays),
                      preferredTimeRanges: Array.isArray(item.preferredTimeRanges)
                        ? item.preferredTimeRanges.map((range) => `${range.start}-${range.end}`).join(', ')
                        : '',
                    })}
                    className="w-full text-left border border-border-default rounded-lg p-4 hover:border-accent-primary"
                  >
                    <div className="font-semibold text-text-primary">{item.contactId}</div>
                    <div className="text-sm text-text-secondary">
                      {(professionalsById.get(item.preferredProfessionalId)?.name || item.preferredProfessionalId || 'sem profissional')}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Agenda por Profissional</h2>
              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.professionalAgenda || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Sem agenda Beauty vinculada a profissionais.</div>
                ) : (
                  (dashboard.professionalAgenda || []).map((entry) => (
                    <div key={entry.professional?.id || entry.professional?.name} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{entry.professional?.name || 'Profissional'}</div>
                      <div className="text-sm text-text-secondary">
                        {entry.appointments?.length || 0} agendamento(s) futuro(s)
                        {entry.freeWindows?.length ? ` • ${entry.freeWindows[0].freeSlots} slot(s) livre(s) no próximo dia crítico` : ''}
                      </div>
                      {(entry.idleSignals || []).map((signal) => (
                        <div key={`${entry.professional?.id}-${signal.day}`} className="text-sm text-text-secondary">
                          {signal.day}: {signal.bookedSessions} sessão(ões), capacidade sugerida {signal.suggestedCapacity}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Predictive</h2>
              {dashboard.predictiveInsights ? (
                <div className="space-y-2 text-sm text-text-secondary">
                  <div>Idle risk: {dashboard.predictiveInsights.idleRisk}</div>
                  <div>No-show risk: {dashboard.predictiveInsights.noShowRisk}</div>
                  <div>Fill probability: {dashboard.predictiveInsights.fillProbability}</div>
                </div>
              ) : (
                <div className="text-sm text-text-secondary">Sem sinais preditivos disponíveis.</div>
              )}
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Booking Operacional</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Contact ID" value={bookingForm.contactId} onChange={(e) => setBookingForm((prev) => ({ ...prev, contactId: e.target.value }))} />
                <select className="input-field" value={bookingForm.serviceId} onChange={(e) => setBookingForm((prev) => ({ ...prev, serviceId: e.target.value }))}>
                  <option value="">Serviço</option>
                  {(dashboard.services || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select className="input-field" value={bookingForm.professionalId} onChange={(e) => setBookingForm((prev) => ({ ...prev, professionalId: e.target.value }))}>
                  <option value="">Profissional</option>
                  {(dashboard.professionals || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <input className="input-field" type="datetime-local" value={bookingForm.startAt} onChange={(e) => setBookingForm((prev) => ({ ...prev, startAt: e.target.value }))} />
                <input className="input-field md:col-span-2" placeholder="Notas" value={bookingForm.notes} onChange={(e) => setBookingForm((prev) => ({ ...prev, notes: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={handleCreateBooking} disabled={saving}>Criar booking</Button>
              </div>
              <div className="text-sm text-text-secondary">Usa o writer operacional da Beauty, valida disponibilidade central e já reconcilia fidelidade.</div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Prévia de Serviço Composto</h2>
              <div className="grid grid-cols-1 gap-3 mb-4">
                <input className="input-field" placeholder="IDs dos serviços separados por vírgula" value={bundleForm.serviceIds} onChange={(e) => setBundleForm((prev) => ({ ...prev, serviceIds: e.target.value }))} />
                <select className="input-field" value={bundleForm.professionalId} onChange={(e) => setBundleForm((prev) => ({ ...prev, professionalId: e.target.value }))}>
                  <option value="">Sem profissional específico</option>
                  {(dashboard.professionals || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={handlePreviewBundle}>Calcular pacote</Button>
              </div>
              {bundlePreview ? (
                <div className="border border-border-default rounded-lg p-4">
                  <div className="text-sm text-text-secondary mb-3">
                    Total: {bundlePreview.totalDurationMinutes} min • {formatCurrency(bundlePreview.totalPriceAmount)}
                  </div>
                  <div className="space-y-2">
                    {(bundlePreview.items || []).map((item, index) => (
                      <div key={`${item.serviceId}-${index}`} className="text-sm text-text-primary">
                        {item.serviceName} • {item.durationMinutes} min • {formatCurrency(item.priceAmount)}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-text-secondary">Informe serviços e, se quiser, um profissional para ver duração e preço efetivos.</div>
              )}
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Reativação</h2>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.reactivationCandidates || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Nenhum cliente em janela de reativação.</div>
                ) : (
                  dashboard.reactivationCandidates.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">
                        {item.contact?.name || item.contact?.full_name || item.contactId}
                      </div>
                      <div className="text-sm text-text-secondary">
                        {item.inactiveDays} dias sem visita • {item.segment || 'sem segmento'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Upsell Sugerido</h2>
              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.upsellOpportunities || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Nenhuma oportunidade de upsell derivada da agenda recente.</div>
                ) : (
                  dashboard.upsellOpportunities.map((item, index) => (
                    <div key={`${item.contactId}-${item.suggestedServiceId}-${index}`} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.suggestedServiceName}</div>
                      <div className="text-sm text-text-secondary">{item.reason}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Waiting List Beauty</h2>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.waitingList || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Sem itens Beauty na waiting list.</div>
                ) : (
                  dashboard.waitingList.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.contact_id || item.contactId || 'Contato'}</div>
                      <div className="text-sm text-text-secondary">{item.service_type || item.serviceType || 'Serviço não informado'}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Agendamentos Beauty Recentes</h2>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.recentSchedules || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Nenhum agendamento recente com contexto Beauty.</div>
                ) : (
                  dashboard.recentSchedules.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.title || item.purpose || item.id}</div>
                      <div className="text-sm text-text-secondary">
                        {item.start_at || item.startAt || '-'} • {item.status || 'sem status'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
