import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import { useToast } from '../components/Toast';
import { Button } from '../styles/Button';
import {
  getSupervisorMetrics,
  getSupervisorAgentsStatus,
  getSupervisorQueuesStatus,
} from '../api/supervisor';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

export function SupervisorPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  const [groupBy, setGroupBy] = useState('agent');
  const [period, setPeriod] = useState('day');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [metrics, setMetrics] = useState([]);
  const [summary, setSummary] = useState(null);
  const [agents, setAgents] = useState([]);
  const [queues, setQueues] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  const formatSeconds = (sec) => {
    if (sec === null || sec === undefined) return '-';
    const n = Number(sec);
    if (!Number.isFinite(n)) return '-';
    if (n < 60) return `${Math.round(n)}s`;
    const m = Math.floor(n / 60);
    const s = Math.round(n % 60);
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  };

  const formatPct = (x) => {
    if (x === null || x === undefined) return '-';
    const n = Number(x);
    if (!Number.isFinite(n)) return '-';
    return `${(n * 100).toFixed(1)}%`;
  };

  const downloadCsv = (filename, columns, rows) => {
    const escapeCsv = (value) => {
      if (value === null || value === undefined) return '';
      const text = String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const header = columns.map((c) => escapeCsv(c.label)).join(',');
    const body = rows.map((row) => columns.map((c) => escapeCsv(row[c.key])).join(',')).join('\n');
    const csv = `${header}\n${body}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportMetricsCsv = () => {
    const rows = (metricsRows || []).map((row) => ({
      period: row.period,
      groupLabel: row.groupLabel || row.groupKey,
      totalTickets: row.totalTickets ?? 0,
      openTickets: row.openTickets ?? 0,
      waitingTickets: row.waitingTickets ?? 0,
      inProgressTickets: row.inProgressTickets ?? 0,
      closedTickets: row.closedTickets ?? 0,
      avgFirstResponseTimeSeconds: row.avgFirstResponseTimeSeconds ?? '',
      avgHandlingTimeSeconds: row.avgHandlingTimeSeconds ?? '',
      abandonmentRate: row.abandonmentRate ?? '',
    }));
    downloadCsv(
      `supervisor-metrics-${groupBy}-${period}.csv`,
      [
        { key: 'period', label: 'periodo' },
        { key: 'groupLabel', label: groupBy === 'agent' ? 'agente' : 'fila' },
        { key: 'totalTickets', label: 'total_tickets' },
        { key: 'openTickets', label: 'abertos' },
        { key: 'waitingTickets', label: 'waiting' },
        { key: 'inProgressTickets', label: 'in_progress' },
        { key: 'closedTickets', label: 'fechados' },
        { key: 'avgFirstResponseTimeSeconds', label: 'tme_segundos' },
        { key: 'avgHandlingTimeSeconds', label: 'tma_segundos' },
        { key: 'abandonmentRate', label: 'abandono_rate' },
      ],
      rows,
    );
    showToast('CSV de métricas exportado', 'success');
  };

  const exportAgentsCsv = () => {
    const rows = (agents || []).map((row) => ({
      agentName: row.agentName || '',
      status: row.status || '',
      activeTickets: row.activeTickets ?? 0,
      inProgressTickets: row.inProgressTickets ?? 0,
      waitingTickets: row.waitingTickets ?? 0,
      lastActivity: row.lastActivity || '',
    }));
    downloadCsv(
      'supervisor-agents-status.csv',
      [
        { key: 'agentName', label: 'agente' },
        { key: 'status', label: 'status' },
        { key: 'activeTickets', label: 'ativos' },
        { key: 'inProgressTickets', label: 'in_progress' },
        { key: 'waitingTickets', label: 'waiting' },
        { key: 'lastActivity', label: 'ultima_atividade' },
      ],
      rows,
    );
    showToast('CSV de agentes exportado', 'success');
  };

  const exportQueuesCsv = () => {
    const rows = (queues || []).map((row) => ({
      queueName: row.queueName || '',
      activeTickets: row.activeTickets ?? 0,
      waitingTickets: row.waitingTickets ?? 0,
      inProgressTickets: row.inProgressTickets ?? 0,
      closedTickets: row.closedTickets ?? 0,
      oldestWaitingAt: row.oldestWaitingAt || '',
    }));
    downloadCsv(
      'supervisor-queues-status.csv',
      [
        { key: 'queueName', label: 'fila' },
        { key: 'activeTickets', label: 'ativos' },
        { key: 'waitingTickets', label: 'waiting' },
        { key: 'inProgressTickets', label: 'in_progress' },
        { key: 'closedTickets', label: 'fechados' },
        { key: 'oldestWaitingAt', label: 'mais_antigo' },
      ],
      rows,
    );
    showToast('CSV de filas exportado', 'success');
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [metricsResp, agentsResp, queuesResp] = await Promise.all([
        getSupervisorMetrics({
          groupBy,
          period,
          from: from || undefined,
          to: to || undefined,
        }),
        getSupervisorAgentsStatus(),
        getSupervisorQueuesStatus(),
      ]);

      setMetrics(Array.isArray(metricsResp?.items) ? metricsResp.items : []);
      setSummary(metricsResp?.summary || null);
      setAgents(Array.isArray(agentsResp?.agents) ? agentsResp.agents : []);
      setQueues(Array.isArray(queuesResp?.queues) ? queuesResp.queues : []);
    } catch (err) {
      logger.error('[Supervisor] Erro ao carregar métricas', err);
      showToast('Erro ao carregar painel supervisor', 'error');
    } finally {
      setLoading(false);
    }
  }, [from, groupBy, period, showToast, to]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      loadData();
    }
  }, [authLoading, isAuthenticated, loadData]);

  const metricsRows = useMemo(() => metrics || [], [metrics]);
  const queueLoad = useMemo(() => {
    const items = Array.isArray(queues) ? queues : [];
    return items
      .map((q) => ({ label: q.queueName, value: Number(q.activeTickets) || 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [queues]);
  const agentLoad = useMemo(() => {
    const items = Array.isArray(agents) ? agents : [];
    return items
      .map((a) => ({ label: a.agentName, value: Number(a.activeTickets) || 0 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [agents]);
  const maxQueueLoad = queueLoad.reduce((acc, item) => Math.max(acc, item.value), 0) || 1;
  const maxAgentLoad = agentLoad.reduce((acc, item) => Math.max(acc, item.value), 0) || 1;

  if (authLoading) {
    return (
      <CrudPageBase>
        <div className="page-loading">
          <p>Carregando...</p>
        </div>
      </CrudPageBase>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <h1>📊 Painel Supervisor</h1>
        <div className="support-controls" style={{ flexWrap: 'wrap' }}>
          <label>
            Agrupar por
            <select
              className="support-form-select"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
            >
              <option value="agent">Agente</option>
              <option value="queue">Fila</option>
            </select>
          </label>
          <label>
            Período
            <select
              className="support-form-select"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="day">Dia</option>
              <option value="hour">Hora</option>
            </select>
          </label>
          <label>
            De
            <input
              className="support-form-input"
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Até
            <input
              className="support-form-input"
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <Button onClick={loadData} disabled={loading} className="support-button">
            Atualizar
          </Button>
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
          <div className="support-details-title">Resumo</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            <div className="support-card">
              <div className="support-card-label">TME</div>
              <div className="support-card-value">{formatSeconds(summary?.avgFirstResponseTimeSeconds)}</div>
            </div>
            <div className="support-card">
              <div className="support-card-label">TMA</div>
              <div className="support-card-value">{formatSeconds(summary?.avgHandlingTimeSeconds)}</div>
            </div>
            <div className="support-card">
              <div className="support-card-label">Abandono</div>
              <div className="support-card-value">{formatPct(summary?.abandonmentRate)}</div>
            </div>
            <div className="support-card">
              <div className="support-card-label">Tickets Abertos</div>
              <div className="support-card-value">{summary?.openTickets ?? '-'}</div>
            </div>
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Métricas por {groupBy === 'agent' ? 'Agente' : 'Fila'}</div>
          <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={exportMetricsCsv} className="support-button" disabled={metricsRows.length === 0}>
              Exportar CSV (Métricas)
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="support-table">
              <thead>
                <tr>
                  <th>Período</th>
                  <th>{groupBy === 'agent' ? 'Agente' : 'Fila'}</th>
                  <th>Total</th>
                  <th>Abertos</th>
                  <th>Waiting</th>
                  <th>In Progress</th>
                  <th>Fechados</th>
                  <th>TME</th>
                  <th>TMA</th>
                  <th>Abandono</th>
                </tr>
              </thead>
              <tbody>
                {metricsRows.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                      Nenhum dado disponível
                    </td>
                  </tr>
                )}
                {metricsRows.map((row) => (
                  <tr key={`${row.period}-${row.groupKey}`}>
                    <td>{row.period}</td>
                    <td>{row.groupLabel || row.groupKey}</td>
                    <td>{row.totalTickets}</td>
                    <td>{row.openTickets}</td>
                    <td>{row.waitingTickets}</td>
                    <td>{row.inProgressTickets}</td>
                    <td>{row.closedTickets}</td>
                    <td>{formatSeconds(row.avgFirstResponseTimeSeconds)}</td>
                    <td>{formatSeconds(row.avgHandlingTimeSeconds)}</td>
                    <td>{formatPct(row.abandonmentRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Status dos Agentes</div>
          <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={exportAgentsCsv} className="support-button" disabled={agents.length === 0}>
              Exportar CSV (Agentes)
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="support-table">
              <thead>
                <tr>
                  <th>Agente</th>
                  <th>Status</th>
                  <th>Ativos</th>
                  <th>In Progress</th>
                  <th>Waiting</th>
                  <th>Última atividade</th>
                </tr>
              </thead>
              <tbody>
                {agents.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                      Nenhum agente disponível
                    </td>
                  </tr>
                )}
                {agents.map((row) => (
                  <tr key={row.agentId}>
                    <td>{row.agentName}</td>
                    <td>{row.status}</td>
                    <td>{row.activeTickets}</td>
                    <td>{row.inProgressTickets}</td>
                    <td>{row.waitingTickets}</td>
                    <td>{row.lastActivity ? new Date(row.lastActivity).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Status das Filas</div>
          <div style={{ marginBottom: '10px', display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={exportQueuesCsv} className="support-button" disabled={queues.length === 0}>
              Exportar CSV (Filas)
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="support-table">
              <thead>
                <tr>
                  <th>Fila</th>
                  <th>Ativos</th>
                  <th>Waiting</th>
                  <th>In Progress</th>
                  <th>Fechados</th>
                  <th>Mais antigo</th>
                </tr>
              </thead>
              <tbody>
                {queues.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                      Nenhuma fila disponível
                    </td>
                  </tr>
                )}
                {queues.map((row) => (
                  <tr key={row.queueName}>
                    <td>{row.queueName}</td>
                    <td>{row.activeTickets}</td>
                    <td>{row.waitingTickets}</td>
                    <td>{row.inProgressTickets}</td>
                    <td>{row.closedTickets}</td>
                    <td>{row.oldestWaitingAt ? new Date(row.oldestWaitingAt).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="support-details-panel">
          <div className="support-details-title">Carga Operacional (Top 6)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>Filas</div>
              {queueLoad.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)' }}>Sem dados</div>
              ) : queueLoad.map((item, i) => (
                <div key={`queue-${i}-${item.label}`} className="mb-2">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                  <div style={{ height: '8px', background: 'var(--color-accent-light)', borderRadius: '6px' }}>
                    <div
                      style={{
                        width: `${Math.max(6, Math.round((item.value / maxQueueLoad) * 100))}%`,
                        height: '100%',
                        background: 'var(--color-accent-primary)',
                        borderRadius: '6px',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '8px' }}>Agentes</div>
              {agentLoad.length === 0 ? (
                <div style={{ color: 'var(--color-text-tertiary)' }}>Sem dados</div>
              ) : agentLoad.map((item, i) => (
                <div key={`agent-${i}-${item.label}`} className="mb-2">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                  <div style={{ height: '8px', background: 'var(--qa-warning-muted)', borderRadius: '6px' }}>
                    <div
                      style={{
                        width: `${Math.max(6, Math.round((item.value / maxAgentLoad) * 100))}%`,
                        height: '100%',
                        background: 'var(--color-status-warning)',
                        borderRadius: '6px',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <ToastContainer />
    </CrudPageBase>
  );
}
