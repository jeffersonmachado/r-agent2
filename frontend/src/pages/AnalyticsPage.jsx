import React, { useState, useEffect } from 'react';
import { getAllMetrics, getAgentMetrics, getDepartmentMetrics, getQueueMetrics, getTrendMetrics } from '../api/analytics';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import logger from '../utils/logger';

export function AnalyticsPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();
  
  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadMetrics();
    }
  }, [dateRange, isAuthenticated]);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      const options = {};
      if (dateRange.startDate) options.startDate = dateRange.startDate;
      if (dateRange.endDate) options.endDate = dateRange.endDate;
      
      const data = await getAllMetrics(options);
      setMetrics(data);
    } catch (error) {
      logger.error('Erro ao carregar métricas:', error);
      showToast('Erro ao carregar métricas', 'error');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (minutes) => {
    if (!minutes) return '0 min';
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}min`;
  };

  const formatSeconds = (seconds) => {
    if (seconds === null || seconds === undefined) return '-';
    const s = Number(seconds);
    if (!Number.isFinite(s) || s < 0) return '-';
    const mins = Math.round(s / 60);
    return formatTime(mins);
  };

  const formatRate = (rate) => {
    if (rate === null || rate === undefined) return '-';
    const r = Number(rate);
    if (!Number.isFinite(r)) return '-';
    return `${Math.round(r * 100)}%`;
  };

  if (authLoading) {
    return (
      <div className="support-page">
        <div style={{ padding: '40px', textAlign: 'center' }}>
          <p>Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  if (loading && !metrics) {
    return (
      <div className="support-page">
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>📈 Analytics & Métricas</h1>
          </div>
        </div>
        <div className="text-center py-12">
          <p className="text-text-secondary">Carregando métricas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="support-page">
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📈 Analytics & Métricas</h1>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Dashboard com KPIs e indicadores em tempo real
        </p>
      </div>

        {/* Filtros de Data */}
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
          <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
            <span>🔍</span>
            <span>Filtros</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Data Inicial
              </label>
              <input
                type="date"
                value={dateRange.startDate}
                onChange={(e) => setDateRange({ ...dateRange, startDate: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block mb-2 text-sm font-medium text-text-primary">
                Data Final
              </label>
              <input
                type="date"
                value={dateRange.endDate}
                onChange={(e) => setDateRange({ ...dateRange, endDate: e.target.value })}
                className="w-full px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all"
              />
            </div>
          </div>
        </div>

        {metrics && (
          <>
            {/* Métricas Gerais */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Total de Tickets</div>
                <div className="text-3xl font-bold text-text-primary">
                  {metrics.general?.totalTickets || 0}
                </div>
              </div>
              
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Tickets Abertos</div>
                <div className="text-3xl font-bold text-status-warning">
                  {metrics.general?.openTickets || 0}
                </div>
              </div>
              
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Tickets Fechados</div>
                <div className="text-3xl font-bold text-status-success">
                  {metrics.general?.closedTickets || 0}
                </div>
              </div>
              
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Tempo Médio de Resolução</div>
                <div className="text-3xl font-bold text-accent-primary">
                  {formatTime(metrics.general?.avgResolutionTime)}
                </div>
              </div>
            </div>

            {/* SLA */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">TME (1ª resposta)</div>
                <div className="text-3xl font-bold text-accent-primary">
                  {formatSeconds(metrics.general?.avgFirstResponseTimeSeconds)}
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">TMA (atendimento)</div>
                <div className="text-3xl font-bold text-accent-primary">
                  {formatSeconds(metrics.general?.avgHandlingTimeSeconds)}
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Taxa de Abandono</div>
                <div className="text-3xl font-bold text-status-warning">
                  {formatRate(metrics.general?.abandonmentRate)}
                </div>
              </div>

              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <div className="text-sm text-text-secondary mb-1">Contenção Bot</div>
                <div className="text-3xl font-bold text-status-success">
                  {formatRate(metrics.general?.botContainmentRate)}
                </div>
              </div>
            </div>

            {/* Métricas por Agente */}
            {metrics.agents && metrics.agents.length > 0 && (
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                  Métricas por Agente
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-bg-secondary border-b border-border-default">
                        <th className="text-left py-3 px-4 text-sm font-semibold text-text-primary">Agente</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Total</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Fechados</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Abertos</th>
                        <th className="text-right py-3 px-4 text-sm font-semibold text-text-primary">Tempo Médio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.agents.map((agent) => (
                        <tr key={agent.agentId} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                          <td className="py-3 px-4 text-text-primary">{agent.agentName}</td>
                          <td className="py-3 px-4 text-right text-text-primary">{agent.totalTickets}</td>
                          <td className="py-3 px-4 text-right text-status-success">{agent.closedTickets}</td>
                          <td className="py-3 px-4 text-right text-status-warning">{agent.openTickets}</td>
                          <td className="py-3 px-4 text-right text-text-secondary">
                            {formatTime(agent.avgResolutionTime)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Métricas por Departamento */}
            {metrics.departments && metrics.departments.length > 0 && (
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                  Métricas por Departamento
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {metrics.departments.map((dept) => (
                    <div key={dept.departmentId} className="border border-border-default rounded-xl p-4 bg-bg-secondary">
                      <h3 className="font-semibold text-text-primary mb-2">
                        {dept.departmentName}
                      </h3>
                      <div className="text-sm text-text-secondary space-y-1">
                        <div>Total: {dept.totalTickets}</div>
                        <div>Fechados: {dept.closedTickets}</div>
                        <div>Tempo Médio: {formatTime(dept.avgResolutionTime)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Métricas por Fila */}
            {metrics.queues && metrics.queues.length > 0 && (
              <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
                <h2 className="text-xl font-semibold text-text-primary mb-4">
                  Métricas por Fila
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {metrics.queues.map((queue) => (
                    <div key={queue.queueName} className="border border-border-default rounded-xl p-4 bg-bg-secondary">
                      <h3 className="font-semibold text-text-primary mb-2">
                        {queue.queueName}
                      </h3>
                      <div className="text-sm text-text-secondary space-y-1">
                        <div>Total: {queue.totalTickets}</div>
                        <div>Esperando: {queue.waitingTickets}</div>
                        <div>Em Andamento: {queue.inProgressTickets}</div>
                        <div>Fechados: {queue.closedTickets}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      <ToastContainer />
    </div>
  );
}
