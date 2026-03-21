/**
 * Dashboard de Status dos Serviços
 * 
 * Exibe o status de todos os serviços fundamentais da plataforma:
 * - API Server
 * - RAG Service
 * - Redis
 * - WebSocket
 */

import React, { useState, useEffect } from 'react';
import { fetchJson } from '../api/client';
import logger from '../utils/logger';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { CrudPageBase } from '../modules/crud-base';

export function SystemStatusPage() {
  const { showToast, ToastContainer } = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30000); // 30 segundos

  // Função para buscar status
  const fetchStatus = async () => {
    try {
      setError(null);
      const data = await fetchJson('/system/status', {
        method: 'GET',
        timeoutMs: 5000,
      });
      setStatus(data);
      setLastUpdate(new Date());
      logger.debug('[SystemStatus] Status atualizado', data);
    } catch (err) {
      logger.error('[SystemStatus] Erro ao buscar status', err);
      
      // Se a API não está respondendo, cria um status de erro
      const errName = err.name || '';
      const errMessage = err.message || '';
      const errString = `${errName} ${errMessage}`.toLowerCase();
      
      // Verifica se é erro de conexão (flag adicionada pelo client.js)
      const isConnectionRefused = err.connectionRefused === true;
      
      const isTimeout = errName === 'AbortError' || 
                       errString.includes('timeout') || 
                       errString.includes('aborted') ||
                       errString.includes('signal is aborted');
      const isConnectionError = isConnectionRefused ||
                               errString.includes('failed to fetch') ||
                               errString.includes('networkerror') ||
                               errString.includes('econnrefused') ||
                               errString.includes('network request failed') ||
                               errString.includes('connection refused');
      const isServiceUnavailable = err.status === 503;
      
      if (isTimeout || isConnectionError || isServiceUnavailable) {
        // API não está respondendo - mostra status de erro com informações de portas
        const errorStatus = {
          timestamp: new Date().toISOString(),
          services: {
            apiServer: {
              name: 'API Server',
              description: 'Servidor principal da API (Node.js)',
              status: 'unhealthy',
              error: err.status === 503 ? 'Serviço temporariamente indisponível (503)' : 'API não está respondendo',
              details: {
                port: 3000,
                errorType: isTimeout ? 'timeout' : err.status === 503 ? 'service_unavailable' : 'connection_error',
                httpStatus: err.status || null,
                hint: 'A API pode estar parada ou indisponível. Verifique se o servidor está rodando na porta 3000.',
              },
            },
            ragService: {
              name: 'RAG Service',
              description: 'Serviço de Retrieval-Augmented Generation (Python/FastAPI)',
              status: 'unknown',
              error: 'Não foi possível verificar - API indisponível',
              details: {
                port: 8000,
                hint: 'Não é possível verificar o status do RAG Service enquanto a API estiver indisponível. Porta padrão: 8000.',
              },
            },
            redis: {
              name: 'Redis',
              description: 'Cache e rate limiting',
              status: 'unknown',
              error: 'Não foi possível verificar - API indisponível',
              details: {
                port: 6379,
                hint: 'Não é possível verificar o status do Redis enquanto a API estiver indisponível. Porta padrão: 6379.',
              },
            },
            webSocket: {
              name: 'WebSocket',
              description: 'Conexões em tempo real',
              status: 'unknown',
              error: 'Não foi possível verificar - API indisponível',
              details: {
                port: 'Mesma porta da API (3000)',
                hint: 'Não é possível verificar o status do WebSocket enquanto a API estiver indisponível. Usa a mesma porta da API.',
              },
            },
          },
          overall: {
            status: 'unhealthy',
            healthy: 0,
            total: 4,
            percentage: 0,
          },
        };
        
        setStatus(errorStatus);
        setLastUpdate(new Date());
        const errorMessage = 'API não está respondendo. Não é possível verificar o status dos serviços.';
        setError(errorMessage);
        showToast(errorMessage, 'error');
      } else {
        // Outro tipo de erro
        const errorMessage = err.message || 'Erro ao buscar status dos serviços';
        setError(errorMessage);
        showToast(errorMessage, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  // Busca status inicial
  useEffect(() => {
    fetchStatus();
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval]);

  // Função para obter cor do status usando classes do tema
  const getStatusColor = (statusValue) => {
    switch (statusValue) {
      case 'healthy':
        return 'text-status-success bg-status-success/10 border-status-success/30';
      case 'degraded':
        return 'text-status-warning bg-status-warning/10 border-status-warning/30';
      case 'unhealthy':
        return 'text-status-error bg-status-error/10 border-status-error/30';
      case 'unknown':
        return 'text-text-secondary bg-bg-secondary border-border-default';
      default:
        return 'text-text-secondary bg-bg-secondary border-border-default';
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
      case 'unknown':
        return '?';
      default:
        return '?';
    }
  };

  // Função para formatar detalhes
  const formatDetails = (service) => {
    if (!service.details) return null;

    const details = [];
    for (const [key, value] of Object.entries(service.details)) {
      if (value !== null && value !== undefined) {
        details.push(
          <div key={key} className="text-sm">
            <span className="font-medium text-text-primary">{key}:</span>{' '}
            <span className="text-text-secondary">
              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </span>
          </div>
        );
      }
    }
    return details.length > 0 ? <div className="mt-2 space-y-1">{details}</div> : null;
  };

  if (loading && !status) {
    return (
      <CrudPageBase>
        <div className="support-header">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h1>📊 Status dos Serviços</h1>
          </div>
        </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>
        <div className="flex items-center justify-center py-12">
          <div className="text-text-secondary">Carregando...</div>
        </div>
        <ToastContainer />
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h1>📊 Status dos Serviços</h1>
        </div>
        <div className="support-controls">
          <Button
            onClick={fetchStatus}
            disabled={loading}
            variant="primary"
          >
            {loading ? 'Atualizando...' : '🔄 Atualizar'}
          </Button>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-text-primary">Auto-atualizar</span>
          </label>
          {autoRefresh && (
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="px-3 py-2 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary focus:border-transparent transition-all appearance-none cursor-pointer hover:border-border-hover"
            >
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1min</option>
            </select>
          )}
        </div>
      </div>

      {/* Status Geral */}
      {status && (
        <div className="mb-6">
          <div
            className={`p-6 rounded-xl border-2 ${getStatusColor(status.overall.status)}`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl font-bold">
                    {getStatusIcon(status.overall.status)}
                  </span>
                  <h2 className="text-xl font-bold text-text-primary">
                    Status Geral: {status.overall.status.toUpperCase()}
                  </h2>
                </div>
                <p className="text-sm text-text-secondary">
                  {status.overall.healthy} de {status.overall.total} serviços saudáveis (
                  {status.overall.percentage}%)
                </p>
              </div>
              <div className="text-right">
                <div className="text-sm text-text-secondary">Última atualização</div>
                <div className="text-sm font-medium text-text-primary">
                  {lastUpdate
                    ? new Date(lastUpdate).toLocaleTimeString('pt-BR')
                    : 'Nunca'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="mb-6 p-4 bg-status-error/10 border border-status-error/30 rounded-xl text-status-error">
          <strong>Erro:</strong> {error}
        </div>
      )}

      {/* Lista de Serviços */}
      {status && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(status.services).map(([key, service]) => (
            <div
              key={key}
              className={`p-6 rounded-xl border-2 ${getStatusColor(service.status)}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl font-bold">
                      {getStatusIcon(service.status)}
                    </span>
                    <h3 className="text-lg font-bold text-text-primary">{service.name}</h3>
                  </div>
                  <p className="text-sm text-text-secondary mb-2">{service.description}</p>
                  <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-bg-elevated border border-border-default text-text-primary">
                    {service.status.toUpperCase()}
                  </div>
                </div>
              </div>

              {/* Detalhes */}
              {formatDetails(service)}

              {/* Erro */}
              {service.error && (
                <div className="mt-3 p-2 bg-status-error/10 border border-status-error/30 rounded text-sm text-status-error">
                  <strong>Erro:</strong> {service.error}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Informações adicionais */}
      {status && (
        <div className="mt-6 p-4 bg-bg-elevated rounded-xl border border-border-default text-sm text-text-secondary">
          <div className="flex items-center justify-between">
            <div>
              <strong className="text-text-primary">Timestamp:</strong>{' '}
              {new Date(status.timestamp).toLocaleString('pt-BR')}
            </div>
            <div>
              {autoRefresh && (
                <span>
                  Próxima atualização em{' '}
                  {Math.ceil(refreshInterval / 1000)} segundos
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}

