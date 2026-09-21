import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from '../hooks/useRouter';
import { getEngineeringOverview } from '../api/engineeringRouter';
import { useToast } from '../components/Toast';

const STATUS_BADGE = {
  GREEN: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  RED: 'bg-red-500/15 text-red-500 border-red-500/30',
  BLOCKED: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  CANCELLED: 'bg-bg-elevated text-text-secondary border-border-default',
};

function StatCard({ label, value, tone }) {
  return (
    <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
      <div className="text-sm text-text-secondary mb-1">{label}</div>
      <div className={`text-3xl font-bold ${tone || 'text-text-primary'}`}>{value}</div>
    </div>
  );
}

export function EngineeringOverviewPage() {
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getEngineeringOverview();
      setData(result);
    } catch (err) {
      setError(err.message || 'Falha ao carregar overview');
      showToast?.(err.message || 'Falha ao carregar overview', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const totals = data?.totals || { total: 0, green: 0, red: 0, running: 0, blocked: 0, releaseBlockers: 0 };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <ToastContainer />
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">⚙️ Engineering Model Router</h1>
          <p className="text-sm text-text-secondary mt-1">
            Roteamento determinístico de CODER/REVIEWER · patch real · testes reais · V1 (policy-based, sem aprendizado adaptativo).
          </p>
        </div>
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          onClick={() => navigate('/dev/engineering/tasks')}
        >
          Ver Tasks
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-500">{error}</div>
      )}

      {loading ? (
        <div className="text-text-secondary text-sm">Carregando…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <StatCard label="Total de Tasks" value={totals.total} />
            <StatCard label="GREEN" value={totals.green} tone="text-emerald-500" />
            <StatCard label="RED" value={totals.red} tone="text-red-500" />
            <StatCard label="Em execução" value={totals.running} tone="text-blue-500" />
            <StatCard label="Bloqueadas" value={totals.blocked} tone="text-amber-500" />
            <StatCard label="Release Blockers" value={totals.releaseBlockers} tone="text-amber-500" />
          </div>

          <div className="bg-bg-elevated rounded-xl border border-border-default p-5">
            <h2 className="text-lg font-bold text-text-primary mb-4">Tasks ativas</h2>
            {(!data?.activeTasks || data.activeTasks.length === 0) ? (
              <div className="text-sm text-text-secondary">Nenhuma task em execução no momento.</div>
            ) : (
              <div className="space-y-2">
                {data.activeTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => navigate(`/dev/engineering/tasks/${task.id}`)}
                    className="w-full text-left flex items-center justify-between p-3 rounded-lg border border-border-default hover:bg-bg-subtle transition-colors"
                  >
                    <div>
                      <div className="text-sm font-medium text-text-primary">{task.title}</div>
                      <div className="text-xs text-text-secondary">{task.task_type} · {task.risk}</div>
                    </div>
                    <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium border ${STATUS_BADGE[task.status] || 'bg-blue-500/15 text-blue-500 border-blue-500/30'}`}>
                      {task.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default EngineeringOverviewPage;
