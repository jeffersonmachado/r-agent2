import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/authContext';
import { hasPermission } from '../utils/menuPermissions';
import {
  createFitnessCheckin,
  createFitnessClass,
  createFitnessGoal,
  createFitnessMembership,
  createFitnessProfessional,
  createFitnessResource,
  createFitnessSchedule,
  getFitnessDashboard,
  saveFitnessActivityProfessional,
  saveFitnessActivityResource,
  saveFitnessAttendance,
} from '../api/fitness';

function MetricCard({ label, value, help }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-5 shadow-sm">
      <div className="text-xs text-text-tertiary uppercase tracking-wide">{label}</div>
      <div className="text-3xl font-bold text-text-primary mt-2">{value}</div>
      {help ? <div className="text-sm text-text-secondary mt-2">{help}</div> : null}
    </div>
  );
}

const EMPTY_CLASS = {
  name: '',
  instructorId: '',
  category: '',
  operationMode: 'group_class',
  durationMinutes: 60,
  defaultCapacity: 12,
  active: true,
};

const EMPTY_SCHEDULE = {
  classId: '',
  startAt: '',
  endAt: '',
  capacity: 12,
  location: '',
  status: 'scheduled',
  professionalIds: '',
  resourceIds: '',
};

const EMPTY_PROFESSIONAL = {
  name: '',
  roleType: 'instructor',
  specialties: '',
  maxConcurrentSessions: 1,
};

const EMPTY_RESOURCE = {
  name: '',
  resourceType: 'room',
  capacity: 1,
  location: '',
  exclusiveUse: false,
};

const EMPTY_ACTIVITY_PROFESSIONAL = {
  activityId: '',
  professionalId: '',
  durationMinutes: '',
  defaultPrice: '',
  maxCapacityOverride: '',
};

const EMPTY_ACTIVITY_RESOURCE = {
  activityId: '',
  resourceId: '',
  quantity: 1,
  exclusiveUse: false,
};

const EMPTY_MEMBERSHIP = {
  memberId: '',
  planName: '',
  startDate: '',
  endDate: '',
  allowedClasses: '',
  allowedCategories: '',
  allowedWeeklyFrequency: '',
  active: true,
};

const EMPTY_ATTENDANCE = {
  classScheduleId: '',
  memberId: '',
  status: 'booked',
  autoJoinWaitingList: true,
};

const EMPTY_CHECKIN = {
  memberId: '',
  classScheduleId: '',
  source: 'manual',
  kioskCode: 'default',
};

const EMPTY_GOAL = {
  memberId: '',
  goalType: '',
  targetValue: '',
  active: true,
};

