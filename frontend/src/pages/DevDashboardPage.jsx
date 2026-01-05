import React, { useState, useEffect, useRef } from 'react';
import { fetchJson } from '../api/client';
import logger from '../utils/logger';
import { LogViewer } from '../components/LogViewer';
import { useTheme } from '../styles/themeContext';
import { NavigationLink } from '../components/NavigationLink';

/**
 * Dashboard de Desenvolvimento
 * 
 * Funcionalidades:
 * - Status dos serviços em tempo real
 * - Logs do sistema
 * - Métricas de performance
 * - Informações do ambiente
 * - Ferramentas de desenvolvimento
 * - Status de rate limiting
 * - Conexões WebSocket
 */
export function DevDashboardPage() {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState('status');
  const [systemStatus, setSystemStatus] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [envInfo, setEnvInfo] = useState(null);
  const [rateLimitStatus, setRateLimitStatus] = useState(null);
  const [wsConnections, setWsConnections] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000);
  const [showLogs, setShowLogs] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Função auxiliar para formatar tempo em minutos para texto legível
  const formatTime = (minutes) => {
    if (!minutes || minutes === 0) return 'N/A';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}min`;
  };

  // Função auxiliar para formatar número com separador de milhar
  const formatNumber = (num) => {
    if (num === null || num === undefined) return '0';
    return num.toLocaleString('pt-BR');
  };

  // Função para buscar status do sistema
  const fetchSystemStatus = async () => {
    try {
      const data = await fetchJson('/system/status', {
        method: 'GET',
        timeoutMs: 5000,
      });
      setSystemStatus(data);
      setLastUpdate(new Date());
    } catch (err) {
      logger.error('[DevDashboard] Erro ao buscar status', err);
    }
  };

  // Função para buscar métricas
  const fetchMetrics = async () => {
    try {
      // Tenta buscar métricas se o endpoint existir
      const data = await fetchJson('/analytics/metrics', {
        method: 'GET',
        timeoutMs: 5000,
      }).catch(() => null);
      setMetrics(data);
    } catch (err) {
      // Endpoint pode não existir, ignora silenciosamente
      logger.debug('[DevDashboard] Métricas não disponíveis', err);
    }
  };

  // Função para buscar informações do ambiente
  const fetchEnvInfo = async () => {
    try {
      const data = await fetchJson('/version', {
        method: 'GET',
        timeoutMs: 5000,
      });
      setEnvInfo(data);
    } catch (err) {
      logger.error('[DevDashboard] Erro ao buscar info do ambiente', err);
    }
  };

  // Função para buscar status de rate limit
  const fetchRateLimitStatus = async () => {
    try {
      // Verifica rate limit para diferentes operações
      const operations = ['BOOTSTRAP', 'GENERATION_REAL', 'DRY_RUN'];
      const statuses = {};
      
      for (const op of operations) {
        try {
          const result = await fetchJson('/system/check-rate-limit', {
            method: 'POST',
            body: JSON.stringify({
              bootstrap: op === 'BOOTSTRAP',
              executionMode: op === 'DRY_RUN' ? 'dry-run' : 'real',
            }),
            timeoutMs: 5000,
          });
          statuses[op] = result;
        } catch (err) {
          statuses[op] = { error: err.message };
        }
      }
      
      setRateLimitStatus(statuses);
    } catch (err) {
      logger.error('[DevDashboard] Erro ao buscar rate limit', err);
    }
  };

  // Função para buscar conexões WebSocket
  const fetchWsConnections = async () => {
    try {
      const data = await fetchJson('/system/websocket', {
        method: 'GET',
        timeoutMs: 5000,
      });
      setWsConnections(data);
    } catch (err) {
      logger.error('[DevDashboard] Erro ao buscar conexões WebSocket', err);
      setWsConnections(null);
    }
  };

  // Função para atualizar tudo
  const refreshAll = async () => {
    setLoading(true);
    await Promise.all([
      fetchSystemStatus(),
      fetchMetrics(),
      fetchEnvInfo(),
      fetchRateLimitStatus(),
      fetchWsConnections(),
    ]);
    setLoading(false);
  };

  // Busca inicial
  useEffect(() => {
    refreshAll();
  }, []);

  // Polling removido - apenas atualização manual via botão "Atualizar"
  // O usuário pode clicar no botão para atualizar os dados quando necessário
  // useEffect removido para eliminar requisições HTTP periódicas

  // Função para obter cor do status baseado no tema
  const getStatusColor = (status) => {
    const isDark = theme.name === 'dark';
    switch (status) {
      case 'healthy':
        return isDark 
          ? 'text-status-success bg-status-success/10 border-status-success/30'
          : 'text-status-success bg-green-50 border-green-200';
      case 'degraded':
        return isDark
          ? 'text-status-warning bg-status-warning/10 border-status-warning/30'
          : 'text-status-warning bg-yellow-50 border-yellow-200';
      case 'unhealthy':
        return isDark
          ? 'text-status-error bg-status-error/10 border-status-error/30'
          : 'text-status-error bg-red-50 border-red-200';
      default:
        return isDark
          ? 'text-text-secondary bg-bg-elevated border-border-default'
          : 'text-text-secondary bg-gray-50 border-gray-200';
    }
  };

  // Função para obter ícone do status
  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
        return '✓';
      case 'degraded':
        return '⚠';
      case 'unhealthy':
        return '✗';
      default:
        return '?';
    }
  };

  // Função para limpar cache de rate limit
  const clearRateLimitCache = async () => {
    try {
      const result = await fetchJson('/admin/rate-limit/clear-cache', {
        method: 'POST',
        timeoutMs: 5000,
      });
      await fetchRateLimitStatus();
      logger.info('[DevDashboard] Cache de rate limit limpo', result);
      alert('Cache de rate limit limpo com sucesso!');
    } catch (err) {
      logger.error('[DevDashboard] Erro ao limpar cache', err);
      alert('Erro ao limpar cache: ' + (err.message || 'Erro desconhecido'));
    }
  };

  const tabs = [
    { id: 'status', label: '📊 Status', icon: '📊' },
    { id: 'features', label: '🚀 Funcionalidades', icon: '🚀' },
    { id: 'metrics', label: '📈 Métricas', icon: '📈' },
    { id: 'environment', label: '⚙️ Ambiente', icon: '⚙️' },
    { id: 'rate-limit', label: '🚦 Rate Limit', icon: '🚦' },
    { id: 'websocket', label: '🔌 WebSocket', icon: '🔌' },
    { id: 'tools', label: '🛠️ Ferramentas', icon: '🛠️' },
  ];

  // Funcionalidades APENAS de desenvolvimento/testes RPA
  const devFeatures = [
    {
      id: 'rpa-test',
      title: 'Execução de Testes RPA',
      description: 'Execute testes RPA automatizados (apenas desenvolvimento)',
      icon: '🚀',
      path: '/rpa-test',
      color: 'bg-orange-600',
      category: 'RPA',
    },
    {
      id: 'rpa-replays',
      title: 'Replays RPA',
      description: 'Visualize e analise replays de execuções RPA (apenas desenvolvimento)',
      icon: '📋',
      path: '/rpa-replays',
      color: 'bg-pink-600',
      category: 'RPA',
    },
  ];

  return (
    <>
      <style>{`
        .dev-dashboard-scroll::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .dev-dashboard-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .dev-dashboard-scroll::-webkit-scrollbar-thumb {
          background-color: rgba(156, 163, 175, 0.3);
          border-radius: 4px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .dev-dashboard-scroll::-webkit-scrollbar-thumb:hover {
          background-color: rgba(156, 163, 175, 0.5);
        }
        .dev-dashboard-scroll {
          scrollbar-width: thin;
          scrollbar-color: rgba(156, 163, 175, 0.3) transparent;
        }
      `}</style>
      <div className="h-screen flex flex-col overflow-hidden" style={{ backgroundColor: theme.colors.bg.primary }}>
        <div className="flex-1 overflow-y-auto dev-dashboard-scroll">
          <div className="p-8">
            <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2" style={{ color: theme.colors.text.primary }}>
              🛠️ Dashboard de Desenvolvimento
            </h1>
            <p style={{ color: theme.colors.text.secondary }}>
              Ferramentas e informações úteis para desenvolvedores
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowLogs(true)}
              className="px-4 py-2 rounded-lg transition-colors"
              style={{ 
                backgroundColor: theme.colors.accent.primary,
                color: '#ffffff'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.accent.hover}
              onMouseLeave={(e) => e.target.style.backgroundColor = theme.colors.accent.primary}
            >
              📋 Ver Logs
            </button>
            <button
              onClick={refreshAll}
              disabled={loading}
              className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ 
                backgroundColor: loading ? theme.colors.text.tertiary : theme.colors.status.info,
                color: '#ffffff'
              }}
              onMouseEnter={(e) => !loading && (e.target.style.backgroundColor = theme.colors.status.info)}
              onMouseLeave={(e) => !loading && (e.target.style.backgroundColor = theme.colors.status.info)}
            >
              {loading ? '⏳ Atualizando...' : '🔄 Atualizar'}
            </button>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm" style={{ color: theme.colors.text.secondary }}>Auto-atualizar</span>
            </label>
            {autoRefresh && (
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="px-3 py-2 rounded-lg text-sm"
                style={{ 
                  backgroundColor: theme.colors.bg.secondary,
                  border: `1px solid ${theme.colors.border.default}`,
                  color: theme.colors.text.primary
                }}
              >
                <option value={5000}>5s</option>
                <option value={10000}>10s</option>
                <option value={30000}>30s</option>
                <option value={60000}>1min</option>
              </select>
            )}
          </div>
        </div>

        {/* Última atualização */}
        {lastUpdate && (
          <div className="mb-4 text-sm" style={{ color: theme.colors.text.tertiary }}>
            Última atualização: {lastUpdate.toLocaleTimeString('pt-BR')}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6" style={{ borderBottom: `1px solid ${theme.colors.border.default}` }}>
          <div className="flex gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="px-4 py-2 font-medium transition-colors"
                style={{
                  color: activeTab === tab.id ? theme.colors.accent.primary : theme.colors.text.secondary,
                  borderBottom: activeTab === tab.id ? `2px solid ${theme.colors.accent.primary}` : '2px solid transparent',
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.color = theme.colors.text.primary;
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.color = theme.colors.text.secondary;
                  }
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Conteúdo das tabs */}
        <div className="rounded-lg p-6" style={{ 
          backgroundColor: theme.colors.bg.elevated,
          border: `1px solid ${theme.colors.border.default}`,
          boxShadow: theme.name === 'dark' ? '0 4px 6px rgba(0, 0, 0, 0.3)' : '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}>
          {/* Tab: Funcionalidades */}
          {activeTab === 'features' && (
            <div>
              <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>
                Funcionalidades de Desenvolvimento
              </h2>
              <p className="mb-6" style={{ color: theme.colors.text.secondary }}>
                Acesse ferramentas de desenvolvimento, testes e geração de código.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {devFeatures.map((feature) => (
                  <NavigationLink
                    key={feature.id}
                    to={feature.path}
                    className="block"
                  >
                    <div 
                      className="rounded-lg border hover:shadow-lg transition-all p-4 cursor-pointer h-full"
                      style={{ 
                        backgroundColor: theme.colors.bg.secondary,
                        borderColor: theme.colors.border.default,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = theme.colors.border.hover;
                        e.currentTarget.style.backgroundColor = theme.colors.bg.hover;
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = theme.colors.border.default;
                        e.currentTarget.style.backgroundColor = theme.colors.bg.secondary;
                      }}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`${feature.color} w-10 h-10 rounded-lg flex items-center justify-center text-xl`}>
                          {feature.icon}
                        </div>
                        <span className="text-xs px-2 py-1 rounded" style={{ 
                          color: theme.colors.text.tertiary,
                          backgroundColor: theme.colors.bg.tertiary
                        }}>
                          {feature.category}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold mb-1" style={{ color: theme.colors.text.primary }}>
                        {feature.title}
                      </h3>
                      <p className="text-sm" style={{ color: theme.colors.text.secondary }}>
                        {feature.description}
                      </p>
                    </div>
                  </NavigationLink>
                ))}
              </div>
            </div>
          )}

          {/* Tab: Status */}
          {activeTab === 'status' && systemStatus && (
            <div>
              <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Status dos Serviços</h2>
              
              {/* Status Geral */}
              <div className={`mb-6 p-6 rounded-lg border-2 ${getStatusColor(systemStatus.overall.status)}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-2xl font-bold">
                        {getStatusIcon(systemStatus.overall.status)}
                      </span>
                      <h3 className="text-xl font-bold">
                        Status Geral: {systemStatus.overall.status.toUpperCase()}
                      </h3>
                    </div>
                    <p className="text-sm">
                      {systemStatus.overall.healthy} de {systemStatus.overall.total} serviços saudáveis (
                      {systemStatus.overall.percentage}%)
                    </p>
                  </div>
                </div>
              </div>

              {/* Lista de Serviços */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(systemStatus.services).map(([key, service]) => (
                  <div
                    key={key}
                    className={`p-4 rounded-lg border-2 ${getStatusColor(service.status)}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xl font-bold">
                            {getStatusIcon(service.status)}
                          </span>
                          <h3 className="text-lg font-bold" style={{ color: theme.colors.text.primary }}>{service.name}</h3>
                        </div>
                        <p className="text-sm mb-2" style={{ color: theme.colors.text.secondary }}>{service.description}</p>
                        <div className="inline-block px-2 py-1 rounded-full text-xs font-medium border" style={{ 
                          backgroundColor: theme.colors.bg.secondary,
                          borderColor: theme.colors.border.default,
                          color: theme.colors.text.primary
                        }}>
                          {service.status.toUpperCase()}
                        </div>
                      </div>
                    </div>

                    {/* Detalhes */}
                    {service.details && (
                      <div className="mt-3 text-sm space-y-1">
                        {Object.entries(service.details).map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium" style={{ color: theme.colors.text.primary }}>{key}:</span>{' '}
                            <span style={{ color: theme.colors.text.secondary }}>
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Erro */}
                    {service.error && (
                      <div className="mt-2 p-2 rounded text-sm" style={{ 
                        backgroundColor: theme.colors.status.error + '20',
                        border: `1px solid ${theme.colors.status.error}40`,
                        color: theme.colors.status.error
                      }}>
                        <strong>Erro:</strong> {service.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab: Métricas */}
          {activeTab === 'metrics' && (
            <div>
              <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Métricas de Performance</h2>
              {metrics ? (
                <div className="space-y-6">
                  {/* Métricas Gerais */}
                  {metrics.general && (
                    <div>
                      <h3 className="text-xl font-semibold mb-4" style={{ color: theme.colors.text.primary }}>
                        📊 Visão Geral
                      </h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Total de Tickets</div>
                          <div className="text-3xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatNumber(metrics.general.totalTickets || 0)}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tickets Abertos</div>
                          <div className="text-3xl font-bold" style={{ color: theme.colors.status.warning }}>
                            {formatNumber(metrics.general.openTickets || 0)}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tickets Fechados</div>
                          <div className="text-3xl font-bold" style={{ color: theme.colors.status.success }}>
                            {formatNumber(metrics.general.closedTickets || 0)}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Em Andamento</div>
                          <div className="text-3xl font-bold" style={{ color: theme.colors.status.info }}>
                            {formatNumber(metrics.general.inProgressTickets || 0)}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Aguardando</div>
                          <div className="text-3xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatNumber(metrics.general.waitingTickets || 0)}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Total de Mensagens</div>
                          <div className="text-3xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatNumber(metrics.general.totalMessages || 0)}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tempo Médio de Resolução</div>
                          <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatTime(metrics.general.avgResolutionTime)}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tempo Médio de Primeira Resposta</div>
                          <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatTime(metrics.general.avgFirstResponseTime)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Métricas por Agente */}
                  {metrics.agents && metrics.agents.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold mb-4" style={{ color: theme.colors.text.primary }}>
                        👥 Performance por Agente
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ backgroundColor: theme.colors.bg.secondary }}>
                              <th className="p-3 text-left font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Agente
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Total de Tickets
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Fechados
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Abertos
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Mensagens
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Tempo Médio Resolução
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {metrics.agents.map((agent, idx) => (
                              <tr key={agent.agentId || idx} style={{ backgroundColor: idx % 2 === 0 ? theme.colors.bg.primary : theme.colors.bg.secondary }}>
                                <td className="p-3 font-medium" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {agent.agentName || agent.agentId}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(agent.totalTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.status.success, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(agent.closedTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.status.warning, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(agent.openTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(agent.totalMessages || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
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
                    <div>
                      <h3 className="text-xl font-semibold mb-4" style={{ color: theme.colors.text.primary }}>
                        🏢 Performance por Departamento
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ backgroundColor: theme.colors.bg.secondary }}>
                              <th className="p-3 text-left font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Departamento
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Total de Tickets
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Fechados
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Abertos
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Mensagens
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Tempo Médio Resolução
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {metrics.departments.map((dept, idx) => (
                              <tr key={dept.departmentId || idx} style={{ backgroundColor: idx % 2 === 0 ? theme.colors.bg.primary : theme.colors.bg.secondary }}>
                                <td className="p-3 font-medium" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {dept.departmentName || dept.departmentId}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(dept.totalTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.status.success, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(dept.closedTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.status.warning, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(dept.openTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(dept.totalMessages || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatTime(dept.avgResolutionTime)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Métricas por Fila */}
                  {metrics.queues && metrics.queues.length > 0 && (
                    <div>
                      <h3 className="text-xl font-semibold mb-4" style={{ color: theme.colors.text.primary }}>
                        📋 Performance por Fila
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full" style={{ borderCollapse: 'collapse' }}>
                          <thead>
                            <tr style={{ backgroundColor: theme.colors.bg.secondary }}>
                              <th className="p-3 text-left font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Fila
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Total de Tickets
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Fechados
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Abertos
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Mensagens
                              </th>
                              <th className="p-3 text-center font-semibold" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                Tempo Médio Resolução
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {metrics.queues.map((queue, idx) => (
                              <tr key={queue.queueName || idx} style={{ backgroundColor: idx % 2 === 0 ? theme.colors.bg.primary : theme.colors.bg.secondary }}>
                                <td className="p-3 font-medium" style={{ color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {queue.queueName || 'N/A'}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(queue.totalTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.status.success, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(queue.closedTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.status.warning, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(queue.openTickets || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatNumber(queue.totalMessages || 0)}
                                </td>
                                <td className="p-3 text-center" style={{ color: theme.colors.text.secondary, border: `1px solid ${theme.colors.border.default}` }}>
                                  {formatTime(queue.avgResolutionTime)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Timestamp */}
                  {metrics.timestamp && (
                    <div className="text-sm text-center" style={{ color: theme.colors.text.tertiary }}>
                      Última atualização: {new Date(metrics.timestamp).toLocaleString('pt-BR')}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                  Métricas não disponíveis. Verifique se o endpoint /analytics/metrics está disponível.
                </div>
              )}
            </div>
          )}

          {/* Tab: Ambiente */}
          {activeTab === 'environment' && (
            <div>
              <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Informações do Ambiente</h2>
              {envInfo ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                      <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Nome da Aplicação</div>
                      <div style={{ color: theme.colors.text.secondary }}>{envInfo.name || 'N/A'}</div>
                    </div>
                    <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                      <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Ambiente</div>
                      <div style={{ color: theme.colors.text.secondary }}>{envInfo.env || 'N/A'}</div>
                    </div>
                  </div>
                  
                  {systemStatus?.services?.apiServer?.details && (
                    <div className="mt-4">
                      <h3 className="text-lg font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Detalhes da API</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                          <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Uptime</div>
                          <div style={{ color: theme.colors.text.secondary }}>
                            {systemStatus.services.apiServer.details.uptimeFormatted || 'N/A'}
                          </div>
                        </div>
                        <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                          <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Versão do Node</div>
                          <div style={{ color: theme.colors.text.secondary }}>
                            {systemStatus.services.apiServer.details.nodeVersion || 'N/A'}
                          </div>
                        </div>
                        {systemStatus.services.apiServer.details.memory && (
                          <>
                            <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                              <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Memória Heap Usada</div>
                              <div style={{ color: theme.colors.text.secondary }}>
                                {systemStatus.services.apiServer.details.memory.heapUsed} MB
                              </div>
                            </div>
                            <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                              <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>Memória Heap Total</div>
                              <div style={{ color: theme.colors.text.secondary }}>
                                {systemStatus.services.apiServer.details.memory.heapTotal} MB
                              </div>
                            </div>
                            <div className="p-4 rounded-lg" style={{ backgroundColor: theme.colors.bg.secondary }}>
                              <div className="font-semibold mb-2" style={{ color: theme.colors.text.primary }}>RSS</div>
                              <div style={{ color: theme.colors.text.secondary }}>
                                {systemStatus.services.apiServer.details.memory.rss} MB
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                  Carregando informações do ambiente...
                </div>
              )}
            </div>
          )}

          {/* Tab: Rate Limit */}
          {activeTab === 'rate-limit' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>Status de Rate Limiting</h2>
                <button
                  onClick={clearRateLimitCache}
                  className="px-4 py-2 rounded-lg transition-colors"
                  style={{ 
                    backgroundColor: theme.colors.status.warning,
                    color: '#ffffff'
                  }}
                  onMouseEnter={(e) => e.target.style.opacity = '0.9'}
                  onMouseLeave={(e) => e.target.style.opacity = '1'}
                >
                  🗑️ Limpar Cache
                </button>
              </div>
              {rateLimitStatus ? (
                <div className="space-y-4">
                  {Object.entries(rateLimitStatus).map(([operation, status]) => (
                    <div key={operation} className="p-4 rounded-lg" style={{ 
                      border: `1px solid ${theme.colors.border.default}`,
                      backgroundColor: theme.colors.bg.secondary
                    }}>
                      <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>{operation}</h3>
                      {status.error ? (
                        <div style={{ color: theme.colors.status.error }}>Erro: {status.error}</div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div>
                            <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Permitido</div>
                            <div className="font-semibold" style={{ 
                              color: status.allowed ? theme.colors.status.success : theme.colors.status.error
                            }}>
                              {status.allowed ? '✓ Sim' : '✗ Não'}
                            </div>
                          </div>
                          <div>
                            <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Pontos Restantes</div>
                            <div className="font-semibold" style={{ color: theme.colors.text.primary }}>
                              {status.remainingPoints ?? 'N/A'} / {status.totalPoints ?? 'N/A'}
                            </div>
                          </div>
                          {status.retryAfter && (
                            <div>
                              <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Retry After</div>
                              <div className="font-semibold" style={{ color: theme.colors.text.primary }}>{status.retryAfter}s</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                  Carregando status de rate limit...
                </div>
              )}
            </div>
          )}

          {/* Tab: WebSocket */}
          {activeTab === 'websocket' && (
            <div>
              <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Conexões WebSocket</h2>
              {wsConnections ? (
                <div className="space-y-6">
                  {/* Status do Servidor */}
                  <div className="p-4 rounded-lg" style={{ 
                    backgroundColor: theme.colors.bg.secondary,
                    border: `1px solid ${theme.colors.border.default}`
                  }}>
                    <h3 className="text-lg font-semibold mb-3" style={{ color: theme.colors.text.primary }}>Servidor</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Status</div>
                        <div className="font-semibold" style={{ 
                          color: wsConnections.server?.initialized ? '#10b981' : '#ef4444'
                        }}>
                          {wsConnections.server?.initialized ? '✓ Inicializado' : '✗ Não inicializado'}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Path</div>
                        <div className="font-semibold" style={{ color: theme.colors.text.primary }}>
                          {wsConnections.server?.path || 'N/A'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Estatísticas */}
                  {wsConnections.stats && (
                    <div className="p-4 rounded-lg" style={{ 
                      backgroundColor: theme.colors.bg.secondary,
                      border: `1px solid ${theme.colors.border.default}`
                    }}>
                      <h3 className="text-lg font-semibold mb-3" style={{ color: theme.colors.text.primary }}>Estatísticas</h3>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Total de Clientes</div>
                          <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatNumber(wsConnections.stats.totalClients || 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Autenticados</div>
                          <div className="text-2xl font-bold" style={{ color: '#10b981' }}>
                            {formatNumber(wsConnections.stats.authenticatedClients || 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Não Autenticados</div>
                          <div className="text-2xl font-bold" style={{ color: '#f59e0b' }}>
                            {formatNumber(wsConnections.stats.unauthenticatedClients || 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Tenants Únicos</div>
                          <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatNumber(wsConnections.stats.uniqueTenants || 0)}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm mb-1" style={{ color: theme.colors.text.secondary }}>Agentes Únicos</div>
                          <div className="text-2xl font-bold" style={{ color: theme.colors.text.primary }}>
                            {formatNumber(wsConnections.stats.uniqueAgents || 0)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Lista de Conexões */}
                  {wsConnections.connections && wsConnections.connections.length > 0 ? (
                    <div className="p-4 rounded-lg" style={{ 
                      backgroundColor: theme.colors.bg.secondary,
                      border: `1px solid ${theme.colors.border.default}`
                    }}>
                      <h3 className="text-lg font-semibold mb-3" style={{ color: theme.colors.text.primary }}>
                        Conexões Ativas ({wsConnections.connections.length})
                      </h3>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {wsConnections.connections.map((conn) => (
                          <div 
                            key={conn.id}
                            className="p-3 rounded border" 
                            style={{ 
                              backgroundColor: theme.colors.bg.primary,
                              borderColor: theme.colors.border.default
                            }}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="font-mono text-sm" style={{ color: theme.colors.text.primary }}>
                                {conn.id}
                              </div>
                              <div className="flex items-center gap-2">
                                <span 
                                  className="px-2 py-1 rounded text-xs font-semibold"
                                  style={{ 
                                    backgroundColor: conn.state === 'OPEN' ? '#10b98120' : '#f59e0b20',
                                    color: conn.state === 'OPEN' ? '#10b981' : '#f59e0b'
                                  }}
                                >
                                  {conn.state}
                                </span>
                                {conn.authenticated && (
                                  <span 
                                    className="px-2 py-1 rounded text-xs font-semibold"
                                    style={{ 
                                      backgroundColor: '#3b82f620',
                                      color: '#3b82f6'
                                    }}
                                  >
                                    Autenticado
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                              {conn.username && (
                                <div>
                                  <span style={{ color: theme.colors.text.secondary }}>Usuário: </span>
                                  <span style={{ color: theme.colors.text.primary }}>{conn.username}</span>
                                </div>
                              )}
                              {conn.tenantId && (
                                <div>
                                  <span style={{ color: theme.colors.text.secondary }}>Tenant: </span>
                                  <span style={{ color: theme.colors.text.primary }}>{conn.tenantId}</span>
                                </div>
                              )}
                              <div>
                                <span style={{ color: theme.colors.text.secondary }}>Uptime: </span>
                                <span style={{ color: theme.colors.text.primary }}>
                                  {Math.floor(conn.uptime / 60)}m {conn.uptime % 60}s
                                </span>
                              </div>
                              <div>
                                <span style={{ color: theme.colors.text.secondary }}>Conectado: </span>
                                <span style={{ color: theme.colors.text.primary }}>
                                  {new Date(conn.connectedAt).toLocaleTimeString('pt-BR')}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-lg text-center" style={{ 
                      backgroundColor: theme.colors.bg.secondary,
                      border: `1px solid ${theme.colors.border.default}`,
                      color: theme.colors.text.tertiary
                    }}>
                      Nenhuma conexão ativa no momento
                    </div>
                  )}

                  {/* Timestamp */}
                  {wsConnections.timestamp && (
                    <div className="text-sm text-center" style={{ color: theme.colors.text.tertiary }}>
                      Última atualização: {new Date(wsConnections.timestamp).toLocaleString('pt-BR')}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8" style={{ color: theme.colors.text.tertiary }}>
                  Informações de WebSocket não disponíveis. O endpoint pode não estar implementado.
                </div>
              )}
            </div>
          )}

          {/* Tab: Ferramentas */}
          {activeTab === 'tools' && (
            <div>
              <h2 className="text-2xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>Ferramentas de Desenvolvimento</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg" style={{ 
                  border: `1px solid ${theme.colors.border.default}`,
                  backgroundColor: theme.colors.bg.secondary
                }}>
                  <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>🔄 Limpar Cache de Rate Limit</h3>
                  <p className="text-sm mb-3" style={{ color: theme.colors.text.secondary }}>
                    Limpa o cache de rate limiting, útil para testes e desenvolvimento.
                  </p>
                  <button
                    onClick={clearRateLimitCache}
                    className="px-4 py-2 rounded-lg transition-colors"
                    style={{ 
                      backgroundColor: theme.colors.status.warning,
                      color: '#ffffff'
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '0.9'}
                    onMouseLeave={(e) => e.target.style.opacity = '1'}
                  >
                    Limpar Cache
                  </button>
                </div>

                <div className="p-4 rounded-lg" style={{ 
                  border: `1px solid ${theme.colors.border.default}`,
                  backgroundColor: theme.colors.bg.secondary
                }}>
                  <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>📋 Visualizar Logs</h3>
                  <p className="text-sm mb-3" style={{ color: theme.colors.text.secondary }}>
                    Abre o visualizador de logs do sistema em tempo real.
                  </p>
                  <button
                    onClick={() => setShowLogs(true)}
                    className="px-4 py-2 rounded-lg transition-colors"
                    style={{ 
                      backgroundColor: theme.colors.accent.primary,
                      color: '#ffffff'
                    }}
                    onMouseEnter={(e) => e.target.style.backgroundColor = theme.colors.accent.hover}
                    onMouseLeave={(e) => e.target.style.backgroundColor = theme.colors.accent.primary}
                  >
                    Abrir Logs
                  </button>
                </div>

                <div className="p-4 rounded-lg" style={{ 
                  border: `1px solid ${theme.colors.border.default}`,
                  backgroundColor: theme.colors.bg.secondary
                }}>
                  <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>🔄 Atualizar Tudo</h3>
                  <p className="text-sm mb-3" style={{ color: theme.colors.text.secondary }}>
                    Força atualização de todos os dados do dashboard.
                  </p>
                  <button
                    onClick={refreshAll}
                    disabled={loading}
                    className="px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                    style={{ 
                      backgroundColor: loading ? theme.colors.text.tertiary : theme.colors.status.info,
                      color: '#ffffff'
                    }}
                    onMouseEnter={(e) => !loading && (e.target.style.backgroundColor = theme.colors.status.info)}
                    onMouseLeave={(e) => !loading && (e.target.style.backgroundColor = theme.colors.status.info)}
                  >
                    {loading ? 'Atualizando...' : 'Atualizar'}
                  </button>
                </div>

                <div className="p-4 rounded-lg" style={{ 
                  border: `1px solid ${theme.colors.border.default}`,
                  backgroundColor: theme.colors.bg.secondary
                }}>
                  <h3 className="font-semibold text-lg mb-2" style={{ color: theme.colors.text.primary }}>📊 Status dos Serviços</h3>
                  <p className="text-sm mb-3" style={{ color: theme.colors.text.secondary }}>
                    Visualiza o status detalhado de todos os serviços.
                  </p>
                  <button
                    onClick={() => setActiveTab('status')}
                    className="px-4 py-2 rounded-lg transition-colors"
                    style={{ 
                      backgroundColor: theme.colors.status.success,
                      color: '#ffffff'
                    }}
                    onMouseEnter={(e) => e.target.style.opacity = '0.9'}
                    onMouseLeave={(e) => e.target.style.opacity = '1'}
                  >
                    Ver Status
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
            </div>
          </div>
        </div>

        {/* Modal de Logs */}
        {showLogs && (
          <LogViewer onClose={() => setShowLogs(false)} />
        )}
      </div>
    </>
  );
}

