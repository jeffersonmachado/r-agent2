import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../hooks/useRouter';
import { listEngineeringTasks, createEngineeringTask } from '../api/engineeringRouter';
import { useToast } from '../components/Toast';

const TASK_TYPES = ['CODE_GENERATION', 'BUG_FIX', 'COMPLEX_BUG_FIX', 'REFACTOR', 'TEST_GENERATION', 'CODE_REVIEW', 'SECURITY_REVIEW', 'DATABASE_CHANGE', 'FRONTEND', 'DOCKER_INFRA', 'GOVERNANCE', 'RELEASE', 'REPOSITORY_AUDIT'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const STATUS_BADGE = {
  GREEN: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  RED: 'bg-red-500/15 text-red-500 border-red-500/30',
  BLOCKED: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  CANCELLED: 'bg-bg-elevated text-text-secondary border-border-default',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium border ${STATUS_BADGE[status] || 'bg-blue-500/15 text-blue-500 border-blue-500/30'}`}>
      {status}
    </span>
  );
}

function NewTaskForm({ onCreated, onCancel }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({ title: '', objective: '', taskType: '', risk: '', allowedPaths: '', testCommands: '' });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        objective: form.objective || undefined,
        taskType: form.taskType || undefined,
        risk: form.risk || undefined,
        allowedPaths: form.allowedPaths ? form.allowedPaths.split('\n').map((s) => s.trim()).filter(Boolean) : [],
        testCommands: form.testCommands ? form.testCommands.split('\n').map((s) => s.trim()).filter(Boolean) : [],
      };
      const task = await createEngineeringTask(payload);
      showToast?.('Task criada', 'success');
      onCreated(task);
    } catch (err) {
      showToast?.(err.message || 'Falha ao criar task', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-bg-elevated rounded-xl border border-border-default p-5 mb-6 space-y-3">
      <h3 className="text-sm font-bold text-text-primary">Nova Engineering Task</h3>
      <input
        required
        placeholder="Título"
        value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
      />
      <textarea
        placeholder="Objetivo (o que precisa ser corrigido/implementado)"
        value={form.objective}
        onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
        rows={2}
      />
      <div className="grid grid-cols-2 gap-3">
        <select
          value={form.taskType}
          onChange={(e) => setForm((f) => ({ ...f, taskType: e.target.value }))}
          className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
        >
          <option value="">taskType (auto)</option>
          {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={form.risk}
          onChange={(e) => setForm((f) => ({ ...f, risk: e.target.value }))}
          className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary"
        >
          <option value="">risk (auto)</option>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <textarea
        placeholder="allowedPaths (um glob por linha, ex: src/foo.js)"
        value={form.allowedPaths}
        onChange={(e) => setForm((f) => ({ ...f, allowedPaths: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary font-mono"
        rows={2}
      />
      <textarea
        placeholder="testCommands (um comando por linha, ex: npm run test:unit -- --testPathPattern=foo)"
        value={form.testCommands}
        onChange={(e) => setForm((f) => ({ ...f, testCommands: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary font-mono"
        rows={2}
      />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-border-default text-sm text-text-secondary">Cancelar</button>
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Criando…' : 'Criar Task'}
        </button>
      </div>
    </form>
  );
}

export function EngineeringTasksPage() {
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ status: '', risk: '', taskType: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listEngineeringTasks(filters);
      setTasks(result.tasks || []);
    } catch (err) {
      showToast?.(err.message || 'Falha ao listar tasks', 'error');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ToastContainer />
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Engineering Tasks</h1>
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? 'Fechar' : '+ Nova Task'}
        </button>
      </div>

      {showForm && (
        <NewTaskForm
          onCreated={(task) => { setShowForm(false); navigate(`/dev/engineering/tasks/${task.id}`); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="flex gap-3 mb-4">
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary">
          <option value="">Todos os status</option>
          {['CREATED', 'CLASSIFIED', 'ROUTED', 'CODING', 'TESTING', 'REVIEWING', 'REGRESSION', 'GOVERNANCE', 'GREEN', 'RED', 'BLOCKED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.risk} onChange={(e) => setFilters((f) => ({ ...f, risk: e.target.value }))} className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary">
          <option value="">Todos os riscos</option>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={filters.taskType} onChange={(e) => setFilters((f) => ({ ...f, taskType: e.target.value }))} className="px-3 py-2 rounded-lg border border-border-default bg-bg-primary text-sm text-text-primary">
          <option value="">Todos os tipos</option>
          {TASK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default overflow-x-auto">
        {loading ? (
          <div className="p-6 text-sm text-text-secondary">Carregando…</div>
        ) : tasks.length === 0 ? (
          <div className="p-6 text-sm text-text-secondary">Nenhuma task encontrada.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-text-secondary">
                <th className="p-3">Título</th>
                <th className="p-3">Tipo</th>
                <th className="p-3">Risco</th>
                <th className="p-3">Coder</th>
                <th className="p-3">Reviewer</th>
                <th className="p-3">Status</th>
                <th className="p-3">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  onClick={() => navigate(`/dev/engineering/tasks/${task.id}`)}
                  className="border-b border-border-default last:border-0 hover:bg-bg-subtle cursor-pointer"
                >
                  <td className="p-3 text-text-primary font-medium">{task.title}</td>
                  <td className="p-3 text-text-secondary">{task.task_type}</td>
                  <td className="p-3 text-text-secondary">{task.risk}</td>
                  <td className="p-3 text-text-secondary">{task.routing_decision?.coder?.selected ? `${task.routing_decision.coder.selected.providerId}:${task.routing_decision.coder.selected.modelId}` : '—'}</td>
                  <td className="p-3 text-text-secondary">{task.routing_decision?.reviewer?.selected ? `${task.routing_decision.reviewer.selected.providerId}:${task.routing_decision.reviewer.selected.modelId}` : '—'}</td>
                  <td className="p-3"><StatusBadge status={task.status} /></td>
                  <td className="p-3 text-text-secondary">{task.updatedAt ? new Date(task.updatedAt).toLocaleString('pt-BR') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default EngineeringTasksPage;
