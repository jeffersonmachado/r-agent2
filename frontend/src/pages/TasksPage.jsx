import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import { Input } from '../styles/Input';
import { createTask, listTasks, completeTask, scheduleTaskReminder } from '../api/tasks';
import logger from '../utils/logger';

const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

function toDayKey(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
}

function isOverdueTask(task) {
  if (!task?.dueAt || (task.status || 'open') === 'completed') return false;
  const due = new Date(task.dueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

function buildMonthGrid(currentMonth) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const days = [];
  for (let cell = 0; cell < totalCells; cell += 1) {
    const dayNumber = cell - firstWeekday + 1;
    const current = new Date(year, month, dayNumber);
    const inCurrentMonth = dayNumber >= 1 && dayNumber <= daysInMonth;
    days.push({
      key: toDayKey(current),
      date: current,
      dayNumber: current.getDate(),
      inCurrentMonth,
    });
  }
  return days;
}

export function TasksPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({ title: '', description: '', dueAt: '', priority: 'normal' });
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDayKey, setSelectedDayKey] = useState(toDayKey(new Date()));

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  async function load() {
    setLoading(true);
    try {
      const out = await listTasks();
      setTasks(Array.isArray(out?.tasks) ? out.tasks : []);
    } catch (err) {
      logger.error('[Tasks] erro ao carregar', err);
      showToast('Erro ao carregar tarefas', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      load();
    }
  }, [authLoading, isAuthenticated]);

  async function handleCreate() {
    if (!form.title.trim()) {
      showToast('Informe um título', 'warning');
      return;
    }
    setLoading(true);
    try {
      await createTask({
        title: form.title.trim(),
        description: form.description.trim(),
        dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null,
        priority: form.priority,
      });
      setForm({ title: '', description: '', dueAt: '', priority: 'normal' });
      await load();
      showToast('Tarefa criada', 'success');
    } catch (err) {
      showToast('Erro ao criar tarefa', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleComplete(id) {
    setLoading(true);
    try {
      await completeTask(id);
      await load();
      showToast('Tarefa concluída', 'success');
    } catch (err) {
      showToast('Erro ao concluir tarefa', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleReminder(task) {
    if (!task?.dueAt) {
      showToast('Defina um prazo para agendar lembrete', 'warning');
      return;
    }
    setLoading(true);
    try {
      await scheduleTaskReminder(task.id, { reminderAt: task.dueAt });
      await load();
      showToast('Lembrete agendado', 'success');
    } catch (err) {
      showToast('Erro ao agendar lembrete', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleReminderPreset(task, offsetMs, label) {
    if (!task?.dueAt) {
      showToast('Defina um prazo para usar lembrete avançado', 'warning');
      return;
    }
    const due = new Date(task.dueAt);
    if (Number.isNaN(due.getTime())) {
      showToast('Prazo inválido na tarefa', 'error');
      return;
    }
    const reminderDate = new Date(due.getTime() - offsetMs);
    if (reminderDate.getTime() <= Date.now()) {
      showToast(`Não foi possível agendar "${label}" porque a data já passou`, 'warning');
      return;
    }

    setLoading(true);
    try {
      await scheduleTaskReminder(task.id, { reminderAt: reminderDate.toISOString() });
      await load();
      showToast(`Lembrete "${label}" agendado`, 'success');
    } catch (err) {
      showToast('Erro ao agendar lembrete', 'error');
    } finally {
      setLoading(false);
    }
  }

  const openTasks = useMemo(() => tasks.filter((t) => (t.status || 'open') !== 'completed'), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => (t.status || '') === 'completed'), [tasks]);
  const dayCounts = useMemo(() => {
    const map = {};
    for (const task of openTasks) {
      const key = toDayKey(task?.dueAt);
      if (!key) continue;
      map[key] = (map[key] || 0) + 1;
    }
    return map;
  }, [openTasks]);
  const calendarDays = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);
  const selectedDayTasks = useMemo(
    () => openTasks.filter((task) => toDayKey(task?.dueAt) === selectedDayKey),
    [openTasks, selectedDayKey],
  );

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }
  if (!isAuthenticated) return null;

  return (
    <div className="support-page">
      <ToastContainer />
      <div className="support-header">
        <h1>✅ Tarefas & Lembretes</h1>
        <div className="support-controls" style={{ gap: '12px' }}>
          <Button onClick={load} disabled={loading} className="support-button">Atualizar</Button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      <div className="support-grid" style={{ gridTemplateColumns: '1fr', gap: '16px' }}>
        <div className="support-details-panel">
          <div className="support-details-title">Nova tarefa</div>
          <div className="support-form-group">
            <label className="support-form-label">Título</label>
            <Input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Descrição</label>
            <Input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Prazo</label>
            <Input type="datetime-local" value={form.dueAt} onChange={(e) => setForm((p) => ({ ...p, dueAt: e.target.value }))} />
          </div>
          <div className="support-form-group">
            <label className="support-form-label">Prioridade</label>
            <select
              value={form.priority}
              onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}
              className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary"
            >
              <option value="low">baixa</option>
              <option value="normal">normal</option>
              <option value="high">alta</option>
            </select>
          </div>
          <Button onClick={handleCreate} className="support-button-full" disabled={loading}>Criar tarefa</Button>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Calendário operacional</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <Button
              style={{ width: 'auto' }}
              onClick={() => setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))}
              disabled={loading}
            >
              ←
            </Button>
            <div className="text-sm font-semibold text-text-primary">
              {currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
            </div>
            <Button
              style={{ width: 'auto' }}
              onClick={() => setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))}
              disabled={loading}
            >
              →
            </Button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: '6px',
            }}
          >
            {WEEK_DAYS.map((weekDay) => (
              <div key={weekDay} className="text-xs text-text-tertiary" style={{ textAlign: 'center', fontWeight: 600 }}>
                {weekDay}
              </div>
            ))}
            {calendarDays.map((day) => {
              const count = dayCounts[day.key] || 0;
              const isSelected = day.key === selectedDayKey;
              return (
                <button
                  key={`${day.key}-${day.dayNumber}`}
                  type="button"
                  onClick={() => setSelectedDayKey(day.key)}
                  style={{
                    minHeight: '46px',
                    border: `1px solid ${isSelected ? 'var(--brand-primary)' : 'var(--border-default)'}`,
                    borderRadius: '8px',
                    background: day.inCurrentMonth ? 'var(--bg-secondary)' : 'var(--bg-tertiary)',
                    color: day.inCurrentMonth ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <span className="text-xs">{day.dayNumber}</span>
                  {count > 0 && (
                    <span
                      className="text-xs"
                      style={{
                        marginTop: '2px',
                        background: 'var(--brand-primary)',
                        color: 'white',
                        borderRadius: '999px',
                        minWidth: '16px',
                        padding: '0 5px',
                        lineHeight: '16px',
                      }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-text-tertiary" style={{ marginTop: '10px' }}>
            Agenda do dia: {selectedDayKey || '-'} ({selectedDayTasks.length} tarefa(s) aberta(s))
          </div>
          <div className="space-y-2" style={{ marginTop: '8px' }}>
            {selectedDayTasks.length === 0 ? (
              <div className="text-xs text-text-tertiary">Sem tarefas abertas com prazo para este dia.</div>
            ) : (
              selectedDayTasks.map((task) => (
                <div key={`agenda-${task.id}`} className="p-2 rounded-lg border border-border-default bg-bg-tertiary">
                  <div className="text-sm font-semibold text-text-primary">{task.title}</div>
                  <div className="text-xs text-text-tertiary">
                    Prazo: {formatDateTime(task.dueAt)} | Prioridade: {task.priority || 'normal'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Abertas</div>
          {openTasks.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma tarefa em aberto.</div>
          ) : (
            <div className="space-y-3">
              {openTasks.map((t) => (
                <div key={t.id} className="p-3 rounded-lg border border-border-default bg-bg-tertiary">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{t.title}</div>
                      <div className="text-xs text-text-tertiary">{t.description || '-'}</div>
                      {isOverdueTask(t) && (
                        <div className="text-xs" style={{ color: 'var(--status-error)', marginTop: '4px' }}>
                          Atrasada
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => handleReminder(t)} style={{ width: 'auto' }} disabled={loading}>
                        Lembrar
                      </Button>
                      <Button onClick={() => handleComplete(t.id)} style={{ width: 'auto' }} disabled={loading}>
                        Concluir
                      </Button>
                    </div>
                  </div>
                  <div className="text-xs text-text-tertiary mt-2">
                    <div><strong>Prazo</strong>: {formatDateTime(t.dueAt)}</div>
                    <div><strong>Lembrete</strong>: {formatDateTime(t.reminderAt)}</div>
                    <div><strong>Prioridade</strong>: {t.priority || 'normal'}</div>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button style={{ width: 'auto' }} disabled={loading} onClick={() => handleReminderPreset(t, 15 * 60 * 1000, '15 min antes')}>
                      15m
                    </Button>
                    <Button style={{ width: 'auto' }} disabled={loading} onClick={() => handleReminderPreset(t, 60 * 60 * 1000, '1h antes')}>
                      1h
                    </Button>
                    <Button style={{ width: 'auto' }} disabled={loading} onClick={() => handleReminderPreset(t, 24 * 60 * 60 * 1000, '1 dia antes')}>
                      1d
                    </Button>
                    <Button style={{ width: 'auto' }} disabled={loading} onClick={() => handleReminderPreset(t, 0, 'no prazo')}>
                      No prazo
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Concluídas</div>
          {doneTasks.length === 0 ? (
            <div className="text-text-tertiary">Nenhuma tarefa concluída.</div>
          ) : (
            <div className="space-y-3">
              {doneTasks.map((t) => (
                <div key={t.id} className="p-3 rounded-lg border border-border-default bg-bg-tertiary">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-primary">{t.title}</div>
                      <div className="text-xs text-text-tertiary">{t.description || '-'}</div>
                    </div>
                    <span className="text-xs text-text-tertiary">✅</span>
                  </div>
                  <div className="text-xs text-text-tertiary mt-2">
                    <div><strong>Concluída em</strong>: {formatDateTime(t.completedAt)}</div>
                    <div><strong>Prazo</strong>: {formatDateTime(t.dueAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
