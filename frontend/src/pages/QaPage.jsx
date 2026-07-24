/**
 * Página de QA - Painel de Qualidade.
 * 
 * Exibe:
 * - Data / commit
 * - Status geral
 * - Escopos afetados
 * - Checks que falharam
 * - Se bloqueia ou não
 * - Origem (CI / runtime)
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/authContext';
import { useRouter } from '../hooks/useRouter';
import * as qaApi from '../api/qa';
import { Button } from '../styles/Button';
import { useToast } from '../components/Toast';
import { NavigationLink } from '../components/NavigationLink';
import logger from '../utils/logger';
import { CrudPageBase } from '../modules/crud-base';

export function QaPage() {
  const { agent: currentAgent, isAuthenticated, loading: authLoading } = useAuth();
  const { navigate } = useRouter();
  const { showToast, ToastContainer } = useToast();

  // Proteção: redireciona para login se não estiver autenticado
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [isAuthenticated, authLoading, navigate]);

  const [latestResult, setLatestResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState('latest'); // 'latest', 'history', 'stats'

  const canViewQa = currentAgent?.role === 'admin' || currentAgent?.role === 'supervisor';
  const canRunQa = currentAgent?.role === 'admin';

  useEffect(() => {
    if (canViewQa && isAuthenticated) {
      loadLatest();
      loadHistory();
      loadStats();
    }
  }, [canViewQa, isAuthenticated]);

  const loadLatest = async () => {
    try {
      const result = await qaApi.getLatestQaResult();
      setLatestResult(result);
    } catch (err) {
      if (err.status !== 404) {
        logger.error('Erro ao carregar último resultado QA', err);
        showToast('Erro ao carregar último resultado QA', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const result = await qaApi.getQaHistory({ limit: 20 });
      setHistory(result.results || []);
    } catch (err) {
      logger.error('Erro ao carregar histórico QA', err);
      showToast('Erro ao carregar histórico QA', 'error');
    }
  };

  const loadStats = async () => {
    try {
      const result = await qaApi.getQaStats();
      setStats(result);
    } catch (err) {
      logger.error('Erro ao carregar estatísticas QA', err);
    }
  };

  const handleRunQa = async () => {
    try {
      setRunning(true);
      const result = await qaApi.runQaManual();
      setLatestResult(result);
      showToast('QA executado com sucesso', 'success');
      await loadHistory();
      await loadStats();
    } catch (err) {
      logger.error('Erro ao executar QA', err);
      showToast('Erro ao executar QA', 'error');
    } finally {
      setRunning(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'PASS':
        return 'text-green-500';
      case 'FAIL':
        return 'text-red-500';
      case 'WARN':
        return 'text-yellow-500';
      default:
        return 'text-text-secondary';
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PASS':
        return '✅ PASS';
      case 'FAIL':
        return '❌ FAIL';
      case 'WARN':
        return '⚠️ WARN';
      default:
        return status;
    }
  };

  const getSourceLabel = (source) => {
    const labels = {
      ci: 'CI/CD',
      local: 'Local',
      runtime: 'Runtime',
      manual: 'Manual',
    };
    return labels[source] || source;
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
          <p className="text-text-secondary">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null; // Será redirecionado pelo useEffect
  }

  if (!canViewQa) {
    return (
      <CrudPageBase>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-text-primary mb-4">🚫 Acesso Negado</h1>
            <p className="text-text-secondary mb-6">Você não tem permissão para visualizar QA.</p>
            <NavigationLink to="/support">
              <Button>Voltar</Button>
            </NavigationLink>
          </div>
        </div>
        <ToastContainer />
      </CrudPageBase>
    );
  }

  return (
    <CrudPageBase>
      <div className="support-header">
        <div className="page-header">
          <h1>✅ Painel de Qualidade (QA)</h1>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/qa/stability')}>Abrir Estabilidade</Button>
            <Button onClick={() => navigate('/qa-mesh')}>Abrir Malha QA</Button>
            {canRunQa && (
              <Button onClick={handleRunQa} disabled={running}>
                {running ? 'Executando...' : 'Executar QA'}
              </Button>
            )}
          </div>
        </div>
        <p className="text-text-secondary" style={{ marginBottom: '20px' }}>
          Visualize a compatibilidade legada de QA e navegue para a malha unificada em <code>/qa-mesh</code>
        </p>
      
        <div className="support-controls">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              loadLatest();
              loadHistory();
              loadStats();
            }}
            className="btn-default px-4 py-2 text-sm"
            disabled={loading}
            title="Recarregar dados de QA"
          >
            🔄 Atualizar
          </button>
        </div>
      </div>

      <div className="bg-bg-elevated rounded-xl border border-border-default p-6 mb-6 shadow-lg">
        <h3 className="text-xl font-semibold text-text-primary mb-6 flex items-center gap-2">
          <span>🔍</span>
          <span>Filtros</span>
        </h3>
        <p className="text-sm text-text-secondary">Sem filtros específicos para esta tela.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border-default mb-6">
        <button
          onClick={() => setActiveTab('latest')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'latest'
              ? 'text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Último Resultado
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Histórico
        </button>
        <button
          onClick={() => setActiveTab('stats')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'stats'
              ? 'text-accent-primary border-b-2 border-accent-primary'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          Estatísticas
        </button>
      </div>

      {/* Conteúdo baseado na aba ativa */}
      {activeTab === 'latest' && (
        <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-accent-primary mx-auto mb-4"></div>
                <p className="text-text-secondary">Carregando...</p>
              </div>
            </div>
          ) : latestResult ? (
            <>
              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold text-text-primary">
                    Status: <span className={getStatusColor(latestResult.status)}>
                      {getStatusBadge(latestResult.status)}
                    </span>
                  </h2>
                  <div className="text-sm text-text-secondary">
                    {formatDate(latestResult.meta.timestamp)}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div>
                    <div className="text-sm text-text-secondary">Origem</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {getSourceLabel(latestResult.meta.source)}
                    </div>
                  </div>
                  {latestResult.meta.commit && (
                    <div>
                      <div className="text-sm text-text-secondary">Commit</div>
                      <div className="text-lg font-mono text-text-primary">
                        {latestResult.meta.commit.substring(0, 7)}
                      </div>
                    </div>
                  )}
                  {latestResult.meta.branch && (
                    <div>
                      <div className="text-sm text-text-secondary">Branch</div>
                      <div className="text-lg font-semibold text-text-primary">
                        {latestResult.meta.branch}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-sm text-text-secondary">Escopos</div>
                    <div className="text-lg font-semibold text-text-primary">
                      {latestResult.scope.length}
                    </div>
                  </div>
                </div>
                <div className="mb-4">
                  <div className="text-sm text-text-secondary mb-2">Escopos Afetados</div>
                  <div className="flex flex-wrap gap-2">
                    {latestResult.scope.map((scope) => (
                      <span
                        key={scope}
                        className="px-3 py-1 bg-bg-secondary border border-border-default rounded-lg text-sm text-text-primary"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-xl font-semibold text-text-primary mb-4">
                  Checks ({latestResult.checks.length})
                </h3>
                <div className="space-y-2">
                  {latestResult.checks.map((check, index) => {
                    const blockingFailures = check.result === 'FAIL' && check.blocking;
                    return (
                      <div
                        key={index}
                        className={`p-4 rounded-lg border ${
                          blockingFailures
                            ? 'bg-status-error/10 border-status-error/30'
                            : check.result === 'FAIL'
                            ? 'bg-status-warning/10 border-status-warning/30'
                            : 'bg-status-success/10 border-status-success/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="font-semibold text-text-primary">{check.id}</div>
                            {check.details?.message && (
                              <div className="text-sm text-text-secondary mt-1">
                                {check.details.message}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={getStatusColor(check.result)}>
                              {check.result === 'PASS' ? '✅' : '❌'}
                            </span>
                            {check.blocking && (
                              <span className="text-xs px-2 py-1 bg-status-error/15 text-status-error rounded">
                                Bloqueante
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="py-20 text-center text-text-secondary">
              Nenhum resultado de QA encontrado
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div className="bg-bg-elevated rounded-xl border border-border-default overflow-hidden shadow-lg">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-bg-secondary border-b border-border-default">
                  <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                    Data/Hora
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                    Origem
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                    Escopos
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold text-text-primary">
                    Checks
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((result, index) => (
                  <tr key={index} className="border-b border-border-default hover:bg-bg-hover transition-colors">
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {formatDate(result.meta.timestamp)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={getStatusColor(result.status)}>
                        {getStatusBadge(result.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {getSourceLabel(result.meta.source)}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {result.scope.join(', ')}
                    </td>
                    <td className="px-4 py-3 text-sm text-text-primary">
                      {result.checks.length} ({result.checks.filter(c => c.result === 'FAIL' && c.blocking).length} bloqueantes)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {history.length === 0 && (
            <div className="py-20 text-center text-text-secondary">
              Nenhum histórico encontrado
            </div>
          )}
        </div>
      )}

      {activeTab === 'stats' && stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-text-primary mb-2">
              {stats.total || 0}
            </div>
            <div className="text-text-secondary text-sm">Total de Execuções</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-green-500 mb-2">
              {stats.byStatus?.PASS || 0}
            </div>
            <div className="text-text-secondary text-sm">Passou</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-red-500 mb-2">
              {stats.byStatus?.FAIL || 0}
            </div>
            <div className="text-text-secondary text-sm">Falhou</div>
          </div>
          <div className="bg-bg-elevated rounded-xl border border-border-default p-6 shadow-lg">
            <div className="text-3xl font-bold text-yellow-500 mb-2">
              {stats.blockingFailures || 0}
            </div>
            <div className="text-text-secondary text-sm">Falhas Bloqueantes</div>
          </div>
        </div>
      )}

      <ToastContainer />
    </CrudPageBase>
  );
}
