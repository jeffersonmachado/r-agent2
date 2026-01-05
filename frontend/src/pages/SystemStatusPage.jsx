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

export function SystemStatusPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5 segundos

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
      setError(err.message || 'Erro ao buscar status dos serviços');
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

  // Função para obter cor do status
  const getStatusColor = (status) => {
    switch (status) {
      case 'healthy':
        return 'text-green-600 bg-green-50 border-green-200';
      case 'degraded':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'unhealthy':
        return 'text-red-600 bg-red-50 border-red-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
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

  // Função para formatar detalhes
  const formatDetails = (service) => {
    if (!service.details) return null;

    const details = [];
    for (const [key, value] of Object.entries(service.details)) {
      if (value !== null && value !== undefined) {
        details.push(
          <div key={key} className="text-sm">
            <span className="font-medium text-gray-700">{key}:</span>{' '}
            <span className="text-gray-600">
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
      <div className="p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl font-bold mb-6">Status dos Serviços</h1>
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Carregando...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Status dos Serviços</h1>
            <p className="text-gray-600">
              Monitoramento em tempo real dos serviços fundamentais da plataforma
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Atualizando...' : 'Atualizar'}
            </button>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700">Auto-atualizar</span>
            </label>
            {autoRefresh && (
              <select
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Number(e.target.value))}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
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
              className={`p-6 rounded-lg border-2 ${getStatusColor(status.overall.status)}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl font-bold">
                      {getStatusIcon(status.overall.status)}
                    </span>
                    <h2 className="text-xl font-bold">
                      Status Geral: {status.overall.status.toUpperCase()}
                    </h2>
                  </div>
                  <p className="text-sm">
                    {status.overall.healthy} de {status.overall.total} serviços saudáveis (
                    {status.overall.percentage}%)
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-600">Última atualização</div>
                  <div className="text-sm font-medium">
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
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <strong>Erro:</strong> {error}
          </div>
        )}

        {/* Lista de Serviços */}
        {status && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(status.services).map(([key, service]) => (
              <div
                key={key}
                className={`p-6 rounded-lg border-2 ${getStatusColor(service.status)}`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl font-bold">
                        {getStatusIcon(service.status)}
                      </span>
                      <h3 className="text-lg font-bold">{service.name}</h3>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{service.description}</p>
                    <div className="inline-block px-3 py-1 rounded-full text-xs font-medium bg-white border">
                      {service.status.toUpperCase()}
                    </div>
                  </div>
                </div>

                {/* Detalhes */}
                {formatDetails(service)}

                {/* Erro */}
                {service.error && (
                  <div className="mt-3 p-2 bg-red-100 border border-red-300 rounded text-sm text-red-700">
                    <strong>Erro:</strong> {service.error}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Informações adicionais */}
        {status && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
            <div className="flex items-center justify-between">
              <div>
                <strong>Timestamp:</strong> {new Date(status.timestamp).toLocaleString('pt-BR')}
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
      </div>
    </div>
  );
}