export function FitnessDashboard() {
  const { agent } = useAuth();
  const { showToast } = useToast();
  const canRead = hasPermission(agent, 'autonomous_scheduling', 'read') || hasPermission(agent, 'crm', 'read');
  const canUpdate = hasPermission(agent, 'autonomous_scheduling', 'update') || hasPermission(agent, 'config', 'update');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dashboard, setDashboard] = useState({
    summary: {},
    classes: [],
    schedules: [],
    memberships: [],
    attendance: [],
    goals: [],
    checkins: [],
    waitingList: [],
    recentSchedules: [],
    retentionCandidates: [],
    upsellCandidates: [],
    professionals: [],
    resources: [],
    activityProfessionals: [],
    activityResources: [],
    schedulesByProfessional: [],
    schedulesByResource: [],
    idleResources: [],
    operationalConflicts: [],
    predictiveInsights: null,
  });
  const [classForm, setClassForm] = useState(EMPTY_CLASS);
  const [scheduleForm, setScheduleForm] = useState(EMPTY_SCHEDULE);
  const [membershipForm, setMembershipForm] = useState(EMPTY_MEMBERSHIP);
  const [attendanceForm, setAttendanceForm] = useState(EMPTY_ATTENDANCE);
  const [checkinForm, setCheckinForm] = useState(EMPTY_CHECKIN);
  const [goalForm, setGoalForm] = useState(EMPTY_GOAL);
  const [professionalForm, setProfessionalForm] = useState(EMPTY_PROFESSIONAL);
  const [resourceForm, setResourceForm] = useState(EMPTY_RESOURCE);
  const [activityProfessionalForm, setActivityProfessionalForm] = useState(EMPTY_ACTIVITY_PROFESSIONAL);
  const [activityResourceForm, setActivityResourceForm] = useState(EMPTY_ACTIVITY_RESOURCE);

  async function loadData() {
    if (!canRead) return;
    setLoading(true);
    try {
      const out = await getFitnessDashboard();
      setDashboard({
        summary: out?.summary || {},
        classes: Array.isArray(out?.classes) ? out.classes : [],
        schedules: Array.isArray(out?.schedules) ? out.schedules : [],
        memberships: Array.isArray(out?.memberships) ? out.memberships : [],
        attendance: Array.isArray(out?.attendance) ? out.attendance : [],
        goals: Array.isArray(out?.goals) ? out.goals : [],
        checkins: Array.isArray(out?.checkins) ? out.checkins : [],
        waitingList: Array.isArray(out?.waitingList) ? out.waitingList : [],
        recentSchedules: Array.isArray(out?.recentSchedules) ? out.recentSchedules : [],
        retentionCandidates: Array.isArray(out?.retentionCandidates) ? out.retentionCandidates : [],
        upsellCandidates: Array.isArray(out?.upsellCandidates) ? out.upsellCandidates : [],
        professionals: Array.isArray(out?.professionals) ? out.professionals : [],
        resources: Array.isArray(out?.resources) ? out.resources : [],
        activityProfessionals: Array.isArray(out?.activityProfessionals) ? out.activityProfessionals : [],
        activityResources: Array.isArray(out?.activityResources) ? out.activityResources : [],
        schedulesByProfessional: Array.isArray(out?.schedulesByProfessional) ? out.schedulesByProfessional : [],
        schedulesByResource: Array.isArray(out?.schedulesByResource) ? out.schedulesByResource : [],
        idleResources: Array.isArray(out?.idleResources) ? out.idleResources : [],
        operationalConflicts: Array.isArray(out?.operationalConflicts) ? out.operationalConflicts : [],
        predictiveInsights: out?.predictiveInsights || null,
      });
    } catch (err) {
      showToast(`Falha ao carregar Fitness: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [canRead]);

  const classesById = useMemo(
    () => new Map((dashboard.classes || []).map((item) => [item.id, item])),
    [dashboard.classes],
  );

  async function withSave(action, successMessage, reset) {
    if (!canUpdate) {
      showToast('Sem permissão para editar Fitness.', 'warning');
      return;
    }
    setSaving(true);
    try {
      await action();
      if (typeof reset === 'function') reset();
      showToast(successMessage, 'success');
      await loadData();
    } catch (err) {
      showToast(err.message || 'Erro na operação Fitness', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!canRead) {
    return (
      <div className="support-page">
        <div className="p-8 text-center text-text-secondary">Sem permissão para acessar a vertical Fitness.</div>
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '12px', flexWrap: 'wrap' }}>
          <h1>Fitness Dashboard</h1>
          <div className="text-sm text-text-secondary">Turmas, capacidade, planos, attendance e check-in integrados ao kiosk e runtime atual.</div>
        </div>
        <div className="support-controls">
          <Button onClick={loadData} disabled={loading}>Atualizar</Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary">Carregando Fitness...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mb-6">
            <MetricCard label="Turmas Ativas" value={dashboard.summary.classesActive || 0} />
            <MetricCard label="Aulas Programadas" value={dashboard.summary.schedulesTotal || 0} />
            <MetricCard label="Planos Ativos" value={dashboard.summary.membershipsActive || 0} />
            <MetricCard label="Check-ins" value={dashboard.summary.checkinsTotal || 0} />
            <MetricCard label="Retenção" value={dashboard.summary.retentionCandidates || 0} help="Heurística baseada em última presença e plano ativo." />
            <MetricCard label="Fill Probability" value={dashboard.predictiveInsights?.fillProbability || 0} help="Heurística preditiva do runtime atual." />
            <MetricCard label="Upsell" value={dashboard.summary.upsellCandidates || 0} help="Membros perto do limite do plano." />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Turmas</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Nome" value={classForm.name} onChange={(e) => setClassForm((prev) => ({ ...prev, name: e.target.value }))} />
                <input className="input-field" placeholder="Instructor ID" value={classForm.instructorId} onChange={(e) => setClassForm((prev) => ({ ...prev, instructorId: e.target.value }))} />
                <input className="input-field" placeholder="Categoria" value={classForm.category} onChange={(e) => setClassForm((prev) => ({ ...prev, category: e.target.value }))} />
                <select className="input-field" value={classForm.operationMode} onChange={(e) => setClassForm((prev) => ({ ...prev, operationMode: e.target.value }))}>
                  <option value="group_class">group_class</option>
                  <option value="individual_session">individual_session</option>
                  <option value="semi_private_session">semi_private_session</option>
                  <option value="resource_booking">resource_booking</option>
                </select>
                <input className="input-field" type="number" min="1" placeholder="Duração" value={classForm.durationMinutes} onChange={(e) => setClassForm((prev) => ({ ...prev, durationMinutes: e.target.value }))} />
                <input className="input-field" type="number" min="1" placeholder="Capacidade padrão" value={classForm.defaultCapacity} onChange={(e) => setClassForm((prev) => ({ ...prev, defaultCapacity: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => createFitnessClass({
                    name: classForm.name,
                    instructorId: classForm.instructorId,
                    category: classForm.category,
                    operationMode: classForm.operationMode,
                    durationMinutes: Number(classForm.durationMinutes) || 60,
                    defaultCapacity: Number(classForm.defaultCapacity) || 1,
                    active: classForm.active,
                  }),
                  'Turma salva.',
                  () => setClassForm(EMPTY_CLASS),
                )} disabled={saving}>Adicionar turma</Button>
              </div>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.classes || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{item.name}</div>
                    <div className="text-sm text-text-secondary">{item.category || 'Sem categoria'} • {item.operationMode || 'group_class'} • {item.durationMinutes} min • capacidade {item.defaultCapacity}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Agenda por Turma</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <select className="input-field" value={scheduleForm.classId} onChange={(e) => setScheduleForm((prev) => ({ ...prev, classId: e.target.value }))}>
                  <option value="">Selecione uma turma</option>
                  {(dashboard.classes || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <input className="input-field" type="datetime-local" value={scheduleForm.startAt} onChange={(e) => setScheduleForm((prev) => ({ ...prev, startAt: e.target.value }))} />
                <input className="input-field" type="datetime-local" value={scheduleForm.endAt} onChange={(e) => setScheduleForm((prev) => ({ ...prev, endAt: e.target.value }))} />
                <input className="input-field" type="number" min="1" placeholder="Capacidade" value={scheduleForm.capacity} onChange={(e) => setScheduleForm((prev) => ({ ...prev, capacity: e.target.value }))} />
                <input className="input-field" placeholder="Local" value={scheduleForm.location} onChange={(e) => setScheduleForm((prev) => ({ ...prev, location: e.target.value }))} />
                <input className="input-field" placeholder="Profissionais (IDs csv)" value={scheduleForm.professionalIds} onChange={(e) => setScheduleForm((prev) => ({ ...prev, professionalIds: e.target.value }))} />
                <input className="input-field" placeholder="Recursos (IDs csv)" value={scheduleForm.resourceIds} onChange={(e) => setScheduleForm((prev) => ({ ...prev, resourceIds: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => createFitnessSchedule({
                    classId: scheduleForm.classId,
                    startAt: scheduleForm.startAt,
                    endAt: scheduleForm.endAt,
                    capacity: Number(scheduleForm.capacity) || 1,
                    location: scheduleForm.location,
                    status: scheduleForm.status,
                    professionalIds: String(scheduleForm.professionalIds || '').split(',').map((item) => item.trim()).filter(Boolean),
                    resourceIds: String(scheduleForm.resourceIds || '').split(',').map((item) => item.trim()).filter(Boolean),
                  }),
                  'Agenda salva.',
                  () => setScheduleForm(EMPTY_SCHEDULE),
                )} disabled={saving}>Adicionar aula</Button>
              </div>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.schedules || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{classesById.get(item.classId)?.name || item.classId}</div>
                    <div className="text-sm text-text-secondary">
                      {item.startAt || '-'} • vagas {item.remainingCapacity}/{item.capacity} • inscritos {item.bookedCount}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Profissionais Fitness</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Nome profissional" value={professionalForm.name} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, name: e.target.value }))} />
                <select className="input-field" value={professionalForm.roleType} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, roleType: e.target.value }))}>
                  <option value="instructor">instructor</option>
                  <option value="therapist">therapist</option>
                  <option value="coach">coach</option>
                  <option value="dancer_teacher">dancer_teacher</option>
                  <option value="personal_trainer">personal_trainer</option>
                </select>
                <input className="input-field" placeholder="Especialidades (csv)" value={professionalForm.specialties} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, specialties: e.target.value }))} />
                <input className="input-field" type="number" min="1" placeholder="Concorrência máx." value={professionalForm.maxConcurrentSessions} onChange={(e) => setProfessionalForm((prev) => ({ ...prev, maxConcurrentSessions: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => createFitnessProfessional({
                    name: professionalForm.name,
                    roleType: professionalForm.roleType,
                    specialties: String(professionalForm.specialties || '').split(',').map((item) => item.trim()).filter(Boolean),
                    maxConcurrentSessions: Number(professionalForm.maxConcurrentSessions) || 1,
                  }),
                  'Profissional salvo.',
                  () => setProfessionalForm(EMPTY_PROFESSIONAL),
                )} disabled={saving}>Salvar profissional</Button>
              </div>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.professionals || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{item.name}</div>
                    <div className="text-sm text-text-secondary">{item.roleType} • {(item.specialties || []).join(', ') || 'sem especialidades'}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Recursos</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Nome recurso" value={resourceForm.name} onChange={(e) => setResourceForm((prev) => ({ ...prev, name: e.target.value }))} />
                <select className="input-field" value={resourceForm.resourceType} onChange={(e) => setResourceForm((prev) => ({ ...prev, resourceType: e.target.value }))}>
                  <option value="room">room</option>
                  <option value="equipment">equipment</option>
                  <option value="station">station</option>
                  <option value="bed">bed</option>
                  <option value="studio_area">studio_area</option>
                </select>
                <input className="input-field" type="number" min="1" placeholder="Capacidade recurso" value={resourceForm.capacity} onChange={(e) => setResourceForm((prev) => ({ ...prev, capacity: e.target.value }))} />
                <input className="input-field" placeholder="Local do recurso" value={resourceForm.location} onChange={(e) => setResourceForm((prev) => ({ ...prev, location: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => createFitnessResource({
                    name: resourceForm.name,
                    resourceType: resourceForm.resourceType,
                    capacity: Number(resourceForm.capacity) || 1,
                    location: resourceForm.location,
                    exclusiveUse: resourceForm.exclusiveUse,
                  }),
                  'Recurso salvo.',
                  () => setResourceForm(EMPTY_RESOURCE),
                )} disabled={saving}>Salvar recurso</Button>
              </div>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.resources || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{item.name}</div>
                    <div className="text-sm text-text-secondary">{item.resourceType} • cap. {item.capacity} {item.location ? `• ${item.location}` : ''}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Atividade x Profissional</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <select className="input-field" value={activityProfessionalForm.activityId} onChange={(e) => setActivityProfessionalForm((prev) => ({ ...prev, activityId: e.target.value }))}>
                  <option value="">Turma/atividade</option>
                  {(dashboard.classes || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select className="input-field" value={activityProfessionalForm.professionalId} onChange={(e) => setActivityProfessionalForm((prev) => ({ ...prev, professionalId: e.target.value }))}>
                  <option value="">Profissional</option>
                  {(dashboard.professionals || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <input className="input-field" type="number" min="1" placeholder="Duração específica" value={activityProfessionalForm.durationMinutes} onChange={(e) => setActivityProfessionalForm((prev) => ({ ...prev, durationMinutes: e.target.value }))} />
                <input className="input-field" type="number" min="0" step="0.01" placeholder="Preço padrão" value={activityProfessionalForm.defaultPrice} onChange={(e) => setActivityProfessionalForm((prev) => ({ ...prev, defaultPrice: e.target.value }))} />
                <input className="input-field md:col-span-2" type="number" min="1" placeholder="Capacidade override" value={activityProfessionalForm.maxCapacityOverride} onChange={(e) => setActivityProfessionalForm((prev) => ({ ...prev, maxCapacityOverride: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => saveFitnessActivityProfessional({
                    activityId: activityProfessionalForm.activityId,
                    professionalId: activityProfessionalForm.professionalId,
                    durationMinutes: activityProfessionalForm.durationMinutes === '' ? null : Number(activityProfessionalForm.durationMinutes),
                    defaultPrice: activityProfessionalForm.defaultPrice === '' ? null : Number(activityProfessionalForm.defaultPrice),
                    maxCapacityOverride: activityProfessionalForm.maxCapacityOverride === '' ? null : Number(activityProfessionalForm.maxCapacityOverride),
                  }),
                  'Vínculo atividade-profissional salvo.',
                  () => setActivityProfessionalForm(EMPTY_ACTIVITY_PROFESSIONAL),
                )} disabled={saving}>Salvar vínculo</Button>
              </div>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.activityProfessionals || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{classesById.get(item.activityId)?.name || item.activityId}</div>
                    <div className="text-sm text-text-secondary">
                      profissional {dashboard.professionals.find((entry) => entry.id === item.professionalId)?.name || item.professionalId}
                      {item.durationMinutes ? ` • ${item.durationMinutes} min` : ''}
                      {item.maxCapacityOverride ? ` • cap ${item.maxCapacityOverride}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Atividade x Recurso</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <select className="input-field" value={activityResourceForm.activityId} onChange={(e) => setActivityResourceForm((prev) => ({ ...prev, activityId: e.target.value }))}>
                  <option value="">Turma/atividade</option>
                  {(dashboard.classes || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <select className="input-field" value={activityResourceForm.resourceId} onChange={(e) => setActivityResourceForm((prev) => ({ ...prev, resourceId: e.target.value }))}>
                  <option value="">Recurso</option>
                  {(dashboard.resources || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <input className="input-field" type="number" min="1" placeholder="Quantidade" value={activityResourceForm.quantity} onChange={(e) => setActivityResourceForm((prev) => ({ ...prev, quantity: e.target.value }))} />
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={activityResourceForm.exclusiveUse}
                    onChange={(e) => setActivityResourceForm((prev) => ({ ...prev, exclusiveUse: e.target.checked }))}
                  />
                  Uso exclusivo
                </label>
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => saveFitnessActivityResource({
                    activityId: activityResourceForm.activityId,
                    resourceId: activityResourceForm.resourceId,
                    quantity: Number(activityResourceForm.quantity) || 1,
                    exclusiveUse: activityResourceForm.exclusiveUse,
                  }),
                  'Vínculo atividade-recurso salvo.',
                  () => setActivityResourceForm(EMPTY_ACTIVITY_RESOURCE),
                )} disabled={saving}>Salvar vínculo</Button>
              </div>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.activityResources || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{classesById.get(item.activityId)?.name || item.activityId}</div>
                    <div className="text-sm text-text-secondary">
                      recurso {dashboard.resources.find((entry) => entry.id === item.resourceId)?.name || item.resourceId}
                      {item.quantity ? ` • qtd ${item.quantity}` : ''}
                      {item.exclusiveUse ? ' • exclusivo' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Agenda por Profissional</h2>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.schedulesByProfessional || []).map((entry) => (
                  <div key={entry.professional?.id || entry.professional?.name} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{entry.professional?.name || 'Profissional'}</div>
                    <div className="text-sm text-text-secondary">{entry.schedules?.length || 0} aula(s) vinculada(s)</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Agenda por Recurso</h2>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.schedulesByResource || []).map((entry) => (
                  <div key={entry.resource?.id || entry.resource?.name} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{entry.resource?.name || 'Recurso'}</div>
                    <div className="text-sm text-text-secondary">{entry.schedules?.length || 0} uso(s) agendado(s)</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Memberships</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Member ID" value={membershipForm.memberId} onChange={(e) => setMembershipForm((prev) => ({ ...prev, memberId: e.target.value }))} />
                <input className="input-field" placeholder="Plano" value={membershipForm.planName} onChange={(e) => setMembershipForm((prev) => ({ ...prev, planName: e.target.value }))} />
                <input className="input-field" type="date" value={membershipForm.startDate} onChange={(e) => setMembershipForm((prev) => ({ ...prev, startDate: e.target.value }))} />
                <input className="input-field" type="date" value={membershipForm.endDate} onChange={(e) => setMembershipForm((prev) => ({ ...prev, endDate: e.target.value }))} />
                <input className="input-field" placeholder="Turmas permitidas (IDs)" value={membershipForm.allowedClasses} onChange={(e) => setMembershipForm((prev) => ({ ...prev, allowedClasses: e.target.value }))} />
                <input className="input-field" placeholder="Categorias permitidas" value={membershipForm.allowedCategories} onChange={(e) => setMembershipForm((prev) => ({ ...prev, allowedCategories: e.target.value }))} />
                <input className="input-field" type="number" min="1" placeholder="Frequência semanal" value={membershipForm.allowedWeeklyFrequency} onChange={(e) => setMembershipForm((prev) => ({ ...prev, allowedWeeklyFrequency: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => createFitnessMembership({
                    memberId: membershipForm.memberId,
                    planName: membershipForm.planName,
                    startDate: membershipForm.startDate,
                    endDate: membershipForm.endDate || null,
                    allowedClasses: String(membershipForm.allowedClasses || '').split(',').map((item) => item.trim()).filter(Boolean),
                    allowedCategories: String(membershipForm.allowedCategories || '').split(',').map((item) => item.trim()).filter(Boolean),
                    allowedWeeklyFrequency: membershipForm.allowedWeeklyFrequency === '' ? null : Number(membershipForm.allowedWeeklyFrequency),
                    active: membershipForm.active,
                  }),
                  'Plano salvo.',
                  () => setMembershipForm(EMPTY_MEMBERSHIP),
                )} disabled={saving}>Salvar plano</Button>
              </div>
              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.memberships || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{item.memberId}</div>
                    <div className="text-sm text-text-secondary">
                      {item.planName} • {item.allowedWeeklyFrequency || '-'}x semana
                      {Array.isArray(item.allowedCategories) && item.allowedCategories.length > 0 ? ` • categorias: ${item.allowedCategories.join(', ')}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Attendance e Check-in</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <select className="input-field" value={attendanceForm.classScheduleId} onChange={(e) => setAttendanceForm((prev) => ({ ...prev, classScheduleId: e.target.value }))}>
                  <option value="">Aula</option>
                  {(dashboard.schedules || []).map((item) => <option key={item.id} value={item.id}>{classesById.get(item.classId)?.name || item.classId}</option>)}
                </select>
                <input className="input-field" placeholder="Member ID" value={attendanceForm.memberId} onChange={(e) => setAttendanceForm((prev) => ({ ...prev, memberId: e.target.value }))} />
                <select className="input-field" value={attendanceForm.status} onChange={(e) => setAttendanceForm((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="booked">booked</option>
                  <option value="checked_in">checked_in</option>
                  <option value="attended">attended</option>
                  <option value="no_show">no_show</option>
                  <option value="cancelled">cancelled</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={attendanceForm.autoJoinWaitingList}
                    onChange={(e) => setAttendanceForm((prev) => ({ ...prev, autoJoinWaitingList: e.target.checked }))}
                  />
                  Entrar na waiting list se lotar
                </label>
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => saveFitnessAttendance({
                    classScheduleId: attendanceForm.classScheduleId,
                    memberId: attendanceForm.memberId,
                    status: attendanceForm.status,
                    autoJoinWaitingList: attendanceForm.autoJoinWaitingList,
                  }),
                  attendanceForm.autoJoinWaitingList ? 'Reserva processada.' : 'Presença salva.',
                  () => setAttendanceForm(EMPTY_ATTENDANCE),
                )} disabled={saving}>Salvar presença</Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Member ID" value={checkinForm.memberId} onChange={(e) => setCheckinForm((prev) => ({ ...prev, memberId: e.target.value }))} />
                <select className="input-field" value={checkinForm.classScheduleId} onChange={(e) => setCheckinForm((prev) => ({ ...prev, classScheduleId: e.target.value }))}>
                  <option value="">Aula opcional</option>
                  {(dashboard.schedules || []).map((item) => <option key={item.id} value={item.id}>{classesById.get(item.classId)?.name || item.classId}</option>)}
                </select>
                <select className="input-field" value={checkinForm.source} onChange={(e) => setCheckinForm((prev) => ({ ...prev, source: e.target.value }))}>
                  <option value="manual">manual</option>
                  <option value="kiosk">kiosk</option>
                </select>
                <input className="input-field" placeholder="Kiosk code" value={checkinForm.kioskCode} onChange={(e) => setCheckinForm((prev) => ({ ...prev, kioskCode: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => createFitnessCheckin({
                    memberId: checkinForm.memberId,
                    classScheduleId: checkinForm.classScheduleId || null,
                    source: checkinForm.source,
                    kioskCode: checkinForm.kioskCode || 'default',
                  }),
                  'Check-in registrado.',
                  () => setCheckinForm(EMPTY_CHECKIN),
                )} disabled={saving}>Registrar check-in</Button>
              </div>

              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.checkins || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{item.memberId}</div>
                    <div className="text-sm text-text-secondary">{item.source} • {item.checkedInAt || '-'}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Metas</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <input className="input-field" placeholder="Member ID" value={goalForm.memberId} onChange={(e) => setGoalForm((prev) => ({ ...prev, memberId: e.target.value }))} />
                <input className="input-field" placeholder="Tipo da meta" value={goalForm.goalType} onChange={(e) => setGoalForm((prev) => ({ ...prev, goalType: e.target.value }))} />
                <input className="input-field md:col-span-2" placeholder="Valor alvo" value={goalForm.targetValue} onChange={(e) => setGoalForm((prev) => ({ ...prev, targetValue: e.target.value }))} />
              </div>
              <div className="flex gap-3 mb-5">
                <Button onClick={() => withSave(
                  () => createFitnessGoal({
                    memberId: goalForm.memberId,
                    goalType: goalForm.goalType,
                    targetValue: goalForm.targetValue,
                    active: goalForm.active,
                  }),
                  'Meta salva.',
                  () => setGoalForm(EMPTY_GOAL),
                )} disabled={saving}>Salvar meta</Button>
              </div>
              <div className="space-y-3 max-h-80 overflow-auto">
                {(dashboard.goals || []).map((item) => (
                  <div key={item.id} className="border border-border-default rounded-lg p-4">
                    <div className="font-semibold text-text-primary">{item.memberId}</div>
                    <div className="text-sm text-text-secondary">{item.goalType} • {item.targetValue || '-'}</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Retenção</h2>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.retentionCandidates || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Nenhum membro em risco pela heurística atual.</div>
                ) : (
                  dashboard.retentionCandidates.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.contact?.name || item.memberId}</div>
                      <div className="text-sm text-text-secondary">
                        {item.planName} • última presença {item.lastAttendanceAt || 'sem presença'} • {item.inactiveDays == null ? 'sem histórico' : `${item.inactiveDays} dias`}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Recursos Ociosos</h2>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.idleResources || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Sem recursos ociosos na leitura atual.</div>
                ) : (
                  dashboard.idleResources.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.name}</div>
                      <div className="text-sm text-text-secondary">{item.resourceType} • cap. {item.capacity}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Upsell de Plano</h2>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.upsellCandidates || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Nenhuma sugestão de upsell no momento.</div>
                ) : (
                  dashboard.upsellCandidates.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.memberId}</div>
                      <div className="text-sm text-text-secondary">
                        {item.planName} • {item.bookedCount} reserva(s) para limite {item.allowedWeeklyFrequency}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Waiting List Fitness</h2>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.waitingList || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Sem itens Fitness na waiting list.</div>
                ) : (
                  dashboard.waitingList.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.contact_id || item.contactId || 'Contato'}</div>
                      <div className="text-sm text-text-secondary">{item.service_type || item.serviceType || item.context_id || 'Turma não informada'}</div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Agendamentos Recentes</h2>
              <div className="space-y-3 max-h-96 overflow-auto">
                {(dashboard.recentSchedules || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Nenhum agendamento recente com contexto Fitness.</div>
                ) : (
                  dashboard.recentSchedules.map((item) => (
                    <div key={item.id} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{item.title || item.purpose || item.id}</div>
                      <div className="text-sm text-text-secondary">{item.start_at || item.startAt || '-'} • {item.status || 'sem status'}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6">
            <section className="bg-bg-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-lg font-semibold mb-4">Conflitos Operacionais</h2>
              <div className="space-y-3 max-h-72 overflow-auto">
                {(dashboard.operationalConflicts || []).length === 0 ? (
                  <div className="text-sm text-text-secondary">Nenhum conflito operacional materializado no dashboard.</div>
                ) : (
                  dashboard.operationalConflicts.map((item) => (
                    <div key={item.scheduleId} className="border border-border-default rounded-lg p-4">
                      <div className="font-semibold text-text-primary">{classesById.get(item.classId)?.name || item.classId}</div>
                      <div className="text-sm text-text-secondary">
                        {item.reason} • profissionais {item.professionalIds?.length || 0} • recursos {item.resourceIds?.length || 0}
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
